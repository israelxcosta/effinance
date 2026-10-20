import { and, asc, desc, eq, gt, gte, ilike, inArray, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import {
  buildOccurrenceDates,
  minISO,
  splitInstallments,
  type SeriesScope,
  type SetPaidInput,
  type Transaction,
  type TransactionInputParsed,
  type TransactionListResponse,
  type transactionQuerySchema,
  type transactionUpdateSchema,
} from '@effinance/shared';
import type { z } from 'zod';
import type { Database, DbExecutor } from '../../db/client';
import { creditCards, recurrences, transactions, type NewTransactionRow, type RecurrenceTemplate } from '../../db/schema';
import { today } from '../../lib/clock';
import { ValidationError } from '../../lib/errors';
import { countAll, likePattern, sumOf } from '../../lib/sql';
import {
  getAccountOrThrow,
  getTransactionOrThrow,
  validateTransactionRefs,
} from '../common/ownership';
import { toTransactions } from './mapper';
import {
  ensureMaterialized,
  invoiceMonthFor,
  materializationHorizon,
  materializeSeries,
  occurrenceRow,
} from './series';
import { deleteTransfer } from '../transfers/service';

type TransactionQuery = z.output<typeof transactionQuerySchema>;
type TransactionUpdate = z.output<typeof transactionUpdateSchema>;

/** Default payment date when marking as paid: the due date, or today if it is still in the future. */
export function defaultPaidAt(date: string): string {
  return minISO(date, today());
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Unpaid and past due. Card purchases are judged by their invoice due date (not the purchase
 * date), mirroring `isOverdue` in the mapper.
 */
export function overdueCondition(now: string): SQL {
  const month = transactions.invoiceMonth;
  return sql`(not ${transactions.paid} and ${transactions.type} <> 'transfer' and (
    (${transactions.creditCardId} is null and ${transactions.date} < ${now})
    or (${month} is not null and exists (
      select 1 from ${creditCards} cc
      where cc.id = ${transactions.creditCardId}
        and make_date(
          split_part(${month}, '-', 1)::int,
          split_part(${month}, '-', 2)::int,
          least(cc.due_day, extract(day from (to_date(${month} || '-01', 'YYYY-MM-DD') + interval '1 month' - interval '1 day'))::int)
        ) < ${now}::date
    ))
  ))`;
}

function buildFilters(userId: string, q: TransactionQuery): SQL[] {
  const now = today();
  const where: SQL[] = [eq(transactions.userId, userId)];
  if (q.type) where.push(eq(transactions.type, q.type));
  if (q.from) where.push(gte(transactions.date, q.from));
  if (q.to) where.push(lte(transactions.date, q.to));
  if (q.status === 'paid') where.push(eq(transactions.paid, true));
  if (q.status === 'pending') where.push(eq(transactions.paid, false));
  if (q.status === 'overdue') where.push(overdueCondition(now));
  if (q.accountId) {
    where.push(or(eq(transactions.accountId, q.accountId), eq(transactions.toAccountId, q.accountId))!);
  }
  if (q.creditCardId) where.push(eq(transactions.creditCardId, q.creditCardId));
  if (q.categoryId) {
    where.push(or(eq(transactions.categoryId, q.categoryId), eq(transactions.subcategoryId, q.categoryId))!);
  }
  if (q.contactId) where.push(eq(transactions.contactId, q.contactId));
  if (q.recurrenceKind) where.push(eq(transactions.recurrenceKind, q.recurrenceKind));
  if (q.search) {
    const pattern = likePattern(q.search);
    where.push(or(ilike(transactions.description, pattern), ilike(transactions.notes, pattern))!);
  }
  return where;
}

export async function listTransactions(
  db: Database,
  userId: string,
  q: TransactionQuery,
): Promise<TransactionListResponse> {
  await ensureMaterialized(db, userId, q.to);
  const where = and(...buildFilters(userId, q));
  const now = today();

  const order =
    q.sort === 'date_desc'
      ? [desc(transactions.date), desc(transactions.createdAt)]
      : q.sort === 'amount_desc'
        ? [desc(transactions.amount), asc(transactions.date)]
        : q.sort === 'amount_asc'
          ? [asc(transactions.amount), asc(transactions.date)]
          : [asc(transactions.date), asc(transactions.createdAt)];

  const [rows, [summary]] = await Promise.all([
    db
      .select()
      .from(transactions)
      .where(where)
      .orderBy(...order)
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db
      .select({
        count: countAll(),
        total: sumOf(transactions.amount),
        paid: sumOf(sql`case when ${transactions.paid} then ${transactions.amount} else 0 end`),
        pending: sumOf(sql`case when not ${transactions.paid} then ${transactions.amount} else 0 end`),
        overdue: sumOf(sql`case when ${overdueCondition(now)} then ${transactions.amount} else 0 end`),
        overdueCount: sumOf(sql`case when ${overdueCondition(now)} then 1 else 0 end`),
        income: sumOf(sql`case when ${transactions.type} = 'income' then ${transactions.amount} else 0 end`),
        expense: sumOf(sql`case when ${transactions.type} = 'expense' then ${transactions.amount} else 0 end`),
      })
      .from(transactions)
      .where(where),
  ]);

  return {
    items: await toTransactions(db, rows),
    total: summary?.count ?? 0,
    page: q.page,
    pageSize: q.pageSize,
    summary: {
      count: summary?.count ?? 0,
      total: summary?.total ?? 0,
      paid: summary?.paid ?? 0,
      pending: summary?.pending ?? 0,
      overdue: summary?.overdue ?? 0,
      overdueCount: summary?.overdueCount ?? 0,
      income: summary?.income ?? 0,
      expense: summary?.expense ?? 0,
    },
  };
}

export async function getTransaction(db: Database, userId: string, id: string): Promise<Transaction> {
  const row = await getTransactionOrThrow(db, userId, id);
  const [dto] = await toTransactions(db, [row]);
  return dto!;
}

// ---------------------------------------------------------------------------
// Create (single, installments, recurring, fixed)
// ---------------------------------------------------------------------------

export async function createTransaction(
  db: Database,
  userId: string,
  input: TransactionInputParsed,
): Promise<Transaction[]> {
  // A category split becomes one linked transaction (or series) per part.
  const parts = input.splits ?? [
    { categoryId: input.categoryId, subcategoryId: input.subcategoryId, amount: input.amount },
  ];
  let card: Awaited<ReturnType<typeof validateTransactionRefs>>['card'] = null;
  for (const part of parts) ({ card } = await validateTransactionRefs(db, userId, { ...input, ...part }));
  const splitGroupId = input.splits ? globalThis.crypto.randomUUID() : null;

  const ids = await db.transaction(async (tx) => {
    const created: string[] = [];
    for (const part of parts) {
      created.push(...(await insertTransaction(tx, userId, { ...input, ...part }, card, splitGroupId)));
    }
    return created;
  });

  const rows = await db
    .select()
    .from(transactions)
    .where(inArray(transactions.id, ids))
    .orderBy(asc(transactions.date), asc(transactions.createdAt));
  return toTransactions(db, rows);
}

/** Inserts a single transaction or a whole series (installments, recurring, fixed). Returns ids. */
async function insertTransaction(
  tx: DbExecutor,
  userId: string,
  input: TransactionInputParsed,
  card: Awaited<ReturnType<typeof validateTransactionRefs>>['card'],
  splitGroupId: string | null,
): Promise<string[]> {
  const paymentMethod = input.paymentMethod ?? (card ? 'credit_card' : null);

  const template: RecurrenceTemplate = {
    type: input.type,
    description: input.description,
    amount: input.amount,
    accountId: input.accountId,
    creditCardId: input.creditCardId,
    categoryId: input.categoryId,
    subcategoryId: input.subcategoryId,
    contactId: input.contactId,
    paymentMethod,
    notes: input.notes,
    splitGroupId,
  };
  const paidFields = (date: string) =>
    input.paid ? { paid: true, paidAt: input.paidAt ?? date } : { paid: false, paidAt: null };

  if (input.recurrenceKind === 'single') {
    const [row] = await tx
      .insert(transactions)
      .values({
        userId,
        ...template,
        date: input.date,
        invoiceMonth: invoiceMonthFor(card, input.date),
        recurrenceKind: 'single',
        ...paidFields(input.date),
      })
      .returning({ id: transactions.id });
    return [row!.id];
  }

  const frequency = input.recurrenceKind === 'fixed' ? 'monthly' : input.frequency;
  const count =
    input.recurrenceKind === 'installment'
      ? input.installments!
      : input.recurrenceKind === 'recurring'
        ? (input.occurrences ?? null)
        : null;

  if (count !== null) {
    // Finite series: generate everything now.
    const amounts =
      input.recurrenceKind === 'installment' && input.installmentAmountMode === 'total'
        ? splitInstallments(input.amount, count)
        : Array.from({ length: count }, () => input.amount);
    const [series] = await tx
      .insert(recurrences)
      .values({
        userId,
        kind: input.recurrenceKind,
        frequency,
        startDate: input.date,
        totalOccurrences: count,
        nextIndex: count,
        nextDate: null,
        template: { ...template, amount: amounts[amounts.length - 1]! },
      })
      .returning();
    const dates = buildOccurrenceDates(input.date, frequency, count);
    const rows: NewTransactionRow[] = dates.map((date, i) => ({
      ...occurrenceRow(userId, series!, template, i, date, card),
      amount: amounts[i]!,
      ...(input.recurrenceKind === 'installment' ? { installmentNumber: i + 1, installmentTotal: count } : {}),
      ...(i === 0 ? paidFields(date) : {}),
    }));
    const inserted = await tx.insert(transactions).values(rows).returning({ id: transactions.id });
    return inserted.map((r) => r.id);
  }

  // Open-ended series (fixed monthly or recurring without end): materialize up to the horizon.
  const [series] = await tx
    .insert(recurrences)
    .values({
      userId,
      kind: input.recurrenceKind,
      frequency,
      startDate: input.date,
      totalOccurrences: null,
      nextIndex: 0,
      nextDate: input.date,
      template,
    })
    .returning();
  await materializeSeries(tx, series!, materializationHorizon(), card);
  if (input.paid) {
    await tx
      .update(transactions)
      .set(paidFields(input.date))
      .where(and(eq(transactions.recurrenceId, series!.id), eq(transactions.occurrenceIndex, 0)));
  }
  const rows = await tx
    .select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.recurrenceId, series!.id));
  return rows.map((r) => r.id);
}

