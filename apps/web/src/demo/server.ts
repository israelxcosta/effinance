// In-browser API for the demo build: PGlite (Postgres in WASM) + the real API route plugins.
// Data persists per browser in IndexedDB; the demo user is seeded on first boot.

import type {} from '@api/app'; // brings Fastify type augmentations (app.db, req.userId) into scope
import { createPgliteDb } from '@api/db/pglite';
import { DEMO_EMAIL, DEMO_PASSWORD, seedDemo } from '@api/db/demo-seed';
import { UnauthorizedError } from '@api/lib/errors';
import { domainRoutes } from '@api/routes';
import { demoAuthRoutes } from './auth-routes';
import { DemoRouter, type DemoRequest } from './fake-fastify';
import { getSessionUserId } from './session';

export { DEMO_EMAIL, DEMO_PASSWORD };

const DATA_DIR = 'idb://effinance-demo';
const IDB_NAME = '/pglite/effinance-demo';

// Drizzle migrations, applied in order and tracked in a local table.
const migrations = import.meta.glob('../../../api/drizzle/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

type Booted = Awaited<ReturnType<typeof boot>>;
let booting: Promise<Booted> | null = null;

/**
 * The demo build ships Postgres' runtime files as gzip+base64 text (`assets/pglite-fs.txt`, see
 * vite.config.ts): smaller than the raw bundle, and served by hosts that reject `.data` files.
 * Falls back to PGlite's default bundle (dev server, Node tests).
 */
async function loadFsBundle(): Promise<Blob | undefined> {
  if (typeof window === 'undefined') return undefined;
  const file = 'pglite-fs.txt';
  try {
    const res = await fetch(new URL(file, import.meta.url));
    if (!res.ok) return undefined;
    const bytes = Uint8Array.from(atob((await res.text()).trim()), (c) => c.charCodeAt(0));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(stream).blob();
  } catch {
    return undefined;
  }
}

async function openDb() {
  const fsBundle = await loadFsBundle();
  if (typeof indexedDB === 'undefined') return createPgliteDb(undefined, { fsBundle });
  try {
    return await createPgliteDb(DATA_DIR, { fsBundle });
  } catch (error) {
    console.warn('[demo] IndexedDB indisponível, usando banco em memória', error);
    return createPgliteDb(undefined, { fsBundle });
  }
}

async function boot() {
  if (typeof window !== 'undefined') {
    // With relaxedDurability PGlite flushes to IndexedDB in the background and doesn't await it; a
    // flush racing Postgres' temp-file cleanup can reject with ErrnoError. The next flush catches up.
    window.addEventListener('unhandledrejection', (event) => {
      if ((event.reason as Error | undefined)?.name === 'ErrnoError') event.preventDefault();
    });
  }
  const { db, client } = await openDb();

  await client.exec('create table if not exists __demo_migrations (name text primary key)');
  const applied = new Set(
    (await client.query<{ name: string }>('select name from __demo_migrations')).rows.map((r) => r.name),
  );
  for (const [file, source] of Object.entries(migrations).sort(([a], [b]) => a.localeCompare(b))) {
    const name = file.split('/').pop()!;
    if (applied.has(name)) continue;
    await client.exec(source.replaceAll('--> statement-breakpoint', ''));
    await client.query('insert into __demo_migrations (name) values ($1)', [name]);
  }

  const { rows } = await client.query<{ count: number }>('select count(*)::int as count from users');
  if (!rows[0]?.count) await seedDemo(db);

  const router = new DemoRouter({
    db,
    authenticate: async (req: DemoRequest) => {
      const userId = getSessionUserId();
      if (!userId) throw new UnauthorizedError();
      req.userId = userId;
    },
  });
  await router.root.register(
    async (api) => {
      api.get('/health', async () => ({ status: 'ok', mode: 'demo' }));
      await api.register(demoAuthRoutes, { prefix: '/auth' });
      for (const { plugin, prefix } of domainRoutes) await api.register(plugin, { prefix });
    },
    { prefix: '/api' },
  );
  return { router, client };
}

export function getDemoServer(): Promise<Booted> {
  booting ??= boot().catch((error) => {
    booting = null;
    throw error;
  });
  return booting;
}

/** Wipes the browser database; the next load seeds fresh demo data. */
export async function resetDemo(): Promise<void> {
  try {
    const { client } = await getDemoServer();
    await client.close();
  } catch {
    // ignore — we are deleting it anyway
  }
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(IDB_NAME);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}
