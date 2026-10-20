import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../env';
import * as schema from './schema';

export function createDb(url: string = env.DATABASE_URL) {
  const client = postgres(url, {
    max: env.NODE_ENV === 'test' ? 4 : 10,
    onnotice: () => {},
  });
  const db = drizzle(client, { schema, casing: 'snake_case' });
  return { db, client };
}

export type Database = ReturnType<typeof createDb>['db'];
/** A db handle or a transaction handle (both expose the same query API). */
export type DbExecutor = Database | Parameters<Parameters<Database['transaction']>[0]>[0];
