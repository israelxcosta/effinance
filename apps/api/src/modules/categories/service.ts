import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';
import type {
  Category,
  CategoryType,
  CategoryWithChildren,
  categoryInputSchema,
  categoryUpdateSchema,
} from '@effinance/shared';
import type { z } from 'zod';
import type { DbExecutor } from '../../db/client';
import { categories, transactions, type CategoryRow } from '../../db/schema';
import { ConflictError, ValidationError } from '../../lib/errors';
import { getCategoryOrThrow } from '../common/ownership';
import { DEFAULT_CATEGORIES } from './defaults';

type CategoryInput = z.output<typeof categoryInputSchema>;
type CategoryUpdate = z.output<typeof categoryUpdateSchema>;

export function toCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    icon: row.icon,
    color: row.color,
    parentId: row.parentId,
    archived: row.archived,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listCategories(
  db: DbExecutor,
  workspaceId: string,
  opts: { type?: CategoryType; includeArchived?: boolean },
): Promise<CategoryWithChildren[]> {
  const rows = await db
    .select()
    .from(categories)
    .where(
      and(
        eq(categories.workspaceId, workspaceId),
        opts.type ? eq(categories.type, opts.type) : undefined,
        opts.includeArchived ? undefined : eq(categories.archived, false),
      ),
    )
    .orderBy(asc(categories.name));

  const parents = rows.filter((r) => !r.parentId);
  return parents.map((p) => ({
    ...toCategory(p),
    subcategories: rows.filter((c) => c.parentId === p.id).map(toCategory),
  }));
}

export async function createCategory(db: DbExecutor, workspaceId: string, input: CategoryInput): Promise<Category> {
  let type = input.type;
  if (input.parentId) {
    const parent = await getCategoryOrThrow(db, workspaceId, input.parentId);
    if (parent.parentId) throw new ValidationError('Subcategorias não podem ter subcategorias');
    // A subcategory always shares the parent's type.
    type = parent.type;
  }
  const [row] = await db
    .insert(categories)
    .values({ workspaceId, ...input, type })
    .returning();
  return toCategory(row!);
}

export async function updateCategory(
  db: DbExecutor,
  workspaceId: string,
  id: string,
  input: CategoryUpdate,
): Promise<Category> {
  await getCategoryOrThrow(db, workspaceId, id);
  const [row] = await db.update(categories).set(input).where(eq(categories.id, id)).returning();
  return toCategory(row!);
}

export async function deleteCategory(db: DbExecutor, workspaceId: string, id: string): Promise<void> {
  await getCategoryOrThrow(db, workspaceId, id);
  const children = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.workspaceId, workspaceId), eq(categories.parentId, id)));
  const ids = [id, ...children.map((c) => c.id)];
  const [used] = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(or(inArray(transactions.categoryId, ids), inArray(transactions.subcategoryId, ids)))
    .limit(1);
  if (used) {
    throw new ConflictError('Esta categoria possui lançamentos. Arquive-a em vez de excluir.');
  }
  await db.delete(categories).where(eq(categories.id, id));
}

/** Creates the default category tree for a new workspace. */
export async function seedDefaultCategories(db: DbExecutor, workspaceId: string): Promise<void> {
  for (const def of DEFAULT_CATEGORIES) {
    const [parent] = await db
      .insert(categories)
      .values({ workspaceId, name: def.name, type: def.type, icon: def.icon, color: def.color })
      .returning({ id: categories.id });
    if (def.subcategories?.length) {
      await db.insert(categories).values(
        def.subcategories.map((s) => ({
          workspaceId,
          parentId: parent!.id,
          name: s.name,
          type: def.type,
          icon: s.icon,
          color: def.color,
        })),
      );
    }
  }
}

export async function hasCategories(db: DbExecutor, workspaceId: string) {
  const [row] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.workspaceId, workspaceId), isNull(categories.parentId)))
    .limit(1);
  return !!row;
}

export const LATE_FEE_CATEGORY = 'Juros e multas';

/**
 * Expense category for interest and fines paid on a late bill: the "Juros e multas" subcategory
 * (under "Impostos e taxas" in the default tree). Created when the workspace does not have one.
 */
export async function ensureLateFeeCategory(
  db: DbExecutor,
  workspaceId: string,
): Promise<{ categoryId: string; subcategoryId: string | null }> {
  const rows = await db
    .select()
    .from(categories)
    .where(and(eq(categories.workspaceId, workspaceId), eq(categories.type, 'expense')));
  const named = (r: (typeof rows)[number]) => r.name.trim().toLowerCase() === LATE_FEE_CATEGORY.toLowerCase();
  const sub = rows.find((r) => r.parentId && named(r) && !r.archived);
  if (sub) return { categoryId: sub.parentId!, subcategoryId: sub.id };
  const top = rows.find((r) => !r.parentId && named(r) && !r.archived);
  if (top) return { categoryId: top.id, subcategoryId: null };

  const taxes = rows.find((r) => !r.parentId && !r.archived && r.name === 'Impostos e taxas');
  if (taxes) {
    const [created] = await db
      .insert(categories)
      .values({ workspaceId, parentId: taxes.id, name: LATE_FEE_CATEGORY, type: 'expense', icon: 'coins', color: taxes.color })
      .returning({ id: categories.id });
    return { categoryId: taxes.id, subcategoryId: created!.id };
  }
  const [created] = await db
    .insert(categories)
    .values({ workspaceId, name: LATE_FEE_CATEGORY, type: 'expense', icon: 'coins', color: '#64748B' })
    .returning({ id: categories.id });
  return { categoryId: created!.id, subcategoryId: null };
}

export const INVESTMENT_INCOME_CATEGORY = 'Rendimentos';

/**
 * "Rendimentos › <subcategory>" for investment income (Dividendos, JCP, Juros, Rendimento), created
 * when missing (workspaces from before the defaults had them, or renamed/archived ones).
 */
export async function ensureInvestmentIncomeCategory(
  db: DbExecutor,
  workspaceId: string,
  subcategory: string,
): Promise<{ categoryId: string; subcategoryId: string }> {
  const rows = await db
    .select()
    .from(categories)
    .where(and(eq(categories.workspaceId, workspaceId), eq(categories.type, 'income')));
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.toLowerCase();
  let top = rows.find((r) => !r.parentId && !r.archived && same(r.name, INVESTMENT_INCOME_CATEGORY));
  if (!top) {
    [top] = await db
      .insert(categories)
      .values({ workspaceId, name: INVESTMENT_INCOME_CATEGORY, type: 'income', icon: 'trending-up', color: '#0F766E' })
      .returning();
  }
  const sub = rows.find((r) => r.parentId === top!.id && !r.archived && same(r.name, subcategory));
  if (sub) return { categoryId: top!.id, subcategoryId: sub.id };
  const [created] = await db
    .insert(categories)
    .values({ workspaceId, parentId: top!.id, name: subcategory, type: 'income', icon: 'coins', color: top!.color })
    .returning({ id: categories.id });
  return { categoryId: top!.id, subcategoryId: created!.id };
}
