import { and, asc, between, eq, inArray, isNotNull, isNull, lt, lte, sql } from 'drizzle-orm';
import {
  addDays,
  addMonthKey,
  monthRange,
  type Account,
  type CreditCard,
  type DashboardResponse,
  type Goal,
  type HealthScore,
  type MonthKey,
  type MonthSummary,
} from '@effinance/shared';
import type { Database, DbExecutor } from '../../db/client';
import { categories, creditCards, transactions } from '../../db/schema';
import { today } from '../../lib/clock';
import { countAll, sumOf } from '../../lib/sql';
import { listAccountsWithBalances } from '../accounts/service';
import { committedCardDebt, toCreditCards } from '../credit-cards/service';
import { listGoals } from '../goals/service';
import { buildInsights } from '../reports/insights';
import { toCategoryAmounts, toCategoryTotalMap, totalsByCategory } from '../reports/service';
import { toTransactions } from '../transactions/mapper';
import { ensureMaterialized } from '../transactions/series';

/** Competence summaries for each month in [first, last]. */
export async function monthSummaries(
  db: DbExecutor,
  userId: string,
  first: MonthKey,
  last: MonthKey,
): Promise<MonthSummary[]> {
  const rows = await db
    .select({
      month: sql<string>`to_char(${transactions.date}, 'YYYY-MM')`,
      type: transactions.type,
      paid: transactions.paid,
      amount: sumOf(transactions.amount),
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        inArray(transactions.type, ['income', 'expense']),
        between(transactions.date, monthRange(first).from, monthRange(last).to),
      ),
    )
    .groupBy(sql`1`, transactions.type, transactions.paid);

  const out: MonthSummary[] = [];
  for (let m = first; m <= last; m = addMonthKey(m, 1)) {
    const of = (type: string, paid: boolean) =>
      rows.filter((r) => r.month === m && r.type === type && r.paid === paid).reduce((a, r) => a + r.amount, 0);
    const paidIncome = of('income', true);
    const pendingIncome = of('income', false);
    const paidExpense = of('expense', true);
    const pendingExpense = of('expense', false);
    const income = paidIncome + pendingIncome;
    const expense = paidExpense + pendingExpense;
    out.push({
      month: m,
      income,
      expense,
      net: income - expense,
      savingsRate: income > 0 ? (income - expense) / income : null,
      paidIncome,
      paidExpense,
      pendingIncome,
      pendingExpense,
    });
  }
  return out;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function computeHealth(input: {
  monthly: MonthSummary[];
  liquidAssets: number;
  overdueCount: number;
  cards: CreditCard[];
  goals: Goal[];
}): HealthScore {
  const recent = input.monthly.slice(-3);
  const income = recent.reduce((a, m) => a + m.income, 0);
  const expense = recent.reduce((a, m) => a + m.expense, 0);
  const rate = income > 0 ? (income - expense) / income : 0;
  const savings = Math.round(clamp01(rate / 0.2) * 300);

  const avgExpense = recent.length ? expense / recent.length : 0;
  const reserveMonths = avgExpense > 0 ? input.liquidAssets / avgExpense : input.liquidAssets > 0 ? 6 : 0;
  const reserve = Math.round(clamp01(reserveMonths / 6) * 250);

  const onTime = Math.max(0, 200 - input.overdueCount * 50);

  const limit = input.cards.reduce((a, c) => a + c.limit, 0);
  const used = input.cards.reduce((a, c) => a + c.usedLimit, 0);
  const usage = limit > 0 ? used / limit : 0;
  const cardScore = limit === 0 ? 150 : usage <= 0.3 ? 150 : usage >= 0.9 ? 0 : Math.round((150 * (0.9 - usage)) / 0.6);

  const active = input.goals.filter((g) => !g.archived);
  const goalScore = active.length
    ? Math.round((active.reduce((a, g) => a + g.progress, 0) / active.length) * 100)
    : 50;

  const factors: HealthScore['factors'] = [
    {
      label: 'Taxa de economia',
      score: savings,
      max: 300,
      hint: `Você poupou ${Math.round(rate * 100)}% da renda nos últimos 3 meses (meta: 20%).`,
    },
    {
      label: 'Reserva de emergência',
      score: reserve,
      max: 250,
      hint: `Seu saldo cobre ${reserveMonths.toFixed(1).replace('.', ',')} meses de despesas (meta: 6).`,
    },
    {
      label: 'Contas em dia',
      score: onTime,
      max: 200,
      hint: input.overdueCount ? `${input.overdueCount} conta(s) vencida(s).` : 'Nenhuma conta vencida.',
    },
    {
      label: 'Uso do cartão',
      score: cardScore,
      max: 150,
      hint: limit > 0 ? `${Math.round(usage * 100)}% do limite total em uso (ideal: até 30%).` : 'Sem cartões cadastrados.',
    },
    {
      label: 'Metas',
      score: goalScore,
      max: 100,
      hint: active.length ? `Progresso médio de ${goalScore}% nas metas ativas.` : 'Cadastre metas para acompanhar seus objetivos.',
    },
  ];
  const score = factors.reduce((a, f) => a + f.score, 0);
  const label: HealthScore['label'] =
    score >= 800 ? 'Excelente' : score >= 600 ? 'Saudável' : score >= 400 ? 'Atenção' : 'Crítica';
  return { score, label, factors };
}

export async function getDashboard(db: Database, userId: string, month: MonthKey): Promise<DashboardResponse> {
  const now = today();
  const { from, to } = monthRange(month);
  await ensureMaterialized(db, userId, to);

  const pendingBase = and(
    eq(transactions.userId, userId),
    inArray(transactions.type, ['income', 'expense']),
    eq(transactions.paid, false),
    isNull(transactions.creditCardId),
  );

  const [accounts, cardRows, goals, monthlyAll, expenseTotals, incomeTotals, prevExpenseTotals, upcomingRows, overdueRow, upcomingWeekRow, fixedRows, cats] =
    await Promise.all([
      listAccountsWithBalances(db, userId),
      db
        .select()
        .from(creditCards)
        .where(and(eq(creditCards.userId, userId), eq(creditCards.archived, false)))
        .orderBy(asc(creditCards.createdAt)),
      listGoals(db, userId, false),
      monthSummaries(db, userId, addMonthKey(month, -6), month),
      totalsByCategory(db, userId, from, to, 'expense'),
      totalsByCategory(db, userId, from, to, 'income'),
      totalsByCategory(db, userId, monthRange(addMonthKey(month, -1)).from, monthRange(addMonthKey(month, -1)).to, 'expense'),
      db
        .select()
        .from(transactions)
        .where(and(pendingBase, lte(transactions.date, addDays(now, 15))))
        .orderBy(asc(transactions.date), asc(transactions.createdAt))
        .limit(10),
      db
        .select({ count: countAll(), amount: sumOf(transactions.amount) })
        .from(transactions)
        .where(and(pendingBase, eq(transactions.type, 'expense'), lt(transactions.date, now))),
      db
        .select({ count: countAll(), amount: sumOf(transactions.amount) })
        .from(transactions)
        .where(and(pendingBase, eq(transactions.type, 'expense'), between(transactions.date, now, addDays(now, 7)))),
      db
        .select()
        .from(transactions)
        .where(
          and(
            eq(transactions.userId, userId),
            eq(transactions.recurrenceKind, 'fixed'),
            between(transactions.date, from, to),
          ),
        )
        .orderBy(asc(transactions.date)),
      db.select().from(categories).where(eq(categories.userId, userId)),
    ]);

  const catMap = new Map(cats.map((c) => [c.id, c]));
  const cards = await toCreditCards(db, cardRows);
  const monthly = monthlyAll.slice(-6);
  const summary = monthlyAll[monthlyAll.length - 1]!;
  const previous = monthlyAll[monthlyAll.length - 2]!;

  const sumBalance = (list: Account[]) => list.reduce((a, acc) => a + acc.balance, 0);
  const accountsTotal = sumBalance(accounts.filter((a) => a.type !== 'investment' && a.includeInTotal));
  const investments = sumBalance(accounts.filter((a) => a.type === 'investment'));
  const [debtRow] = await db
    .select({ amount: sumOf(transactions.amount) })
    .from(transactions)
    .where(
      and(eq(transactions.userId, userId), committedCardDebt(now), isNotNull(transactions.creditCardId)),
    );
  const cardDebt = debtRow?.amount ?? 0;

  const expensesByCategory = toCategoryAmounts(expenseTotals, catMap);
  const incomeByCategory = toCategoryAmounts(incomeTotals, catMap);
  const fixedExpenseTotal = fixedRows.filter((r) => r.type === 'expense').reduce((a, r) => a + r.amount, 0);
  const overdue = { count: overdueRow[0]?.count ?? 0, amount: overdueRow[0]?.amount ?? 0 };

  const [upcoming, fixed] = await Promise.all([toTransactions(db, upcomingRows), toTransactions(db, fixedRows)]);

  return {
    month,
    balances: {
      accounts: accountsTotal,
      investments,
      cardDebt,
      netWorth: accountsTotal + investments - cardDebt,
    },
    summary,
    previous,
    monthly,
    expensesByCategory,
    incomeByCategory,
    upcoming,
    overdue,
    fixedExpenses: fixed.filter((t) => t.type === 'expense'),
    fixedIncome: fixed.filter((t) => t.type === 'income'),
    goals,
    cards,
    accounts,
    health: computeHealth({
      monthly,
      liquidAssets: accountsTotal + investments,
      overdueCount: overdue.count,
      cards,
      goals,
    }),
    insights: buildInsights({
      income: summary.income,
      expense: summary.expense,
      expenseByCategory: toCategoryTotalMap(expensesByCategory),
      previousExpenseByCategory: toCategoryTotalMap(toCategoryAmounts(prevExpenseTotals, catMap)),
      overdue,
      cards: cards.map((c) => ({ name: c.name, usedLimit: c.usedLimit, limit: c.limit })),
      goals,
      fixedExpense: fixedExpenseTotal,
      upcomingWeek: { count: upcomingWeekRow[0]?.count ?? 0, amount: upcomingWeekRow[0]?.amount ?? 0 },
      previousLabel: 'mês anterior',
    }),
  };
}
