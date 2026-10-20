import { and, between, desc, eq, inArray, isNotNull, or, sql, type SQL } from 'drizzle-orm';
import {
  PAYMENT_METHOD_LABELS,
  addDays,
  diffInDays,
  enumeratePeriods,
  getInvoiceDates,
  periodKey,
  type CashflowReportResponse,
  type CategoryAmount,
  type CategoryReportResponse,
  type CategorySeries,
  type ComparisonReportResponse,
  type ContactReportResponse,
  type Granularity,
  type IconName,
  type ISODate,
  type OverviewReportResponse,
  type PaymentMethod,
  type PeriodTotals,
  type ReportPeriod,
  type cashflowReportQuerySchema,
  type categoryReportQuerySchema,
  type comparisonReportQuerySchema,
  type contactReportQuerySchema,
  type overviewReportQuerySchema,
} from '@effinance/shared';
import type { z } from 'zod';
import type { DbExecutor } from '../../db/client';
import { categories, contacts, creditCards, transactions, type CategoryRow } from '../../db/schema';
import { today } from '../../lib/clock';
import { ValidationError } from '../../lib/errors';
import { countAll, sumOf } from '../../lib/sql';
import { getAccountOrThrow, getCategoryOrThrow } from '../common/ownership';
import { balanceAt, cashAccounts, effectOn } from '../statement/service';
import { toTransactions } from '../transactions/mapper';
import { ensureMaterialized } from '../transactions/series';
import { buildInsights, type CategoryTotal } from './insights';

const UNCATEGORIZED = { name: 'Sem categoria', icon: 'tag' as IconName, color: '#9A9EA5' };

function assertRange(from: ISODate, to: ISODate) {
  if (from > to) throw new ValidationError('Data inicial maior que a final');
  if (diffInDays(to, from) > 366 * 10) throw new ValidationError('Período máximo de 10 anos');
}

export function reportPeriods(from: ISODate, to: ISODate, granularity: Granularity): ReportPeriod[] {
  const now = today();
  const periods = enumeratePeriods(from, to, granularity);
  if (periods.length >= 400) throw new ValidationError('Período muito longo para esta granularidade');
  return periods.map((p) => ({ ...p, projected: p.start > now }));
}

/** income/expense, competence (date) basis, optionally only paid. */
function competenceWhere(workspaceId: string, from: ISODate, to: ISODate, status: 'all' | 'paid', type?: 'income' | 'expense') {
  return and(
    eq(transactions.workspaceId, workspaceId),
    type ? eq(transactions.type, type) : inArray(transactions.type, ['income', 'expense']),
    between(transactions.date, from, to),
    status === 'paid' ? eq(transactions.paid, true) : undefined,
  );
}

async function categoryMap(db: DbExecutor, workspaceId: string): Promise<Map<string, CategoryRow>> {
  const rows = await db.select().from(categories).where(eq(categories.workspaceId, workspaceId));
  return new Map(rows.map((r) => [r.id, r]));
}

function categoryMeta(map: Map<string, CategoryRow>, id: string | null) {
  const row = id ? map.get(id) : undefined;
  return row ? { name: row.name, icon: row.icon, color: row.color } : UNCATEGORIZED;
}

/** Totals per top-level category in a range. */
export async function totalsByCategory(
  db: DbExecutor,
  workspaceId: string,
  from: ISODate,
  to: ISODate,
  type: 'income' | 'expense',
  status: 'all' | 'paid' = 'all',
): Promise<{ categoryId: string | null; amount: number }[]> {
  return db
    .select({ categoryId: transactions.categoryId, amount: sumOf(transactions.amount) })
    .from(transactions)
    .where(competenceWhere(workspaceId, from, to, status, type))
    .groupBy(transactions.categoryId);
}

export function toCategoryAmounts(
  totals: { categoryId: string | null; amount: number }[],
  cats: Map<string, CategoryRow>,
): CategoryAmount[] {
  const sum = totals.reduce((acc, t) => acc + t.amount, 0);
  return totals
    .filter((t) => t.amount > 0)
    .map((t) => ({
      categoryId: t.categoryId,
      ...categoryMeta(cats, t.categoryId),
      amount: t.amount,
      share: sum > 0 ? t.amount / sum : 0,
    }))
    .sort((a, b) => b.amount - a.amount);
}

export function toCategoryTotalMap(amounts: CategoryAmount[]): Map<string, CategoryTotal> {
  return new Map(amounts.map((a) => [a.categoryId ?? 'none', { name: a.name, amount: a.amount }]));
}

// ---------------------------------------------------------------------------
// Categories: evolution + projection
// ---------------------------------------------------------------------------

type CategoryReportQuery = z.output<typeof categoryReportQuerySchema>;

