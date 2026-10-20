import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

const DEFAULT_URL = 'postgres://postgres:postgres@localhost:5432/effinance_test';
const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../drizzle');

/** Recreates the test schema once per run and applies migrations. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? DEFAULT_URL;
  const sql = postgres(url, { onnotice: () => {}, max: 1 });
  try {
    await sql.unsafe('drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;');
    await migrate(drizzle(sql), { migrationsFolder });
  } finally {
    await sql.end();
  }
}
