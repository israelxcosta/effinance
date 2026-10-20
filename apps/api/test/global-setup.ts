import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { ADMIN_URL, API_ROLE, API_ROLE_PASSWORD, IDENTITY_GRANTS } from './db-roles';

const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../drizzle');

/**
 * Recreates the test schema once per run, applies migrations as the owner, and creates the
 * least-privileged login role the app connects with during tests — the production setup
 * (docs/deploy-aws.md): no direct access to financial tables, only SET ROLE effinance_app (RLS).
 */
export default async function setup() {
  const sql = postgres(ADMIN_URL, { onnotice: () => {}, max: 1 });
  try {
    await sql.unsafe('drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;');
    await migrate(drizzle(sql), { migrationsFolder });
    const [exists] = await sql`select 1 from pg_roles where rolname = ${API_ROLE}`;
    if (!exists) {
      await sql.unsafe(`create role ${API_ROLE} login noinherit nosuperuser nobypassrls password '${API_ROLE_PASSWORD}'`);
    }
    // Roles are cluster-wide: pin the attributes even if the role was created elsewhere.
    await sql.unsafe(`alter role ${API_ROLE} login noinherit nosuperuser nobypassrls nocreatedb nocreaterole noreplication`);
    await sql.unsafe(`grant effinance_app to ${API_ROLE}`);
    // Like production: nothing on the database for PUBLIC (no TEMP objects), CONNECT only for the API.
    const [{ db }] = await sql<{ db: string }[]>`select current_database() as db`;
    await sql.unsafe(`revoke all on database "${db}" from public`);
    await sql.unsafe(`grant connect on database "${db}" to ${API_ROLE}`);
    await sql.unsafe(`grant usage on schema public to ${API_ROLE}`);
    for (const [table, privileges] of Object.entries(IDENTITY_GRANTS)) {
      await sql.unsafe(`grant ${privileges.join(', ')} on ${table} to ${API_ROLE}`);
    }
  } finally {
    await sql.end();
  }
}
