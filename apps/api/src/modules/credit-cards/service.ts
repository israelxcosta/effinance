import { and, asc, eq, inArray, lte, or, sql } from 'drizzle-orm';
import {
  addMonthKey,
  formatMonthKey,
  getInvoiceDates,
  getInvoiceForPurchase,
  getInvoiceStatus,

  type CreditCard,
  type Invoice,
  type InvoiceSummary,
  type MonthKey,
  type PayInvoiceInput,
  type creditCardInputSchema,
} from '@effinance/shared';
import type { z } from 'zod';
import type { Database, DbExecutor } from '../../db/client';
import { creditCards, transactions, type CreditCardRow } from '../../db/schema';
import { today } from '../../lib/clock';
import { ConflictError, ValidationError } from '../../lib/errors';
import { sumOf } from '../../lib/sql';
import { getAccountOrThrow, getCardOrThrow } from '../common/ownership';
import { toTransactions } from '../transactions/mapper';
import { ensureMaterialized } from '../transactions/series';

type CreditCardInput = z.output<typeof creditCardInputSchema>;

/**
 * Unpaid card purchases that already consume the limit: everything except future occurrences of
 * subscriptions (fixed/recurring), which are only charged when their date arrives. Installments
 * consume the whole remaining amount, as card issuers do.
 */
export function committedCardDebt(now: string) {
  return and(
    eq(transactions.type, 'expense'),
    eq(transactions.paid, false),
    or(inArray(transactions.recurrenceKind, ['single', 'installment']), lte(transactions.date, now)),
  );
}

interface InvoiceTotals {
  total: number;
  unpaidTotal: number;
}

export function buildInvoiceSummary(
  card: CreditCardRow,
  month: MonthKey,
  totals: InvoiceTotals | undefined,
  now = today(),
): InvoiceSummary {
  const dates = getInvoiceDates(month, card.closingDay, card.dueDay);
  const total = totals?.total ?? 0;
  const unpaidTotal = totals?.unpaidTotal ?? 0;
  return {
    cardId: card.id,
    month,
    closingDate: dates.closingDate,
    dueDate: dates.dueDate,
    total,
    unpaidTotal,
    status: getInvoiceStatus(dates, { total, unpaidTotal, today: now }),
  };
}

/** total / unpaid per (card, invoice month). */
async function invoiceTotals(
  db: DbExecutor,
  cardIds: string[],
  months?: MonthKey[],
): Promise<Map<string, InvoiceTotals>> {
  if (cardIds.length === 0) return new Map();
  const rows = await db
    .select({
      cardId: transactions.creditCardId,
      month: transactions.invoiceMonth,
      total: sumOf(transactions.amount),
      unpaidTotal: sumOf(sql`case when not ${transactions.paid} then ${transactions.amount} else 0 end`),
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.type, 'expense'),
        inArray(transactions.creditCardId, cardIds),
        months ? inArray(transactions.invoiceMonth, months) : undefined,
      ),
    )
    .groupBy(transactions.creditCardId, transactions.invoiceMonth);
  return new Map(rows.map((r) => [`${r.cardId}:${r.month}`, { total: r.total, unpaidTotal: r.unpaidTotal }]));
}

export async function toCreditCards(db: DbExecutor, rows: CreditCardRow[]): Promise<CreditCard[]> {
  if (rows.length === 0) return [];
  const now = today();
  const ids = rows.map((r) => r.id);
  const used = await db
    .select({ cardId: transactions.creditCardId, used: sumOf(transactions.amount) })
    .from(transactions)
    .where(and(committedCardDebt(now), inArray(transactions.creditCardId, ids)))
    .groupBy(transactions.creditCardId);
  const usedMap = new Map(used.map((u) => [u.cardId, u.used]));

  const currentMonths = rows.map((r) => getInvoiceForPurchase(now, r.closingDay, r.dueDay).month);
  const totals = await invoiceTotals(db, ids, [...new Set(currentMonths)]);

  return rows.map((row, i) => {
    const usedLimit = usedMap.get(row.id) ?? 0;
    const month = currentMonths[i]!;
    return {
      id: row.id,
      name: row.name,
      bank: row.bank,
      brand: row.brand,
      limit: row.limit,
      closingDay: row.closingDay,
      dueDay: row.dueDay,
      color: row.color,
      defaultAccountId: row.defaultAccountId,
      archived: row.archived,
      createdAt: row.createdAt.toISOString(),
      usedLimit,
      availableLimit: row.limit - usedLimit,
      currentInvoice: buildInvoiceSummary(row, month, totals.get(`${row.id}:${month}`), now),
    };
  });
}

export async function listCreditCards(db: Database, userId: string, includeArchived = false) {
  await ensureMaterialized(db, userId);
  const rows = await db
    .select()
    .from(creditCards)
    .where(and(eq(creditCards.userId, userId), includeArchived ? undefined : eq(creditCards.archived, false)))
    .orderBy(asc(creditCards.archived), asc(creditCards.createdAt));
  return toCreditCards(db, rows);
}

async function getCreditCard(db: Database, userId: string, id: string): Promise<CreditCard> {
  const row = await getCardOrThrow(db, userId, id);
  const [card] = await toCreditCards(db, [row]);
  return card!;
}

async function assertDefaultAccount(db: Database, userId: string, accountId: string | null) {
  if (accountId) await getAccountOrThrow(db, userId, accountId);
}

