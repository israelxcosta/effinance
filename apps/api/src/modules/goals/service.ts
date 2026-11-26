import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import {
  parseISODate,
  type Goal,
  type GoalContribution,
  type goalContributionInputSchema,
  type goalInputSchema,
} from '@effinance/shared';
import type { z } from 'zod';
import type { DbExecutor } from '../../db/client';
import { accounts, goalContributions, goals, transactions, type GoalContributionRow, type GoalRow } from '../../db/schema';
import { today } from '../../lib/clock';
import { getCipher } from '../../lib/crypto/keyring';
import { NotFoundError, ValidationError } from '../../lib/errors';
import { sumOf } from '../../lib/sql';
import { getAccountOrThrow, getGoalOrThrow } from '../common/ownership';
import { createTransfer } from '../transfers/service';

type GoalInput = z.output<typeof goalInputSchema>;
type ContributionInput = z.output<typeof goalContributionInputSchema>;

// Free-text notes are encrypted with the workspace key.
async function sealNote(workspaceId: string, table: string, column: string, value: string | null | undefined) {
  if (value === null || value === undefined) return value ?? null;
  return (await getCipher(workspaceId)).encrypt(table, column, value);
}

async function openNote(workspaceId: string, table: string, column: string, value: string | null) {
  return value === null ? null : (await getCipher(workspaceId)).decrypt(table, column, value);
}

/** Whole months left until the deadline (the current month counts). */
function monthsUntil(from: string, to: string): number {
  const a = parseISODate(from);
  const b = parseISODate(to);
  return (b.year - a.year) * 12 + (b.month - a.month) + 1;
}

/** Expects `row.notes` already decrypted (see toGoals). */
export function toGoal(row: GoalRow, currentAmount: number, now = today()): Goal {
  const remaining = Math.max(0, row.targetAmount - currentAmount);
  let monthlyNeeded: number | null = null;
  if (row.deadline) {
    const months = Math.max(1, monthsUntil(now, row.deadline));
    monthlyNeeded = row.deadline < now ? remaining : Math.ceil(remaining / months);
  }
  return {
    id: row.id,
    name: row.name,
    targetAmount: row.targetAmount,
    deadline: row.deadline,
    icon: row.icon,
    color: row.color,
    accountId: row.accountId,
    notes: row.notes,
    archived: row.archived,
    createdAt: row.createdAt.toISOString(),
    currentAmount,
    progress: row.targetAmount > 0 ? Math.min(1, Math.max(0, currentAmount / row.targetAmount)) : 0,
    monthlyNeeded,
    completed: currentAmount >= row.targetAmount,
  };
}

export async function toGoals(db: DbExecutor, rows: GoalRow[]): Promise<Goal[]> {
  if (rows.length === 0) return [];
  const sums = await db
    .select({ goalId: goalContributions.goalId, total: sumOf(goalContributions.amount) })
    .from(goalContributions)
    .where(inArray(goalContributions.goalId, rows.map((r) => r.id)))
    .groupBy(goalContributions.goalId);
  const map = new Map(sums.map((s) => [s.goalId, s.total]));
  const now = today();
  return Promise.all(
    rows.map(async (r) =>
      toGoal({ ...r, notes: await openNote(r.workspaceId, 'goals', 'notes', r.notes) }, map.get(r.id) ?? 0, now),
    ),
  );
}

export async function listGoals(db: DbExecutor, workspaceId: string, includeArchived = true): Promise<Goal[]> {
  const rows = await db
    .select()
    .from(goals)
    .where(and(eq(goals.workspaceId, workspaceId), includeArchived ? undefined : eq(goals.archived, false)))
    .orderBy(asc(goals.archived), asc(goals.deadline), asc(goals.createdAt));
  return toGoals(db, rows);
}

async function getGoal(db: DbExecutor, workspaceId: string, id: string) {
  const row = await getGoalOrThrow(db, workspaceId, id);
  const [goal] = await toGoals(db, [row]);
  return goal!;
}

/** Where a goal's money is kept: an Aplicação (investment) or a savings account. */
async function checkGoalAccount(db: DbExecutor, workspaceId: string, accountId: string | null) {
  if (!accountId) return;
  const account = await getAccountOrThrow(db, workspaceId, accountId);
  if (account.type !== 'investment' && account.type !== 'savings') {
    throw new ValidationError('Escolha uma aplicação (conta de investimento ou poupança)');
  }
}

export async function createGoal(db: DbExecutor, workspaceId: string, input: GoalInput) {
  await checkGoalAccount(db, workspaceId, input.accountId);
  const [row] = await db
    .insert(goals)
    .values({ workspaceId, ...input, notes: await sealNote(workspaceId, 'goals', 'notes', input.notes) })
    .returning();
  return toGoal({ ...row!, notes: input.notes ?? null }, 0);
}

export async function updateGoal(db: DbExecutor, workspaceId: string, id: string, input: GoalInput) {
  const current = await getGoalOrThrow(db, workspaceId, id);
  // Goals linked before this rule keep their account until it changes.
  if (input.accountId !== current.accountId) await checkGoalAccount(db, workspaceId, input.accountId);
  await db
    .update(goals)
    .set({ ...input, notes: await sealNote(workspaceId, 'goals', 'notes', input.notes) })
    .where(eq(goals.id, id));
  return getGoal(db, workspaceId, id);
}

