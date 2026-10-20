import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import {
  parseISODate,
  type Goal,
  type GoalContribution,
  type goalContributionInputSchema,
  type goalInputSchema,
} from '@effinance/shared';
import type { z } from 'zod';
import type { Database, DbExecutor } from '../../db/client';
import { goalContributions, goals, type GoalContributionRow, type GoalRow } from '../../db/schema';
import { today } from '../../lib/clock';
import { NotFoundError } from '../../lib/errors';
import { sumOf } from '../../lib/sql';
import { getAccountOrThrow, getGoalOrThrow } from '../common/ownership';

type GoalInput = z.output<typeof goalInputSchema>;
type ContributionInput = z.output<typeof goalContributionInputSchema>;

/** Whole months left until the deadline (the current month counts). */
function monthsUntil(from: string, to: string): number {
  const a = parseISODate(from);
  const b = parseISODate(to);
  return (b.year - a.year) * 12 + (b.month - a.month) + 1;
}

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
  return rows.map((r) => toGoal(r, map.get(r.id) ?? 0, now));
}

export async function listGoals(db: DbExecutor, userId: string, includeArchived = true): Promise<Goal[]> {
  const rows = await db
    .select()
    .from(goals)
    .where(and(eq(goals.userId, userId), includeArchived ? undefined : eq(goals.archived, false)))
    .orderBy(asc(goals.archived), asc(goals.deadline), asc(goals.createdAt));
  return toGoals(db, rows);
}

async function getGoal(db: Database, userId: string, id: string) {
  const row = await getGoalOrThrow(db, userId, id);
  const [goal] = await toGoals(db, [row]);
  return goal!;
}

export async function createGoal(db: Database, userId: string, input: GoalInput) {
  if (input.accountId) await getAccountOrThrow(db, userId, input.accountId);
  const [row] = await db.insert(goals).values({ userId, ...input }).returning();
  return toGoal(row!, 0);
}

export async function updateGoal(db: Database, userId: string, id: string, input: GoalInput) {
  await getGoalOrThrow(db, userId, id);
  if (input.accountId) await getAccountOrThrow(db, userId, input.accountId);
  await db.update(goals).set(input).where(eq(goals.id, id));
  return getGoal(db, userId, id);
}

export async function deleteGoal(db: Database, userId: string, id: string) {
  await getGoalOrThrow(db, userId, id);
  await db.delete(goals).where(eq(goals.id, id));
}

function toContribution(row: GoalContributionRow): GoalContribution {
  return {
    id: row.id,
    goalId: row.goalId,
    amount: row.amount,
    date: row.date,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listContributions(db: Database, userId: string, goalId: string) {
  await getGoalOrThrow(db, userId, goalId);
  const rows = await db
    .select()
    .from(goalContributions)
    .where(eq(goalContributions.goalId, goalId))
    .orderBy(desc(goalContributions.date), desc(goalContributions.createdAt));
  return rows.map(toContribution);
}

export async function addContribution(db: Database, userId: string, goalId: string, input: ContributionInput) {
  await getGoalOrThrow(db, userId, goalId);
  const [row] = await db
    .insert(goalContributions)
    .values({ userId, goalId, ...input })
    .returning();
  return toContribution(row!);
}

export async function deleteContribution(db: Database, userId: string, goalId: string, id: string) {
  await getGoalOrThrow(db, userId, goalId);
  const deleted = await db
    .delete(goalContributions)
    .where(and(eq(goalContributions.id, id), eq(goalContributions.goalId, goalId), eq(goalContributions.userId, userId)))
    .returning({ id: goalContributions.id });
  if (deleted.length === 0) throw new NotFoundError('Aporte não encontrado');
}
