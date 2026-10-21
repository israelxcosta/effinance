// File imports (OFX / CSV): preview with duplicate detection, category suggestions and card-bill
// heuristics; commit into an account or a card as one batch; list and undo batches.

import { and, between, count, desc, eq, inArray } from 'drizzle-orm';
import {
  MAX_IMPORT_ROWS,
  type ImportBatch,
  type ImportPreview,
  type ImportPreviewRow,
  type ImportTarget,
  type Paginated,
  type importCommitSchema,
  type importListQuerySchema,
  type importPreviewSchema,
} from '@effinance/shared';
import type { z } from 'zod';
import type { DbExecutor } from '../../db/client';
import { categories, importBatches, transactions, users, workspaceMembers, type ImportBatchRow } from '../../db/schema';
import { NotFoundError, ValidationError } from '../../lib/errors';
import { inTenant } from '../../lib/tenant-scope';
import { getAccountOrThrow, getCardOrThrow } from '../common/ownership';
import { invoiceMonthFor } from '../transactions/series';
import { installmentHint, isCardBillPayment, normalizeDescription } from './describe';
import { ImportParseError, parseImportFile, type ParsedRow } from './parse';
import { loadCategorySuggester } from './suggest';
import { addTombstones, existingByExternalId, insertImported, targetCondition, type ImportedRow, type ResolvedTarget } from './writer';

type PreviewInput = z.output<typeof importPreviewSchema>;
type CommitInput = z.output<typeof importCommitSchema>;
type ListQuery = z.output<typeof importListQuerySchema>;

export async function resolveTarget(tx: DbExecutor, workspaceId: string, target: ImportTarget): Promise<ResolvedTarget> {
  return target.kind === 'account'
    ? { kind: 'account', account: await getAccountOrThrow(tx, workspaceId, target.accountId) }
    : { kind: 'credit_card', card: await getCardOrThrow(tx, workspaceId, target.creditCardId) };
}

export const NOTES = {
  zero: 'Valor zerado',
  imported: 'Já importado',
  duplicate: 'Possível duplicado de um lançamento já registrado',
  cardBillPayment: 'Pagamento de fatura',
  accountBillPayment: 'Pagamento de fatura de cartão — registre pela fatura do cartão',
  cardCredit: 'Estorno ou crédito no cartão — a fatura soma só compras; ajuste a compra original',
} as const;

const contentKey = (date: string, type: string, amount: number, description: string) =>
  `${date}|${type}|${amount}|${normalizeDescription(description)}`;

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

