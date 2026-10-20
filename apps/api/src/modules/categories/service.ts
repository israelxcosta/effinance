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