export async function categoryReport(
  db: DbExecutor,
  workspaceId: string,
  q: CategoryReportQuery,
): Promise<CategoryReportResponse> {
  assertRange(q.from, q.to);
  await ensureMaterialized(db, workspaceId, q.to);
  const periods = reportPeriods(q.from, q.to, q.granularity);
  const index = new Map(periods.map((p, i) => [p.key, i]));

  let parent: CategoryRow | null = null;
  if (q.categoryId) parent = await getCategoryOrThrow(db, workspaceId, q.categoryId);
  const dimension = parent ? transactions.subcategoryId : transactions.categoryId;

  const rows = await db
    .select({ key: dimension, date: transactions.date, amount: sumOf(transactions.amount) })
    .from(transactions)
    .where(
      and(
        competenceWhere(workspaceId, q.from, q.to, q.status, q.type),
        parent ? eq(transactions.categoryId, parent.id) : undefined,
      ),
    )
    .groupBy(dimension, transactions.date);

  const cats = await categoryMap(db, workspaceId);
  const seriesMap = new Map<string, number[]>();
  for (const r of rows) {
    const k = r.key ?? 'none';
    const i = index.get(periodKey(r.date, q.granularity));
    if (i === undefined) continue;
    const values = seriesMap.get(k) ?? Array.from({ length: periods.length }, () => 0);
    values[i]! += r.amount;
    seriesMap.set(k, values);
  }

  const totals = Array.from({ length: periods.length }, () => 0);
  let total = 0;
  const series: CategorySeries[] = [...seriesMap.entries()].map(([key, values]) => {
    const categoryId = key === 'none' ? null : key;
    const sum = values.reduce((a, b) => a + b, 0);
    values.forEach((v, i) => (totals[i]! += v));
    total += sum;
    const withData = values.filter((v) => v !== 0).length;
    const meta =
      categoryId === null && parent
        ? { name: `${parent.name} (sem subcategoria)`, icon: parent.icon, color: parent.color }
        : categoryMeta(cats, categoryId);
    return {
      categoryId,
      ...meta,
      total: sum,
      share: 0,
      values,
      average: withData > 0 ? Math.round(sum / withData) : 0,
    };
  });
  for (const s of series) s.share = total > 0 ? s.total / total : 0;
  series.sort((a, b) => b.total - a.total);

  return { type: q.type, periods, series, totals, total };
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

type ContactReportQuery = z.output<typeof contactReportQuerySchema>;

export async function contactReport(
  db: DbExecutor,
  workspaceId: string,
  q: ContactReportQuery,
): Promise<ContactReportResponse> {
  assertRange(q.from, q.to);
  await ensureMaterialized(db, workspaceId, q.to);
  const periods = reportPeriods(q.from, q.to, q.granularity);
  const index = new Map(periods.map((p, i) => [p.key, i]));

  const rows = await db
    .select({
      contactId: transactions.contactId,
      type: transactions.type,
      date: transactions.date,
      amount: sumOf(transactions.amount),
      count: countAll(),
    })
    .from(transactions)
    .where(competenceWhere(workspaceId, q.from, q.to, q.status))
    .groupBy(transactions.contactId, transactions.type, transactions.date);

  const contactIds = [...new Set(rows.map((r) => r.contactId).filter((v): v is string => !!v))];
  const names = contactIds.length
    ? await db
        .select({ id: contacts.id, name: contacts.name })
        .from(contacts)
        .where(inArray(contacts.id, contactIds))
    : [];
  const nameMap = new Map(names.map((n) => [n.id, n.name]));

  const empty = () => Array.from({ length: periods.length }, () => 0);
  const items = new Map<string, ContactReportResponse['items'][number]>();
  for (const r of rows) {
    const key = r.contactId ?? 'none';
    const item =
      items.get(key) ??
      {
        contactId: r.contactId,
        name: r.contactId ? (nameMap.get(r.contactId) ?? 'Contato removido') : 'Sem contato',
        income: 0,
        expense: 0,
        net: 0,
        count: 0,
        incomeValues: empty(),
        expenseValues: empty(),
      };
    const i = index.get(periodKey(r.date, q.granularity));
    if (r.type === 'income') {
      item.income += r.amount;
      if (i !== undefined) item.incomeValues[i]! += r.amount;
    } else {
      item.expense += r.amount;
      if (i !== undefined) item.expenseValues[i]! += r.amount;
    }
    item.count += r.count;
    item.net = item.income - item.expense;
    items.set(key, item);
  }

  return {
    periods,
    items: [...items.values()].sort((a, b) => b.income + b.expense - (a.income + a.expense)),
  };
}

// ---------------------------------------------------------------------------
// Period comparison
// ---------------------------------------------------------------------------

type ComparisonReportQuery = z.output<typeof comparisonReportQuerySchema>;

async function periodTotals(
  db: DbExecutor,
  workspaceId: string,
  from: ISODate,
  to: ISODate,
  status: 'all' | 'paid',
): Promise<PeriodTotals> {
  const [row] = await db
    .select({
      income: sumOf(sql`case when ${transactions.type} = 'income' then ${transactions.amount} else 0 end`),
      expense: sumOf(sql`case when ${transactions.type} = 'expense' then ${transactions.amount} else 0 end`),
      count: countAll(),
    })
    .from(transactions)
    .where(competenceWhere(workspaceId, from, to, status));
  const income = row?.income ?? 0;
  const expense = row?.expense ?? 0;
  return { from, to, income, expense, net: income - expense, count: row?.count ?? 0 };
}

export async function comparisonReport(
  db: DbExecutor,
  workspaceId: string,
  q: ComparisonReportQuery,
): Promise<ComparisonReportResponse> {
  assertRange(q.aFrom, q.aTo);
  assertRange(q.bFrom, q.bTo);
  await ensureMaterialized(db, workspaceId, q.aTo > q.bTo ? q.aTo : q.bTo);

  const [a, b, aCats, bCats, cats] = await Promise.all([
    periodTotals(db, workspaceId, q.aFrom, q.aTo, q.status),
    periodTotals(db, workspaceId, q.bFrom, q.bTo, q.status),
    totalsByCategory(db, workspaceId, q.aFrom, q.aTo, q.type, q.status),
    totalsByCategory(db, workspaceId, q.bFrom, q.bTo, q.type, q.status),
    categoryMap(db, workspaceId),
  ]);

  const keys = new Set([...aCats, ...bCats].map((r) => r.categoryId ?? 'none'));
  const aMap = new Map(aCats.map((r) => [r.categoryId ?? 'none', r.amount]));
  const bMap = new Map(bCats.map((r) => [r.categoryId ?? 'none', r.amount]));
  const rows = [...keys]
    .map((key) => {
      const categoryId = key === 'none' ? null : key;
      const av = aMap.get(key) ?? 0;
      const bv = bMap.get(key) ?? 0;
      return {
        categoryId,
        ...categoryMeta(cats, categoryId),
        a: av,
        b: bv,
        diff: bv - av,
        diffPercent: av === 0 ? null : (bv - av) / av,
      };
    })
    .sort((x, y) => Math.max(y.a, y.b) - Math.max(x.a, x.b));

  return { type: q.type, a, b, rows };
}

// ---------------------------------------------------------------------------
// Cash flow (effective dates, account movements + projected card invoices)
// ---------------------------------------------------------------------------

type CashflowReportQuery = z.output<typeof cashflowReportQuerySchema>;

export async function cashflowReport(
  db: DbExecutor,
  workspaceId: string,
  q: CashflowReportQuery,
): Promise<CashflowReportResponse> {
  assertRange(q.from, q.to);
  await ensureMaterialized(db, workspaceId, q.to);
  const periods = reportPeriods(q.from, q.to, q.granularity);
  const index = new Map(periods.map((p, i) => [p.key, i]));

  const set = q.accountId ? [await getAccountOrThrow(db, workspaceId, q.accountId)] : await cashAccounts(db, workspaceId);
  const ids = new Set(set.map((a) => a.id));
  const openingBalance = set.length ? await balanceAt(db, workspaceId, set, addDays(q.from, -1)) : 0;

  const result = periods.map((p) => ({
    ...p,
    inflow: 0,
    outflow: 0,
    net: 0,
    balance: 0,
    realizedInflow: 0,
    realizedOutflow: 0,
    pendingInflow: 0,
    pendingOutflow: 0,
  }));

  if (ids.size > 0) {
    const rows = await db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.workspaceId, workspaceId),
          or(inArray(transactions.accountId, [...ids]), inArray(transactions.toAccountId, [...ids])),
          or(
            sql`${transactions.paid} and coalesce(${transactions.paidAt}, ${transactions.date}) between ${q.from} and ${q.to}`,
            sql`not ${transactions.paid} and ${transactions.date} between ${q.from} and ${q.to}`,
          ),
        ),
      );
    for (const row of rows) {
      const effect = effectOn(row, ids);
      if (effect === 0) continue;
      const date = row.paid ? (row.paidAt ?? row.date) : row.date;
      const p = result[index.get(periodKey(date, q.granularity)) ?? -1];
      if (!p) continue;
      if (row.paid) {
        if (effect > 0) p.realizedInflow += effect;
        else p.realizedOutflow -= effect;
      } else if (effect > 0) p.pendingInflow += effect;
      else p.pendingOutflow -= effect;
    }

    // Unpaid card purchases leave the account on the invoice due date.
    const cardWhere: SQL | undefined = q.accountId
      ? eq(creditCards.defaultAccountId, q.accountId)
      : undefined;
    const invoices = await db
      .select({
        closingDay: creditCards.closingDay,
        dueDay: creditCards.dueDay,
        month: transactions.invoiceMonth,
        amount: sumOf(transactions.amount),
      })
      .from(transactions)
      .innerJoin(creditCards, eq(creditCards.id, transactions.creditCardId))
      .where(
        and(
          eq(transactions.workspaceId, workspaceId),
          eq(transactions.type, 'expense'),
          eq(transactions.paid, false),
          isNotNull(transactions.invoiceMonth),
          cardWhere,
        ),
      )
      .groupBy(creditCards.id, creditCards.closingDay, creditCards.dueDay, transactions.invoiceMonth);
    for (const inv of invoices) {
      const due = getInvoiceDates(inv.month!, inv.closingDay, inv.dueDay).dueDate;
      if (due < q.from || due > q.to) continue;
      const p = result[index.get(periodKey(due, q.granularity)) ?? -1];
      if (p) p.pendingOutflow += inv.amount;
    }
  }

  let balance = openingBalance;
  for (const p of result) {
    p.inflow = p.realizedInflow + p.pendingInflow;
    p.outflow = p.realizedOutflow + p.pendingOutflow;
    p.net = p.inflow - p.outflow;
    balance += p.net;
    p.balance = balance;
  }

  return { openingBalance, closingBalance: balance, periods: result };
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

