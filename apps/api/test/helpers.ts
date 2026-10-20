import { sql } from 'drizzle-orm';
import type { LightMyRequestResponse } from 'fastify';
import { buildApp, type App } from '../src/app';

export async function createTestApp(): Promise<App> {
  const app = await buildApp({ logger: false });
  await app.ready();
  return app;
}

export async function resetDb(app: App) {
  await app.db.execute(sql`truncate table users restart identity cascade`);
}

export interface Client {
  token: string;
  userId: string;
  get<T = any>(url: string): Promise<Res<T>>;
  post<T = any>(url: string, body?: unknown): Promise<Res<T>>;
  put<T = any>(url: string, body?: unknown): Promise<Res<T>>;
  patch<T = any>(url: string, body?: unknown): Promise<Res<T>>;
  del<T = any>(url: string): Promise<Res<T>>;
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

export function clientFor(app: App, token: string, userId = ''): Client {
  const call = async (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
    wrap<any>(
      await app.inject({
        method,
        url: `/api${url}`,
        headers: { authorization: `Bearer ${token}` },
        ...(payload !== undefined ? { payload: payload as object } : {}),
      }),
    );
  return {
    token,
    userId,
    get: (url) => call('GET', url),
    post: (url, body) => call('POST', url, body ?? {}),
    put: (url, body) => call('PUT', url, body ?? {}),
    patch: (url, body) => call('PATCH', url, body ?? {}),
    del: (url) => call('DELETE', url),
  };
}

let counter = 0;
export async function registerUser(app: App, name = 'Usuária Teste'): Promise<Client> {
  counter += 1;
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { name, email: `user${counter}-${Date.now()}@teste.com`, password: 'senha-segura-123', acceptTerms: true },
  });
  if (res.statusCode !== 201) throw new Error(`register failed: ${res.body}`);
  const { token, user } = res.json();
  return clientFor(app, token, user.id);
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