// ---------------------------------------------------------------------------
// Update / pay / delete
// ---------------------------------------------------------------------------

const SERIES_FIELDS = [
  'description',
  'amount',
  'accountId',
  'creditCardId',
  'categoryId',
  'subcategoryId',
  'contactId',
  'paymentMethod',
  'notes',
] as const satisfies readonly (keyof TransactionUpdate & keyof RecurrenceTemplate)[];

type SeriesPatch = Partial<Pick<RecurrenceTemplate, (typeof SERIES_FIELDS)[number]>>;

function pickSeriesPatch(input: TransactionUpdate): SeriesPatch {
  const patch: Record<string, unknown> = {};
  for (const key of SERIES_FIELDS) if (input[key] !== undefined) patch[key] = input[key];
  return patch as SeriesPatch;
}

export async function updateTransaction(
  db: Database,
  userId: string,
  id: string,
  input: TransactionUpdate,
  scope: SeriesScope,
): Promise<Transaction> {
  const row = await getTransactionOrThrow(db, userId, id);
  if (row.type === 'transfer') {
    throw new ValidationError('Use a tela de transferências para editar este lançamento');
  }

  const merged = {
    type: row.type as 'income' | 'expense',
    accountId: input.accountId !== undefined ? input.accountId : row.accountId,
    creditCardId: input.creditCardId !== undefined ? input.creditCardId : row.creditCardId,
    categoryId: input.categoryId !== undefined ? input.categoryId : row.categoryId,
    subcategoryId: input.subcategoryId !== undefined ? input.subcategoryId : row.subcategoryId,
    contactId: input.contactId !== undefined ? input.contactId : row.contactId,
  };
  // Changing the category without telling the subcategory drops a now-invalid subcategory.
  if (input.categoryId !== undefined && input.subcategoryId === undefined && input.categoryId !== row.categoryId) {
    merged.subcategoryId = null;
  }
  const { card } = await validateTransactionRefs(db, userId, merged);

  const date = input.date ?? row.date;
  const paid = input.paid ?? row.paid;
  const ownPatch: Partial<NewTransactionRow> = {
    ...pickSeriesPatch(input),
    subcategoryId: merged.subcategoryId,
    date,
    paid,
    paidAt: paid ? (input.paidAt ?? row.paidAt ?? defaultPaidAt(date)) : null,
    invoiceMonth: invoiceMonthFor(card, date),
  };

  await db.transaction(async (tx) => {
    await tx.update(transactions).set(ownPatch).where(eq(transactions.id, row.id));

    if (scope === 'one' || !row.recurrenceId) return;
    const seriesPatch: SeriesPatch = pickSeriesPatch(input);
    if (merged.subcategoryId !== row.subcategoryId) seriesPatch.subcategoryId = merged.subcategoryId;
    if (Object.keys(seriesPatch).length === 0) return;

    const siblingsWhere = and(
      eq(transactions.recurrenceId, row.recurrenceId),
      ne(transactions.id, row.id),
      eq(transactions.paid, false),
      scope === 'future' && row.occurrenceIndex !== null
        ? gt(transactions.occurrenceIndex, row.occurrenceIndex)
        : undefined,
    );

    if (seriesPatch.creditCardId !== undefined) {
      // The invoice depends on each occurrence's date.
      const siblings = await tx.select().from(transactions).where(siblingsWhere);
      for (const s of siblings) {
        await tx
          .update(transactions)
          .set({ ...seriesPatch, invoiceMonth: invoiceMonthFor(card, s.date) })
          .where(eq(transactions.id, s.id));
      }
    } else {
      await tx.update(transactions).set(seriesPatch).where(siblingsWhere);
    }

    // Future materializations follow the new values.
    const [series] = await tx.select().from(recurrences).where(eq(recurrences.id, row.recurrenceId));
    if (series) {
      await tx
        .update(recurrences)
        .set({ template: { ...series.template, ...seriesPatch } })
        .where(eq(recurrences.id, series.id));
    }
  });

  return getTransaction(db, userId, id);
}

