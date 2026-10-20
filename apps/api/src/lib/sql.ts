import { sql, type SQL } from 'drizzle-orm';
import type { DbExecutor } from '../db/client';

/** SUM that never returns null and comes back as a JS number (pg returns numeric as string). */
export function sumOf(expr: SQL | unknown) {
  return sql<number>`coalesce(sum(${expr}), 0)`.mapWith(Number);
}

export function countAll() {
  return sql<number>`count(*)`.mapWith(Number);
}

/** Escapes LIKE wildcards in user input. */
export function likePattern(term: string) {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  return typeof value === 'number' ? value : Number(value);
}

/** Raw query rows: postgres-js returns an array, PGlite (browser demo) returns `{ rows }`. */
export async function executeRows<T>(db: DbExecutor, query: SQL): Promise<T[]> {
  const result: unknown = await db.execute(query);
  return Array.isArray(result) ? (result as T[]) : ((result as { rows?: T[] }).rows ?? []);
}
