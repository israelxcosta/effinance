import { sql } from 'drizzle-orm';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll } from 'vitest';
import { buildApp, type App } from '../src/app';
import { createDb, type Database } from '../src/db/client';

let adminConnection: ReturnType<typeof createDb> | null = null;

/** Superuser connection for resets and raw assertions (the app itself runs least-privileged). */
export function admin(): Database {
  adminConnection ??= createDb(process.env.ADMIN_DATABASE_URL);
  return adminConnection.db;
}

afterAll(async () => {
  await adminConnection?.client.end({ timeout: 5 });
  adminConnection = null;
});

export async function createTestApp(): Promise<App> {
  const app = await buildApp({ logger: false });
  await app.ready();
  return app;
}

export async function resetDb(_app?: App) {
  // platform_keys stays: the app caches the key it unwrapped (a new one would orphan the index).
  await admin().execute(sql`truncate table users, workspaces, billing_events, open_finance_events restart identity cascade`);
}

export interface Client {
  token: string;
  userId: string;
  email: string;
  /** Last refresh token received in a cookie. */
  refreshToken: string | null;
  get<T = any>(url: string): Promise<Res<T>>;
  post<T = any>(url: string, body?: unknown): Promise<Res<T>>;
  put<T = any>(url: string, body?: unknown): Promise<Res<T>>;
  patch<T = any>(url: string, body?: unknown): Promise<Res<T>>;
  del<T = any>(url: string, body?: unknown): Promise<Res<T>>;
}

export interface Res<T> {
  status: number;
  body: T;
  raw: LightMyRequestResponse;
}

function wrap<T>(raw: LightMyRequestResponse): Res<T> {
  let body: any = undefined;
  try {
    body = raw.body ? raw.json() : undefined;
  } catch {
    body = raw.body;
  }
  return { status: raw.statusCode, body, raw };
}

/** Picks up new session cookies (switch workspace, refresh) so the client follows them. */
export function absorbCookies(client: Pick<Client, 'token' | 'refreshToken'>, raw: LightMyRequestResponse) {
  for (const c of raw.cookies) {
    if (c.name === 'effinance_token' && c.value) client.token = c.value;
    if (c.name === 'effinance_refresh' && c.value) client.refreshToken = c.value;
  }
}

export function clientFor(app: App, token: string, userId = '', email = '', refreshToken: string | null = null): Client {
  const call = async (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown) => {
    const raw = await app.inject({
      method,
      url: `/api${url}`,
      headers: { authorization: `Bearer ${client.token}` },
      ...(payload !== undefined ? { payload: payload as object } : {}),
    });
    absorbCookies(client, raw);
    return wrap<any>(raw);
  };
  const client: Client = {
    token,
    userId,
    email,
    refreshToken,
    get: (url) => call('GET', url),
    post: (url, body) => call('POST', url, body ?? {}),
    put: (url, body) => call('PUT', url, body ?? {}),
    patch: (url, body) => call('PATCH', url, body ?? {}),
    del: (url, body) => call('DELETE', url, body),
  };
  return client;
}

let counter = 0;
export const TEST_PASSWORD = 'senha-segura-123';

export async function registerUser(app: App, name = 'Usuária Teste', email?: string): Promise<Client> {
  counter += 1;
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { name, email: email ?? `user${counter}-${Date.now()}@teste.com`, password: TEST_PASSWORD, acceptTerms: true },
  });
  if (res.statusCode !== 201) throw new Error(`register failed: ${res.body}`);
  const { token, user } = res.json();
  const refresh = res.cookies.find((c) => c.name === 'effinance_refresh')?.value ?? null;
  return clientFor(app, token, user.id, user.email, refresh);
}

/** Creates a plain checking account and returns its id. */
export async function createAccount(c: Client, overrides: Record<string, unknown> = {}): Promise<string> {
  const res = await c.post('/accounts', { name: 'Conta', type: 'checking', initialBalance: 0, ...overrides });
  if (res.status !== 201) throw new Error(`account failed: ${JSON.stringify(res.body)}`);
  return res.body.id;
}

export async function firstCategory(c: Client, type: 'income' | 'expense', name?: string) {
  const res = await c.get(`/categories?type=${type}`);
  const list = res.body as { id: string; name: string; subcategories: { id: string; name: string }[] }[];
  const cat = name ? list.find((x) => x.name === name) : list[0];
  if (!cat) throw new Error('category not found');
  return cat;
}