export async function previewImport(db: DbExecutor, workspaceId: string, input: PreviewInput): Promise<ImportPreview> {
  let parsed;
  try {
    parsed = await parseImportFile({ content: input.content, format: input.format, csv: input.csv });
  } catch (error) {
    if (error instanceof ImportParseError) throw new ValidationError(error.message);
    throw error;
  }
  if (parsed.rows.length > MAX_IMPORT_ROWS) {
    throw new ValidationError(
      `O arquivo tem ${parsed.rows.length} lançamentos; o limite por importação é ${MAX_IMPORT_ROWS}. Exporte um período menor.`,
    );
  }
  if (parsed.csvMapping) {
    const width = parsed.csvColumns?.length ?? 0;
    const m = parsed.csvMapping;
    const used = [m.dateColumn, m.descriptionColumn, m.amountColumn, m.debitColumn, m.creditColumn, m.idColumn ?? null];
    if (used.some((c) => c !== null && c >= width)) throw new ValidationError('O mapeamento usa uma coluna que não existe no arquivo');
  }

  return inTenant(db, workspaceId, async (tx) => {
    const target = await resolveTarget(tx, workspaceId, input.target);
    const onCard = target.kind === 'credit_card';
    const [suggester, matches] = await Promise.all([
      loadCategorySuggester(tx, workspaceId),
      findDuplicates(tx, workspaceId, target, parsed.rows),
    ]);

    const rows: ImportPreviewRow[] = parsed.rows.map((r) => {
      const type = r.amount > 0 ? 'income' : 'expense';
      const amount = Math.abs(r.amount);
      const match = matches.get(r.index) ?? null;
      const billPayment = isCardBillPayment(r.description);
      let note: string | null = null;
      if (match) note = match.byExternalId ? NOTES.imported : NOTES.duplicate;
      else if (amount === 0) note = NOTES.zero;
      else if (billPayment && (onCard ? type === 'income' : type === 'expense')) note = onCard ? NOTES.cardBillPayment : NOTES.accountBillPayment;
      else if (onCard && type === 'income') note = NOTES.cardCredit;
      return {
        index: r.index,
        date: r.date,
        description: r.description,
        amount,
        type,
        externalId: r.externalId,
        duplicate: match !== null,
        duplicateKind: match ? (match.byExternalId ? 'imported' : 'similar') : null,
        duplicateTransactionId: match?.transactionId ?? null,
        categoryId: note && note !== NOTES.duplicate && note !== NOTES.imported ? null : suggester.suggest(r.description, type),
        installment: installmentHint(r.description, onCard),
        skip: note !== null,
        note,
      };
    });

    const totals = { count: rows.length, income: 0, expense: 0, duplicates: 0 };
    for (const r of rows) {
      if (r.type === 'income') totals.income += r.amount;
      else totals.expense += r.amount;
      if (r.duplicate) totals.duplicates += 1;
    }
    return {
      format: parsed.format,
      fileName: input.fileName,
      target: input.target,
      institution: parsed.institution,
      accountHint: parsed.accountHint,
      period: parsed.period,
      csvColumns: parsed.csvColumns,
      csvMapping: parsed.csvMapping,
      rows,
      totals,
    };
  });
}

/**
 * Rows of the file that already exist in the target: same externalId (imported before), or a row of
 * any origin with the same date, type, amount and normalized description (typed by hand, or imported
 * from another source). Each existing row matches at most one row of the file.
 */
