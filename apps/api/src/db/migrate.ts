import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { env } from '../env';
import { configureKeyring } from '../lib/crypto/keyring';
import { createKeyProvider } from '../setup';
import { backfillEncryption, needsBackfill } from './backfill';
import { createDb } from './client';

const here = path.dirname(fileURLToPath(import.meta.url));
// Works both from src/db (tsx) and dist (bundled build).
export const migrationsFolder = path.resolve(here, here.endsWith(path.join('src', 'db')) ? '../../drizzle' : '../drizzle');

export async function runMigrations(url?: string) {
  const { db, client } = createDb(url);
  try {
    await migrate(db, { migrationsFolder });
    if (await needsBackfill(db)) {
      configureKeyring({ provider: await createKeyProvider(env), db });
      const result = await backfillEncryption(db);
      console.log(`✔ encryption backfill: ${result.workspaces} workspaces, ${result.rows} rows encrypted`);
    }
  } finally {
    await client.end();
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  runMigrations()
    .then(() => {
      console.log('✔ migrations applied');
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