export async function setPaid(
  db: Database,
  userId: string,
  id: string,
  input: SetPaidInput,
): Promise<Transaction> {
  const row = await getTransactionOrThrow(db, userId, id);
  if (row.transferKind === 'card_payment') {
    throw new ValidationError('Pagamentos de fatura são gerenciados pela fatura do cartão');
  }
  const patch: Partial<NewTransactionRow> = input.paid
    ? { paid: true, paidAt: input.paidAt ?? defaultPaidAt(row.date) }
    : { paid: false, paidAt: null };

  if (input.accountId) {
    if (row.creditCardId) {
      throw new ValidationError('Compras no cartão são quitadas pelo pagamento da fatura');
    }
    await getAccountOrThrow(db, userId, input.accountId);
    if (row.type !== 'transfer') patch.accountId = input.accountId;
  }

  await db.update(transactions).set(patch).where(eq(transactions.id, row.id));
  return getTransaction(db, userId, id);
}

export async function deleteTransaction(
  db: Database,
  userId: string,
  id: string,
  scope: SeriesScope,
): Promise<void> {
  const row = await getTransactionOrThrow(db, userId, id);
  if (row.type === 'transfer') return deleteTransfer(db, userId, id);

  await db.transaction(async (tx) => {
    if (scope === 'one' || !row.recurrenceId) {
      await tx.delete(transactions).where(eq(transactions.id, row.id));
      if (row.recurrenceId) await cleanupSeries(tx, row.recurrenceId);
      return;
    }

    if (scope === 'all') {
      await tx.delete(transactions).where(eq(transactions.recurrenceId, row.recurrenceId));
      await tx.delete(recurrences).where(eq(recurrences.id, row.recurrenceId));
      return;
    }

    // 'future': this occurrence and the unpaid ones after it; the series stops generating.
    const index = row.occurrenceIndex ?? 0;
    await tx
      .delete(transactions)
      .where(
        and(
          eq(transactions.recurrenceId, row.recurrenceId),
          or(
            eq(transactions.id, row.id),
            and(gt(transactions.occurrenceIndex, index), eq(transactions.paid, false)),
          ),
        ),
      );
    await tx.update(recurrences).set({ nextDate: null }).where(eq(recurrences.id, row.recurrenceId));
    await cleanupSeries(tx, row.recurrenceId);
  });
}

/** Removes a series that no longer has occurrences nor anything left to generate. */
async function cleanupSeries(db: DbExecutor, recurrenceId: string) {
  const [series] = await db.select().from(recurrences).where(eq(recurrences.id, recurrenceId));
  if (!series || series.nextDate) return;
  const [left] = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.recurrenceId, recurrenceId))
    .limit(1);
  if (!left) await db.delete(recurrences).where(eq(recurrences.id, recurrenceId));
}

