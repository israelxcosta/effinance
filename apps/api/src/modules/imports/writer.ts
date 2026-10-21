// Writes imported rows (files and Open Finance syncs) as ordinary transactions of an account or a
// card, tagged with origin, batch and externalId. Idempotent per target: ids already present are
// skipped, and the partial unique indexes of migration 0005 + ON CONFLICT DO NOTHING settle races.

import { and, eq, inArray, isNotNull, type SQL } from 'drizzle-orm';
import type { ISODate, MonthKey, TransactionOrigin } from '@effinance/shared';
import type { DbExecutor } from '../../db/client';
import { importTombstones, transactions, type AccountRow, type CreditCardRow, type NewTransactionRow } from '../../db/schema';
import { paymentMethodHint } from './describe';

export type ResolvedTarget = { kind: 'account'; account: AccountRow } | { kind: 'credit_card'; card: CreditCardRow };

export interface ImportedRow {
  date: ISODate;
  description: string;
  /** Positive cents. */
  amount: number;
  type: 'income' | 'expense';
  externalId: string;
  categoryId: string | null;
  subcategoryId: string | null;
  /** Card purchases: invoice (due month). */
  invoiceMonth?: MonthKey | null;
}

const CHUNK = 500;

export function targetCondition(workspaceId: string, target: ResolvedTarget): SQL {
  return target.kind === 'account'
    ? and(eq(transactions.workspaceId, workspaceId), eq(transactions.accountId, target.account.id))!
    : and(eq(transactions.workspaceId, workspaceId), eq(transactions.creditCardId, target.card.id))!;
}

export interface ExistingImported {
  id: string;
  date: ISODate;
  amount: number;
  type: string;
  paid: boolean;
  invoiceMonth: string | null;
}

/** Transactions of the target that already carry one of `externalIds`. */
export async function existingByExternalId(
  tx: DbExecutor,
  workspaceId: string,
  target: ResolvedTarget,
  externalIds: string[],
): Promise<Map<string, ExistingImported>> {
  const out = new Map<string, ExistingImported>();
  const unique = [...new Set(externalIds)];
  for (let i = 0; i < unique.length; i += CHUNK) {
    const rows = await tx
      .select({
        id: transactions.id,
        externalId: transactions.externalId,
        date: transactions.date,
        amount: transactions.amount,
        type: transactions.type,
        paid: transactions.paid,
        invoiceMonth: transactions.invoiceMonth,
      })
      .from(transactions)
      .where(and(targetCondition(workspaceId, target), inArray(transactions.externalId, unique.slice(i, i + CHUNK))));
    for (const r of rows) if (r.externalId) out.set(r.externalId, r);
  }
  return out;
}

/**
 * Open Finance rows the user removed from this destination (undo, delete): a sync must not
 * recreate them.
 */
export async function tombstonedIds(tx: DbExecutor, workspaceId: string, target: ResolvedTarget, externalIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  const unique = [...new Set(externalIds)];
  const column = target.kind === 'account' ? importTombstones.accountId : importTombstones.creditCardId;
  const id = target.kind === 'account' ? target.account.id : target.card.id;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const rows = await tx
      .select({ externalId: importTombstones.externalId })
      .from(importTombstones)
      .where(and(eq(importTombstones.workspaceId, workspaceId), eq(column, id), inArray(importTombstones.externalId, unique.slice(i, i + CHUNK))));
    for (const r of rows) out.add(r.externalId);
  }
  return out;
}

/** Records removed Open Finance rows (idempotent). */
export async function addTombstones(
  tx: DbExecutor,
  workspaceId: string,
  rows: { accountId: string | null; creditCardId: string | null; externalId: string | null; origin: TransactionOrigin }[],
): Promise<void> {
  const values = rows
    .filter((r) => r.origin === 'open_finance' && r.externalId && (r.accountId || r.creditCardId))
    .map((r) => ({
      workspaceId,
      // Card purchases have no account; account rows no card.
      accountId: r.creditCardId ? null : r.accountId,
      creditCardId: r.creditCardId,
      externalId: r.externalId!,
    }));
  for (let i = 0; i < values.length; i += CHUNK) {
    await tx.insert(importTombstones).values(values.slice(i, i + CHUNK)).onConflictDoNothing();
  }
}

/**
 * Open Finance ids already present in the workspace outside `target` (a row the user moved to another
 * account/card): a sync of the original destination must not create it again.
 */
export async function importedElsewhere(tx: DbExecutor, workspaceId: string, target: ResolvedTarget, externalIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  const unique = [...new Set(externalIds)];
  for (let i = 0; i < unique.length; i += CHUNK) {
    const rows = await tx
      .select({ externalId: transactions.externalId })
      .from(transactions)
      .where(
        and(
          eq(transactions.workspaceId, workspaceId),
          eq(transactions.origin, 'open_finance'),
          isNotNull(transactions.externalId),
          inArray(transactions.externalId, unique.slice(i, i + CHUNK)),
        ),
      );
    for (const r of rows) if (r.externalId) out.add(r.externalId);
  }
  // Rows still in the target itself are compared/updated by the caller (existingByExternalId).
  const own = await existingByExternalId(tx, workspaceId, target, [...out]);
  for (const id of own.keys()) out.delete(id);
  return out;
}

/** Inserts the rows (already filtered) and returns how many were created. */
export async function insertImported(
  tx: DbExecutor,
  workspaceId: string,
  target: ResolvedTarget,
  rows: ImportedRow[],
  batch: { id: string; origin: Exclude<TransactionOrigin, 'manual'> },
): Promise<number> {
  const values: NewTransactionRow[] = rows.map((r) => ({
    workspaceId,
    type: r.type,
    description: r.description,
    amount: r.amount,
    date: r.date,
    categoryId: r.categoryId,
    subcategoryId: r.subcategoryId,
    recurrenceKind: 'single',
    origin: batch.origin,
    importBatchId: batch.id,
    externalId: r.externalId,
    ...(target.kind === 'account'
      ? // Statement lines already happened: paid on their date.
        { accountId: target.account.id, paid: true, paidAt: r.date, paymentMethod: paymentMethodHint(r.description) }
      : // Card purchases are paid with the invoice.
        { creditCardId: target.card.id, invoiceMonth: r.invoiceMonth ?? null, paid: false, paidAt: null, paymentMethod: 'credit_card' as const }),
  }));
  let created = 0;
  for (let i = 0; i < values.length; i += CHUNK) {
    const inserted = await tx
      .insert(transactions)
      .values(values.slice(i, i + CHUNK))
      .onConflictDoNothing()
      .returning({ id: transactions.id });
    created += inserted.length;
  }
  return created;
}
