// Category suggestions from the workspace's own history: the most recent categorized transaction of
// the same type whose description is the same once normalized, or failing that starts with the same
// significant words ("UBER *TRIP 1234" ~ "UBER *TRIP 9876"). Bounded read, matched in memory.

import { and, desc, eq, inArray, isNotNull, lte } from 'drizzle-orm';
import type { DbExecutor } from '../../db/client';
import { categories, transactions } from '../../db/schema';
import { today } from '../../lib/clock';
import { normalizeDescription, significantPrefix } from './describe';

/** Most recent categorized rows considered (enough history, bounded cost). */
const HISTORY_LIMIT = 3000;

type Kind = 'income' | 'expense';

export interface CategorySuggester {
  /** Category or subcategory id (subcategory when the history used one). */
  suggest(description: string, type: Kind): string | null;
}

export async function loadCategorySuggester(tx: DbExecutor, workspaceId: string): Promise<CategorySuggester> {
  const [history, archived] = await Promise.all([
    tx
      .select({
        description: transactions.description,
        type: transactions.type,
        categoryId: transactions.categoryId,
        subcategoryId: transactions.subcategoryId,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.workspaceId, workspaceId),
          inArray(transactions.type, ['income', 'expense']),
          isNotNull(transactions.categoryId),
          lte(transactions.date, today()),
        ),
      )
      .orderBy(desc(transactions.date), desc(transactions.createdAt))
      .limit(HISTORY_LIMIT),
    tx
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.workspaceId, workspaceId), eq(categories.archived, true))),
  ]);
  const hidden = new Set(archived.map((c) => c.id));
  const exact = new Map<string, string>();
  const prefix = new Map<string, string>();
  for (const row of history) {
    if (!row.categoryId || hidden.has(row.categoryId) || (row.subcategoryId && hidden.has(row.subcategoryId))) continue;
    const chosen = row.subcategoryId ?? row.categoryId;
    const normalized = normalizeDescription(row.description);
    if (!normalized) continue;
    // Rows come newest first: the first one seen wins.
    const exactKey = `${row.type}|${normalized}`;
    if (!exact.has(exactKey)) exact.set(exactKey, chosen);
    const p = significantPrefix(normalized);
    if (p && !prefix.has(`${row.type}|${p}`)) prefix.set(`${row.type}|${p}`, chosen);
  }
  return {
    suggest(description, type) {
      const normalized = normalizeDescription(description);
      if (!normalized) return null;
      const hit = exact.get(`${type}|${normalized}`);
      if (hit) return hit;
      const p = significantPrefix(normalized);
      return p ? (prefix.get(`${type}|${p}`) ?? null) : null;
    },
  };
}
