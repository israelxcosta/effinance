// In-browser API for the demo build: PGlite (Postgres in WASM) + the real API route plugins,
// including Row Level Security, field encryption (fixed demo key), workspaces, fake billing, file
// imports and Open Finance with the simulated provider (no webhooks in the browser).
// Data persists per browser in IndexedDB; the demo users are seeded on first boot.

import type {} from '@api/app'; // brings Fastify type augmentations (app.db, req.workspaceId) into scope
import { backfillEncryption, needsBackfill } from '@api/db/backfill';
import { createPgliteDb } from '@api/db/pglite';
import { DEMO_EMAIL, DEMO_PARTNER_EMAIL, DEMO_PASSWORD, seedDemo } from '@api/db/demo-seed';
import { sha256Hex } from '@api/lib/crypto/encoding';
import { LocalKeyProvider } from '@api/lib/crypto/key-provider';
import { configureKeyring } from '@api/lib/crypto/keyring';
import { UnauthorizedError } from '@api/lib/errors';
import { ConsoleMailer } from '@api/lib/mailer';
import type { Platform } from '@api/lib/platform';
import { tenantRoutes } from '@api/lib/tenant-routes';
import { setSessionWorkspace } from '@api/modules/auth/sessions';
import { FakeBillingProvider } from '@api/modules/billing/providers/fake';
import { billingRoutes } from '@api/modules/billing/routes';
import { FakeOpenFinanceProvider } from '@api/modules/open-finance/providers/fake';
import { loadAccess } from '@api/modules/workspaces/access';
import { inviteRoutes, workspaceRoutes } from '@api/modules/workspaces/routes';
import { domainRoutes, scopedRoutes } from '@api/routes';
import { demoAuthRoutes } from './auth-routes';
import { DemoRouter, type DemoReply, type DemoRequest } from './fake-fastify';
import { getSession, setSession } from './session';

export { DEMO_EMAIL, DEMO_PARTNER_EMAIL, DEMO_PASSWORD };

const DATA_DIR = 'idb://effinance-demo';
const IDB_NAME = '/pglite/effinance-demo';
/** Bump to reseed browsers that hold demo data from an older version. */
const SEED_VERSION = 'seed:integrations-v1';

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

/** The demo is public: its master key is a fixed, published value (never use it elsewhere). */
async function demoKeyProvider() {
  const hex = await sha256Hex('effinance-public-demo-master-key');
  return LocalKeyProvider.create(Uint8Array.from(hex.match(/../g)!.map((h) => parseInt(h, 16))));
}

function demoAppUrl(): string {
  // Hash router: links such as `${appUrl}/convite/<token>` open the right screen.
  return typeof window === 'undefined' ? 'http://demo.local/#' : `${window.location.origin}${window.location.pathname}#`;
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

  configureKeyring({ provider: await demoKeyProvider(), db });
  // Data from a demo version without field encryption gets encrypted before anything reads it.
  if (await needsBackfill(db)) await backfillEncryption(db);
  if (!applied.has(SEED_VERSION)) {
    await seedDemo(db);
    await client.query('insert into __demo_migrations (name) values ($1) on conflict do nothing', [SEED_VERSION]);
    setSession(null);
  }

  const appUrl = demoAppUrl();
  const platform: Platform = {
    appUrl,
    mailer: new ConsoleMailer(),
    billing: new FakeBillingProvider(appUrl),
    openFinance: { provider: new FakeOpenFinanceProvider(), webhookUrl: null, webhookSecret: null },
  };

  const router = new DemoRouter({
    db,
    platform,
    authenticate: async (req: DemoRequest) => {
      const session = getSession();
      if (!session) throw new UnauthorizedError();
      const access = await loadAccess(db, session.userId, session.workspaceId, session.sessionId);
      if (!access) throw new UnauthorizedError();
      req.userId = session.userId;
      req.workspaceId = session.workspaceId;
      req.sessionId = session.sessionId;
      req.access = access;
    },
    switchSession: async (req: DemoRequest, _reply: DemoReply, workspaceId: string) => {
      if (!req.sessionId) throw new UnauthorizedError();
      await setSessionWorkspace(db, req.sessionId, workspaceId);
      setSession({ userId: req.userId, workspaceId, sessionId: req.sessionId });
    },
    endSession: () => setSession(null),
  });
  await router.root.register(
    async (api) => {
      api.get('/health', async () => ({ status: 'ok', mode: 'demo' }));
      await api.register(demoAuthRoutes, { prefix: '/auth' });
      await api.register(workspaceRoutes, { prefix: '/workspaces' });
      await api.register(inviteRoutes, { prefix: '/invites' });
      await api.register(billingRoutes, { prefix: '/billing' });
      await api.register(tenantRoutes, { routes: domainRoutes });
      for (const { prefix, plugin } of scopedRoutes) await api.register(plugin, { prefix });
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
  setSession(null);
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(IDB_NAME);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}