async function findDuplicates(
  tx: DbExecutor,
  workspaceId: string,
  target: ResolvedTarget,
  rows: ParsedRow[],
): Promise<Map<number, { transactionId: string; byExternalId: boolean }>> {
  const out = new Map<number, { transactionId: string; byExternalId: boolean }>();
  if (rows.length === 0) return out;
  const byId = await existingByExternalId(tx, workspaceId, target, rows.map((r) => r.externalId));
  const used = new Set<string>();
  for (const r of rows) {
    const hit = byId.get(r.externalId);
    if (hit && !used.has(hit.id)) {
      used.add(hit.id);
      out.set(r.index, { transactionId: hit.id, byExternalId: true });
    }
  }
  const dates = rows.map((r) => r.date).sort();
  const candidates = await tx
    .select({
      id: transactions.id,
      date: transactions.date,
      type: transactions.type,
      amount: transactions.amount,
      description: transactions.description,
    })
    .from(transactions)
    .where(
      and(
        targetCondition(workspaceId, target),
        inArray(transactions.type, ['income', 'expense']),
        between(transactions.date, dates[0]!, dates[dates.length - 1]!),
      ),
    );
  const pool = new Map<string, string[]>();
  for (const c of candidates) {
    if (used.has(c.id)) continue;
    const key = contentKey(c.date, c.type, c.amount, c.description);
    pool.set(key, [...(pool.get(key) ?? []), c.id]);
  }
  for (const r of rows) {
    if (out.has(r.index)) continue;
    const key = contentKey(r.date, r.amount > 0 ? 'income' : 'expense', Math.abs(r.amount), r.description);
    const id = pool.get(key)?.shift();
    if (id) out.set(r.index, { transactionId: id, byExternalId: false });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------

export interface CommitResult {
  batch: ImportBatchRow;
  created: number;
  skipped: number;
}

export async function commitImport(
  db: DbExecutor,
  workspaceId: string,
  userId: string,
  input: CommitInput,
): Promise<CommitResult> {
  return inTenant(db, workspaceId, async (tx) => {
    const target = await resolveTarget(tx, workspaceId, input.target);
    if (target.kind === 'credit_card') {
      const credits = input.rows.flatMap((r, i) => (r.type === 'income' ? [i] : []));
      if (credits.length > 0) {
        throw new ValidationError(
          'Estornos e créditos do cartão não podem ser importados: a fatura soma apenas compras. Desmarque essas linhas.',
          { rows: credits },
        );
      }
    }
    const categoryOf = await resolveCategories(tx, workspaceId, input.rows);

    // Already in the target (re-import) or repeated in the request: skipped, never duplicated.
    const existing = await existingByExternalId(tx, workspaceId, target, input.rows.map((r) => r.externalId));
    const seen = new Set<string>();
    const fresh: ImportedRow[] = [];
    for (const r of input.rows) {
      if (existing.has(r.externalId) || seen.has(r.externalId)) continue;
      seen.add(r.externalId);
      const category = r.categoryId ? categoryOf(r.categoryId, r.type) : { categoryId: null, subcategoryId: null };
      fresh.push({
        date: r.date,
        description: r.description,
        amount: r.amount,
        type: r.type,
        externalId: r.externalId,
        ...category,
        invoiceMonth:
          target.kind === 'credit_card' ? (input.target.kind === 'credit_card' && input.target.invoiceMonth) || invoiceMonthFor(target.card, r.date) : null,
      });
    }

    const [batch] = await tx
      .insert(importBatches)
      .values({
        workspaceId,
        origin: 'file',
        format: input.format,
        fileName: input.fileName,
        accountId: target.kind === 'account' ? target.account.id : null,
        creditCardId: target.kind === 'credit_card' ? target.card.id : null,
        invoiceMonth: input.target.kind === 'credit_card' ? (input.target.invoiceMonth ?? null) : null,
        createdBy: userId,
      })
      .returning();
    const created = fresh.length ? await insertImported(tx, workspaceId, target, fresh, { id: batch!.id, origin: 'file' }) : 0;
    const skipped = input.rows.length - created;
    const [updated] = await tx
      .update(importBatches)
      .set({ createdCount: created, skippedCount: skipped })
      .where(eq(importBatches.id, batch!.id))
      .returning();
    return { batch: updated!, created, skipped };
  });
}

/** Validates the chosen (sub)categories in one query: owned, and of the row's type. */
async function resolveCategories(
  tx: DbExecutor,
  workspaceId: string,
  rows: { categoryId: string | null; type: 'income' | 'expense' }[],
) {
  const ids = [...new Set(rows.map((r) => r.categoryId).filter((id): id is string => id !== null))];
  const found = ids.length
    ? await tx
        .select({ id: categories.id, parentId: categories.parentId, type: categories.type })
        .from(categories)
        .where(and(eq(categories.workspaceId, workspaceId), inArray(categories.id, ids)))
    : [];
  if (found.length !== ids.length) throw new NotFoundError('Categoria não encontrada');
  const byId = new Map(found.map((c) => [c.id, c]));
  for (const r of rows) {
    if (r.categoryId && byId.get(r.categoryId)!.type !== r.type) {
      throw new ValidationError(r.type === 'income' ? 'Escolha categorias de receita para as entradas' : 'Escolha categorias de despesa para as saídas');
    }
  }
  return (id: string, _type: 'income' | 'expense') => {
    const c = byId.get(id)!;
    return c.parentId ? { categoryId: c.parentId, subcategoryId: c.id } : { categoryId: c.id, subcategoryId: null };
  };
}

// ---------------------------------------------------------------------------
// Batches
// ---------------------------------------------------------------------------

/** Names of the given users that are (still) members of the workspace. System connection. */
export async function memberNames(db: DbExecutor, workspaceId: string, userIds: (string | null)[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter((id): id is string => id !== null))];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .innerJoin(workspaceMembers, and(eq(workspaceMembers.userId, users.id), eq(workspaceMembers.workspaceId, workspaceId)))
    .where(inArray(users.id, ids));
  return new Map(rows.map((r) => [r.id, r.name]));
}

export function toImportBatch(row: ImportBatchRow, remaining: number, names: Map<string, string>): ImportBatch {
  return {
    id: row.id,
    origin: row.origin,
    format: row.format,
    fileName: row.fileName,
    connectionId: row.connectionId,
    accountId: row.accountId,
    creditCardId: row.creditCardId,
    invoiceMonth: row.invoiceMonth,
    createdCount: row.createdCount,
    skippedCount: row.skippedCount,
    remainingCount: remaining,
    createdByName: row.createdBy ? (names.get(row.createdBy) ?? null) : null,
    createdAt: row.createdAt.toISOString(),
    undoneAt: row.undoneAt?.toISOString() ?? null,
  };
}

async function remainingCounts(tx: DbExecutor, batchIds: string[]): Promise<Map<string, number>> {
  if (batchIds.length === 0) return new Map();
  const rows = await tx
    .select({ batchId: transactions.importBatchId, n: count() })
    .from(transactions)
    .where(inArray(transactions.importBatchId, batchIds))
    .groupBy(transactions.importBatchId);
  return new Map(rows.map((r) => [r.batchId!, Number(r.n)]));
}

export async function describeBatch(db: DbExecutor, workspaceId: string, row: ImportBatchRow, remaining: number): Promise<ImportBatch> {
  return toImportBatch(row, remaining, await memberNames(db, workspaceId, [row.createdBy]));
}

export async function listImports(db: DbExecutor, workspaceId: string, q: ListQuery): Promise<Paginated<ImportBatch>> {
  const { rows, total, remaining } = await inTenant(db, workspaceId, async (tx) => {
    const where = eq(importBatches.workspaceId, workspaceId);
    const [rows, [totalRow]] = await Promise.all([
      tx
        .select()
        .from(importBatches)
        .where(where)
        .orderBy(desc(importBatches.createdAt), desc(importBatches.id))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      tx.select({ n: count() }).from(importBatches).where(where),
    ]);
    return { rows, total: Number(totalRow?.n ?? 0), remaining: await remainingCounts(tx, rows.map((r) => r.id)) };
  });
  const names = await memberNames(db, workspaceId, rows.map((r) => r.createdBy));
  return {
    items: rows.map((r) => toImportBatch(r, remaining.get(r.id) ?? 0, names)),
    total,
    page: q.page,
    pageSize: q.pageSize,
  };
}

/**
 * Undo: removes what is left of the batch (rows edited since are removed too). The batch stays in
 * the history (`undoneAt`, remainingCount 0). Open Finance rows get tombstones, so the next sync —
 * which re-reads a week of history — does not bring them back. Repeating is a no-op.
 */
export async function undoImport(
  db: DbExecutor,
  workspaceId: string,
  id: string,
): Promise<{ removed: number; origin: string; alreadyUndone: boolean }> {
  return inTenant(db, workspaceId, async (tx) => {
    const [batch] = await tx
      .select()
      .from(importBatches)
      .where(and(eq(importBatches.workspaceId, workspaceId), eq(importBatches.id, id)))
      .for('update');
    if (!batch) throw new NotFoundError('Importação não encontrada');
    if (batch.undoneAt) return { removed: 0, origin: batch.origin, alreadyUndone: true };
    const removed = await tx
      .delete(transactions)
      .where(and(eq(transactions.workspaceId, workspaceId), eq(transactions.importBatchId, id)))
      .returning({
        accountId: transactions.accountId,
        creditCardId: transactions.creditCardId,
        externalId: transactions.externalId,
        origin: transactions.origin,
      });
    await addTombstones(tx, workspaceId, removed);
    await tx.update(importBatches).set({ undoneAt: new Date() }).where(eq(importBatches.id, id));
    return { removed: removed.length, origin: batch.origin, alreadyUndone: false };
  });
}
