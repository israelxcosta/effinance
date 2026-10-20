import { and, desc, eq, gte, lte, or, type SQL } from 'drizzle-orm';
import {
  TRANSFER_KIND_LABELS,
  type Paginated,
  type Transaction,
  type TransferKind,
  type transferInputSchema,
  type transferQuerySchema,
} from '@effinance/shared';
import type { z } from 'zod';
import type { DbExecutor } from '../../db/client';
import { transactions, type AccountRow } from '../../db/schema';
import { ValidationError } from '../../lib/errors';
import { countAll } from '../../lib/sql';
import { getAccountOrThrow, getTransactionOrThrow } from '../common/ownership';
import { toTransactions } from '../transactions/mapper';
import { encryptNotes } from '../transactions/notes';
import { ensureMaterialized } from '../transactions/series';

type TransferInput = z.output<typeof transferInputSchema>;
type TransferQuery = z.output<typeof transferQuerySchema>;

/** Money going into an investment account is an "aplicação"; coming out of one is a "resgate". */
export function deriveTransferKind(from: AccountRow, to: AccountRow): TransferKind {
  const fromInv = from.type === 'investment';
  const toInv = to.type === 'investment';
  if (toInv && !fromInv) return 'investment';
  if (fromInv && !toInv) return 'redemption';
  return 'transfer';
}

function defaultDescription(kind: TransferKind, from: AccountRow, to: AccountRow) {
  switch (kind) {
    case 'investment':
      return `Aplicação em ${to.name}`;
    case 'redemption':
      return `Resgate de ${from.name}`;
    default:
      return `${TRANSFER_KIND_LABELS.transfer} para ${to.name}`;
  }
}

async function buildTransferRow(db: DbExecutor, workspaceId: string, input: TransferInput) {
  const [from, to] = await Promise.all([
    getAccountOrThrow(db, workspaceId, input.fromAccountId),
    getAccountOrThrow(db, workspaceId, input.toAccountId),
  ]);
  const kind = deriveTransferKind(from, to);
  return {
    type: 'transfer' as const,
    description: input.description ?? defaultDescription(kind, from, to),
    amount: input.amount,
    date: input.date,
    paid: input.paid,
    paidAt: input.paid ? input.date : null,
    accountId: from.id,
    toAccountId: to.id,
    creditCardId: null,
    invoiceMonth: null,
    categoryId: null,
    subcategoryId: null,
    contactId: null,
    paymentMethod: 'transfer' as const,
    notes: await encryptNotes(workspaceId, input.notes ?? null),
    transferKind: kind,
  };
}

export async function createTransfer(db: DbExecutor, workspaceId: string, input: TransferInput): Promise<Transaction> {
  const values = await buildTransferRow(db, workspaceId, input);
  const [row] = await db
    .insert(transactions)
    .values({ workspaceId, ...values, recurrenceKind: 'single' })
    .returning();
  const [dto] = await toTransactions(db, [row!]);
  return dto!;
}

export async function updateTransfer(
  db: DbExecutor,
  workspaceId: string,
  id: string,
  input: TransferInput,
): Promise<Transaction> {
  const current = await getTransactionOrThrow(db, workspaceId, id);
  if (current.type !== 'transfer') throw new ValidationError('Este lançamento não é uma transferência');
  if (current.transferKind === 'card_payment') {
    throw new ValidationError('Pagamentos de fatura são gerenciados pela fatura do cartão');
  }
  const values = await buildTransferRow(db, workspaceId, input);
  const [row] = await db.update(transactions).set(values).where(eq(transactions.id, id)).returning();
  const [dto] = await toTransactions(db, [row!]);
  return dto!;
}

/** Deleting an invoice payment reopens the purchases of that invoice. */
export async function deleteTransfer(db: DbExecutor, workspaceId: string, id: string): Promise<void> {
  const row = await getTransactionOrThrow(db, workspaceId, id);
  if (row.type !== 'transfer') throw new ValidationError('Este lançamento não é uma transferência');

  await db.transaction(async (tx) => {
    if (row.transferKind === 'card_payment' && row.creditCardId && row.invoiceMonth) {
      await tx
        .update(transactions)
        .set({ paid: false, paidAt: null })
        .where(
          and(
            eq(transactions.workspaceId, workspaceId),
            eq(transactions.type, 'expense'),
            eq(transactions.creditCardId, row.creditCardId),
            eq(transactions.invoiceMonth, row.invoiceMonth),
          ),
        );
    }
    await tx.delete(transactions).where(eq(transactions.id, row.id));
  });
}

export async function listTransfers(
  db: DbExecutor,
  workspaceId: string,
  q: TransferQuery,
): Promise<Paginated<Transaction>> {
  await ensureMaterialized(db, workspaceId, q.to);
  const where: SQL[] = [eq(transactions.workspaceId, workspaceId), eq(transactions.type, 'transfer')];
  if (q.from) where.push(gte(transactions.date, q.from));
  if (q.to) where.push(lte(transactions.date, q.to));
  if (q.kind) where.push(eq(transactions.transferKind, q.kind));
  if (q.accountId) {
    where.push(or(eq(transactions.accountId, q.accountId), eq(transactions.toAccountId, q.accountId))!);
  }
  const condition = and(...where);
  const [rows, [count]] = await Promise.all([
    db
      .select()
      .from(transactions)
      .where(condition)
      .orderBy(desc(transactions.date), desc(transactions.createdAt))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db.select({ total: countAll() }).from(transactions).where(condition),
  ]);
  return {
    items: await toTransactions(db, rows),
    total: count?.total ?? 0,
    page: q.page,
    pageSize: q.pageSize,
  };
}