type OverviewReportQuery = z.output<typeof overviewReportQuerySchema>;

export async function overviewReport(
  db: DbExecutor,
  workspaceId: string,
  q: OverviewReportQuery,
): Promise<OverviewReportResponse> {
  assertRange(q.from, q.to);
  await ensureMaterialized(db, workspaceId, q.to);
  const days = diffInDays(q.to, q.from) + 1;
  const prevTo = addDays(q.from, -1);
  const prevFrom = addDays(prevTo, -(days - 1));
  const where = competenceWhere(workspaceId, q.from, q.to, 'all');

  const [totals, split, methods, top, catTotals, prevCatTotals, cats] = await Promise.all([
    periodTotals(db, workspaceId, q.from, q.to, 'all'),
    db
      .select({ kind: transactions.recurrenceKind, amount: sumOf(transactions.amount) })
      .from(transactions)
      .where(and(where, eq(transactions.type, 'expense')))
      .groupBy(transactions.recurrenceKind),
    db
      .select({
        method: sql<PaymentMethod | null>`coalesce(${transactions.paymentMethod}, case when ${transactions.creditCardId} is not null then 'credit_card' end)`,
        amount: sumOf(transactions.amount),
      })
      .from(transactions)
      .where(and(where, eq(transactions.type, 'expense')))
      .groupBy(sql`1`),
    db
      .select()
      .from(transactions)
      .where(and(where, eq(transactions.type, 'expense')))
      .orderBy(desc(transactions.amount))
      .limit(5),
    totalsByCategory(db, workspaceId, q.from, q.to, 'expense'),
    totalsByCategory(db, workspaceId, prevFrom, prevTo, 'expense'),
    categoryMap(db, workspaceId),
  ]);

  const byKind = new Map(split.map((s) => [s.kind, s.amount]));
  const fixedExpense = (byKind.get('fixed') ?? 0) + (byKind.get('recurring') ?? 0);
  const installmentExpense = byKind.get('installment') ?? 0;
  const variableExpense = byKind.get('single') ?? 0;
  const methodTotal = methods.reduce((a, m) => a + m.amount, 0);
  const topCategories = toCategoryAmounts(catTotals, cats);
  const prevCategories = toCategoryAmounts(prevCatTotals, cats);

  return {
    from: q.from,
    to: q.to,
    income: totals.income,
    expense: totals.expense,
    net: totals.net,
    savingsRate: totals.income > 0 ? totals.net / totals.income : null,
    averageDailyExpense: Math.round(totals.expense / days),
    fixedExpense,
    variableExpense,
    installmentExpense,
    byPaymentMethod: methods
      .map((m) => ({
        method: m.method,
        label: m.method ? PAYMENT_METHOD_LABELS[m.method] : 'Não informado',
        amount: m.amount,
        share: methodTotal > 0 ? m.amount / methodTotal : 0,
      }))
      .sort((a, b) => b.amount - a.amount),
    topExpenses: await toTransactions(db, top),
    topCategories: topCategories.slice(0, 5),
    insights: buildInsights({
      income: totals.income,
      expense: totals.expense,
      expenseByCategory: toCategoryTotalMap(topCategories),
      previousExpenseByCategory: toCategoryTotalMap(prevCategories),
      fixedExpense,
      previousLabel: 'período anterior',
    }),
  };
}