export async function createCreditCard(db: Database, userId: string, input: CreditCardInput) {
  await assertDefaultAccount(db, userId, input.defaultAccountId);
  const [row] = await db.insert(creditCards).values({ userId, ...input }).returning();
  const [card] = await toCreditCards(db, [row!]);
  return card!;
}

export async function updateCreditCard(db: Database, userId: string, id: string, input: CreditCardInput) {
  const current = await getCardOrThrow(db, userId, id);
  await assertDefaultAccount(db, userId, input.defaultAccountId);
  await db.transaction(async (tx) => {
    await tx.update(creditCards).set(input).where(eq(creditCards.id, id));
    if (current.closingDay !== input.closingDay || current.dueDay !== input.dueDay) {
      // New billing cycle: re-assign the invoice of every unpaid purchase.
      const open = await tx
        .select({ id: transactions.id, date: transactions.date })
        .from(transactions)
        .where(and(eq(transactions.creditCardId, id), eq(transactions.paid, false)));
      for (const t of open) {
        const month = getInvoiceForPurchase(t.date, input.closingDay, input.dueDay).month;
        await tx.update(transactions).set({ invoiceMonth: month }).where(eq(transactions.id, t.id));
      }
    }
  });
  return getCreditCard(db, userId, id);
}

export async function deleteCreditCard(db: Database, userId: string, id: string) {
  await getCardOrThrow(db, userId, id);
  const [used] = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.creditCardId, id))
    .limit(1);
  if (used) throw new ConflictError('Este cartão possui lançamentos. Arquive-o em vez de excluir.');
  await db.delete(creditCards).where(eq(creditCards.id, id));
}

export async function listInvoices(
  db: Database,
  userId: string,
  cardId: string,
  range: { from?: MonthKey; to?: MonthKey },
): Promise<InvoiceSummary[]> {
  const card = await getCardOrThrow(db, userId, cardId);
  const current = getInvoiceForPurchase(today(), card.closingDay, card.dueDay).month;
  const from = range.from ?? addMonthKey(current, -5);
  const to = range.to ?? addMonthKey(current, 6);
  if (from > to) throw new ValidationError('Período inválido');

  await ensureMaterialized(db, userId, getInvoiceDates(to, card.closingDay, card.dueDay).dueDate);
  const months: MonthKey[] = [];
  for (let m = from; m <= to && months.length < 120; m = addMonthKey(m, 1)) months.push(m);
  const totals = await invoiceTotals(db, [card.id], months);
  const now = today();
  return months.map((m) => buildInvoiceSummary(card, m, totals.get(`${card.id}:${m}`), now));
}

export async function getInvoice(db: Database, userId: string, cardId: string, month: MonthKey): Promise<Invoice> {
  const card = await getCardOrThrow(db, userId, cardId);
  await ensureMaterialized(db, userId, getInvoiceDates(month, card.closingDay, card.dueDay).dueDate);

  const [purchases, payments, totals] = await Promise.all([
    db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.type, 'expense'),
          eq(transactions.creditCardId, card.id),
          eq(transactions.invoiceMonth, month),
        ),
      )
      .orderBy(asc(transactions.date), asc(transactions.createdAt)),
    db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.type, 'transfer'),
          eq(transactions.transferKind, 'card_payment'),
          eq(transactions.creditCardId, card.id),
          eq(transactions.invoiceMonth, month),
        ),
      )
      .orderBy(asc(transactions.date)),
    invoiceTotals(db, [card.id], [month]),
  ]);

  return {
    ...buildInvoiceSummary(card, month, totals.get(`${card.id}:${month}`)),
    card: { id: card.id, name: card.name, bank: card.bank, brand: card.brand, color: card.color },
    transactions: await toTransactions(db, purchases),
    payments: await toTransactions(db, payments),
  };
}

export async function payInvoice(
  db: Database,
  userId: string,
  cardId: string,
  month: MonthKey,
  input: PayInvoiceInput,
): Promise<Invoice> {
  const card = await getCardOrThrow(db, userId, cardId);
  await getAccountOrThrow(db, userId, input.accountId);
  await ensureMaterialized(db, userId, getInvoiceDates(month, card.closingDay, card.dueDay).dueDate);

  const totals = await invoiceTotals(db, [card.id], [month]);
  const unpaid = totals.get(`${card.id}:${month}`)?.unpaidTotal ?? 0;
  if (unpaid <= 0) throw new ValidationError('Esta fatura não possui valores em aberto');
  if (input.amount !== undefined && input.amount !== unpaid) {
    throw new ValidationError('Somente o pagamento integral da fatura é suportado', { unpaidTotal: unpaid });
  }

  await db.transaction(async (tx) => {
    await tx.insert(transactions).values({
      userId,
      type: 'transfer',
      transferKind: 'card_payment',
      description: `Fatura ${card.name} — ${formatMonthKey(month)}`,
      amount: unpaid,
      date: input.date,
      paid: true,
      paidAt: input.date,
      accountId: input.accountId,
      toAccountId: null,
      creditCardId: card.id,
      invoiceMonth: month,
      paymentMethod: 'transfer',
      recurrenceKind: 'single',
    });
    await tx
      .update(transactions)
      .set({ paid: true, paidAt: input.date })
      .where(
        and(
          eq(transactions.type, 'expense'),
          eq(transactions.creditCardId, card.id),
          eq(transactions.invoiceMonth, month),
          eq(transactions.paid, false),
        ),
      );
  });

  return getInvoice(db, userId, cardId, month);
}

