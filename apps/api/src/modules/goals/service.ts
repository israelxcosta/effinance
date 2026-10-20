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
import { goalContributions, goals, type GoalContributionRow, type GoalRow } from '../../db/schema';
import { today } from '../../lib/clock';
import { getCipher } from '../../lib/crypto/keyring';
import { NotFoundError } from '../../lib/errors';
import { sumOf } from '../../lib/sql';
import { getAccountOrThrow, getGoalOrThrow } from '../common/ownership';

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

export async function createGoal(db: DbExecutor, workspaceId: string, input: GoalInput) {
  if (input.accountId) await getAccountOrThrow(db, workspaceId, input.accountId);
  const [row] = await db
    .insert(goals)
    .values({ workspaceId, ...input, notes: await sealNote(workspaceId, 'goals', 'notes', input.notes) })
    .returning();
  return toGoal({ ...row!, notes: input.notes ?? null }, 0);
}

export async function updateGoal(db: DbExecutor, workspaceId: string, id: string, input: GoalInput) {
  await getGoalOrThrow(db, workspaceId, id);
  if (input.accountId) await getAccountOrThrow(db, workspaceId, input.accountId);
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

async function toContribution(row: GoalContributionRow): Promise<GoalContribution> {
  return {
    id: row.id,
    goalId: row.goalId,
    amount: row.amount,
    date: row.date,
    note: await openNote(row.workspaceId, 'goal_contributions', 'note', row.note),
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listContributions(db: DbExecutor, workspaceId: string, goalId: string) {
  await getGoalOrThrow(db, workspaceId, goalId);
  const rows = await db
    .select()
    .from(goalContributions)
    .where(eq(goalContributions.goalId, goalId))
    .orderBy(desc(goalContributions.date), desc(goalContributions.createdAt));
  return Promise.all(rows.map(toContribution));
}

export async function addContribution(db: DbExecutor, workspaceId: string, goalId: string, input: ContributionInput) {
  await getGoalOrThrow(db, workspaceId, goalId);
  const [row] = await db
    .insert(goalContributions)
    .values({
      workspaceId,
      goalId,
      ...input,
      note: await sealNote(workspaceId, 'goal_contributions', 'note', input.note),
    })
    .returning();
  return toContribution(row!);
}

export async function deleteContribution(db: DbExecutor, workspaceId: string, goalId: string, id: string) {
  await getGoalOrThrow(db, workspaceId, goalId);
  const deleted = await db
    .delete(goalContributions)
    .where(and(eq(goalContributions.id, id), eq(goalContributions.goalId, goalId), eq(goalContributions.workspaceId, workspaceId)))
    .returning({ id: goalContributions.id });
  if (deleted.length === 0) throw new NotFoundError('Aporte não encontrado');
}
