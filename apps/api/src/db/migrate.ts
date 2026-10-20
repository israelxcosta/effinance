import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from './client';

const here = path.dirname(fileURLToPath(import.meta.url));
// Works both from src/db (tsx) and dist (bundled build).
export const migrationsFolder = path.resolve(here, here.endsWith(path.join('src', 'db')) ? '../../drizzle' : '../drizzle');

export async function runMigrations(url?: string) {
  const { db, client } = createDb(url);
  try {
    await migrate(db, { migrationsFolder });
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
