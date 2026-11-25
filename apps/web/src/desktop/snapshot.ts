// Whole-database snapshot as JSON text, for the desktop backup (apps/desktop encrypts and stores it).
// Postgres renders every row as JSON (bytea as "\x…" hex, timestamps as ISO), so restoring is
// `json_populate_recordset` into the same tables: the encrypted fields come back byte for byte.
// Runs on the PGlite superuser connection, which is not subject to Row Level Security.

import type { createPgliteDb } from '@api/db/pglite';

export type PgliteClient = Awaited<ReturnType<typeof createPgliteDb>>['client'];
type Tx = Parameters<Parameters<PgliteClient['transaction']>[0]>[0];
type Queryable = PgliteClient | Tx;

export const SNAPSHOT_FORMAT = 'effinance-snapshot';
export const SNAPSHOT_VERSION = 1;

export interface Snapshot {
  format: typeof SNAPSHOT_FORMAT;
  version: number;
  createdAt: string;
  /** Migrations applied when the snapshot was taken (`__demo_migrations`). */
  migrations: string[];
  tables: Record<string, Record<string, unknown>[]>;
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const ident = (name: string) => `"${name.replaceAll('"', '""')}"`;

/** Application tables (internal bookkeeping tables start with "__"). */
async function listTables(db: Queryable): Promise<string[]> {
  const { rows } = await db.query<{ name: string }>(
    `select table_name as name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE' and table_name not like '\\_\\_%'
      order by table_name`,
  );
  return rows.map((r) => r.name);
}

async function listColumns(db: Queryable, table: string): Promise<string[]> {
  const { rows } = await db.query<{ name: string }>(
    `select column_name as name from information_schema.columns where table_schema = 'public' and table_name = $1`,
    [table],
  );
  return rows.map((r) => r.name);
}

async function appliedMigrations(db: Queryable): Promise<string[]> {
  const { rows } = await db.query<{ name: string }>(`select name from __demo_migrations where name like '%.sql' order by name`);
  return rows.map((r) => r.name);
}

export async function exportSnapshot(client: PgliteClient): Promise<string> {
  // One transaction: every table is read from the same point in time.
  return client.transaction(async (tx) => {
    const tables: Snapshot['tables'] = {};
    for (const table of await listTables(tx)) {
      const { rows } = await tx.query<{ rows: string }>(`select coalesce(json_agg(t), '[]')::text as rows from ${ident(table)} t`);
      tables[table] = JSON.parse(rows[0]!.rows) as Record<string, unknown>[];
    }
    const snapshot: Snapshot = {
      format: SNAPSHOT_FORMAT,
      version: SNAPSHOT_VERSION,
      createdAt: new Date().toISOString(),
      migrations: await appliedMigrations(tx),
      tables,
    };
    return JSON.stringify(snapshot);
  });
}

export function parseSnapshot(text: string): Snapshot {
  let value: Partial<Snapshot>;
  try {
    value = JSON.parse(text) as Partial<Snapshot>;
  } catch {
    throw new SnapshotError('O arquivo de backup está corrompido.');
  }
  if (value?.format !== SNAPSHOT_FORMAT || typeof value.tables !== 'object' || !Array.isArray(value.migrations)) {
    throw new SnapshotError('Este arquivo não é um backup do Effinance.');
  }
  if ((value.version ?? 0) > SNAPSHOT_VERSION) {
    throw new SnapshotError('Este backup foi feito por uma versão mais nova do Effinance. Atualize o aplicativo.');
  }
  return value as Snapshot;
}

/** Replaces every application row with the snapshot's, in one transaction (all or nothing). */
export async function importSnapshot(client: PgliteClient, snapshot: Snapshot): Promise<void> {
  await client.transaction(async (tx) => {
    const applied = new Set(await appliedMigrations(tx));
    if (snapshot.migrations.some((m) => !applied.has(m))) {
      throw new SnapshotError('Este backup foi feito por uma versão mais nova do Effinance. Atualize o aplicativo.');
    }
    const tables = await listTables(tx);
    // Rows go in table by table: skip foreign-key checks and triggers until the set is complete.
    await tx.exec('set local session_replication_role = replica');
    await tx.exec(`truncate ${tables.map(ident).join(', ')} cascade`);
    for (const table of tables) {
      const rows = snapshot.tables[table];
      if (!rows?.length) continue;
      // Columns added after the backup keep their defaults; columns that no longer exist are ignored.
      const present = new Set(rows.flatMap((r) => Object.keys(r)));
      const cols = (await listColumns(tx, table)).filter((c) => present.has(c)).map(ident).join(', ');
      await tx.query(
        `insert into ${ident(table)} (${cols}) select ${cols} from json_populate_recordset(null::${ident(table)}, $1::json)`,
        [JSON.stringify(rows)],
      );
    }
  });
}