export async function deleteGoal(db: DbExecutor, workspaceId: string, id: string) {
  await getGoalOrThrow(db, workspaceId, id);
  await db.delete(goals).where(eq(goals.id, id));
}

async function toContributions(db: DbExecutor, workspaceId: string, rows: GoalContributionRow[]): Promise<GoalContribution[]> {
  // The current account is the other side of the linked transfer (ids come from the server).
  const transferIds = rows.map((r) => r.transferId).filter((v): v is string => Boolean(v));
  const links = transferIds.length
    ? await db
        .select({ id: transactions.id, from: transactions.accountId, to: transactions.toAccountId })
        .from(transactions)
        .where(and(eq(transactions.workspaceId, workspaceId), inArray(transactions.id, transferIds)))
    : [];
  const otherIds = new Set<string>();
  const sideOf = new Map<string, string | null>();
  for (const row of rows) {
    const link = links.find((l) => l.id === row.transferId);
    if (!link) continue;
    // Saving: current account → goal account (from). Withdrawal: goal account → current account (to).
    const other = row.amount >= 0 ? link.from : link.to;
    sideOf.set(row.id, other);
    if (other) otherIds.add(other);
  }
  const names = otherIds.size
    ? new Map(
        (
          await db
            .select({ id: accounts.id, name: accounts.name })
            .from(accounts)
            .where(and(eq(accounts.workspaceId, workspaceId), inArray(accounts.id, [...otherIds])))
        ).map((a) => [a.id, a.name]),
      )
    : new Map<string, string>();
  return Promise.all(
    rows.map(async (row) => {
      const other = sideOf.get(row.id);
      return {
        id: row.id,
        goalId: row.goalId,
        amount: row.amount,
        date: row.date,
        note: await openNote(row.workspaceId, 'goal_contributions', 'note', row.note),
        transferId: row.transferId,
        account: other && names.has(other) ? { id: other, name: names.get(other)! } : null,
        createdAt: row.createdAt.toISOString(),
      };
    }),
  );
}

export async function listContributions(db: DbExecutor, workspaceId: string, goalId: string) {
  await getGoalOrThrow(db, workspaceId, goalId);
  const rows = await db
    .select()
    .from(goalContributions)
    .where(and(eq(goalContributions.workspaceId, workspaceId), eq(goalContributions.goalId, goalId)))
    .orderBy(desc(goalContributions.date), desc(goalContributions.createdAt));
  return toContributions(db, workspaceId, rows);
}

/** Saving books an Aplicação (current account → goal account); a withdrawal books the Resgate back. */
async function bookTransfer(db: DbExecutor, workspaceId: string, goal: GoalRow, input: ContributionInput): Promise<string | null> {
  if (!input.accountId) return null;
  if (!goal.accountId) throw new ValidationError('Vincule a meta a uma aplicação para transferir o dinheiro');
  const current = await getAccountOrThrow(db, workspaceId, input.accountId);
  if (current.id === goal.accountId) throw new ValidationError('Escolha uma conta diferente da aplicação da meta');
  if (current.type === 'investment') throw new ValidationError('Use uma conta corrente, poupança ou carteira');
  const saving = input.amount > 0;
  const transfer = await createTransfer(db, workspaceId, {
    fromAccountId: saving ? current.id : goal.accountId,
    toAccountId: saving ? goal.accountId : current.id,
    amount: Math.abs(input.amount),
    date: input.date,
    description: `${saving ? 'Aporte' : 'Retirada'} · ${goal.name}`.slice(0, 120),
    notes: null,
    paid: true,
  });
  return transfer.id;
}

export async function addContribution(db: DbExecutor, workspaceId: string, goalId: string, input: ContributionInput) {
  const goal = await getGoalOrThrow(db, workspaceId, goalId);
  const row = await db.transaction(async (tx) => {
    const transferId = await bookTransfer(tx, workspaceId, goal, input);
    const { accountId: _account, ...values } = input;
    const [created] = await tx
      .insert(goalContributions)
      .values({
        workspaceId,
        goalId,
        ...values,
        transferId,
        note: await sealNote(workspaceId, 'goal_contributions', 'note', input.note),
      })
      .returning();
    return created!;
  });
  return (await toContributions(db, workspaceId, [row]))[0]!;
}

export async function deleteContribution(db: DbExecutor, workspaceId: string, goalId: string, id: string) {
  await getGoalOrThrow(db, workspaceId, goalId);
  await db.transaction(async (tx) => {
    const deleted = await tx
      .delete(goalContributions)
      .where(and(eq(goalContributions.id, id), eq(goalContributions.goalId, goalId), eq(goalContributions.workspaceId, workspaceId)))
      .returning({ transferId: goalContributions.transferId });
    if (deleted.length === 0) throw new NotFoundError('Aporte não encontrado');
    // The money goes back: the linked transfer is removed with the contribution.
    const transferId = deleted[0]!.transferId;
    if (transferId) {
      await tx
        .delete(transactions)
        .where(and(eq(transactions.workspaceId, workspaceId), eq(transactions.id, transferId), eq(transactions.type, 'transfer')));
    }
  });
}
