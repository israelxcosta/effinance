// Embedded Postgres (WASM) used by the in-browser demo build. Same schema, same services.

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import type { Database } from './client';
import * as schema from './schema';

/**
 * @param dataDir e.g. `idb://effinance-demo` to persist in IndexedDB; omit for in-memory.
 * @param options.fsBundle Postgres runtime files, when they are not served next to the WASM.
 */
export async function createPgliteDb(dataDir?: string, options: { fsBundle?: Blob } = {}) {
  // relaxedDurability: IndexedDB is flushed in the background instead of after every statement,
  // which would make the demo seed (hundreds of writes) take minutes.
  const client = await PGlite.create(dataDir, { relaxedDurability: true, ...options });
  // Drizzle exposes the same query builder for both drivers; services only rely on that surface.
  const db = drizzle(client, { schema, casing: 'snake_case' }) as unknown as Database;
  return { db, client };
}
