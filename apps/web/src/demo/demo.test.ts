// Runs the in-browser API (PGlite + real route plugins) in Node to guard the demo build.
import { beforeAll, describe, expect, it } from 'vitest';
import { monthKey, todayISO } from '@effinance/shared';
import { demoFetch } from './fetch';
import { DEMO_EMAIL, DEMO_PASSWORD } from './server';

async function call(method: string, path: string, body?: unknown) {
  const res = await demoFetch(`/api${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
}

const month = monthKey(todayISO());
const from = `${month}-01`;
const to = `${month}-28`;

describe('demo api (PGlite)', () => {
  beforeAll(async () => {
    expect((await call('GET', '/health')).body).toMatchObject({ status: 'ok', mode: 'demo' });
  }, 120_000);

  it('requires a session and logs in the seeded demo user', async () => {
    expect((await call('GET', '/auth/me')).status).toBe(401);
    const bad = await call('POST', '/auth/login', { email: DEMO_EMAIL, password: 'errada' });
    expect(bad).toMatchObject({ status: 401, body: { error: 'unauthorized' } });
    const ok = await call('POST', '/auth/login', { email: DEMO_EMAIL, password: DEMO_PASSWORD });
    expect(ok.status).toBe(200);
    expect((await call('GET', '/auth/me')).body.email).toBe(DEMO_EMAIL);
  });

  it('serves dashboard, statement and every report', async () => {
    const dash = await call('GET', `/dashboard?month=${month}`);
    expect(dash.status).toBe(200);
    expect(dash.body.accounts.length).toBeGreaterThan(0);
    expect(typeof dash.body.balances.netWorth).toBe('number');

    const paths = [
      `/statement?from=${from}&to=${to}`,
      `/transactions?type=expense&from=${from}&to=${to}`,
      `/reports/overview?from=${from}&to=${to}`,
      `/reports/categories?from=${from}&to=${to}`,
      `/reports/contacts?from=${from}&to=${to}`,
      `/reports/cashflow?from=${from}&to=${to}&granularity=week`,
      `/reports/comparison?aFrom=${from}&aTo=${to}&bFrom=${from}&bTo=${to}`,
      '/credit-cards',
      '/goals',
      '/contacts',
      '/categories',
      '/search?q=a',
    ];
    for (const p of paths) {
      const res = await call('GET', p);
      expect(res.status, p).toBe(200);
    }
  });

  it('creates installments, toggles paid and validates input', async () => {
    const accounts = (await call('GET', '/accounts')).body;
    const created = await call('POST', '/transactions', {
      type: 'expense',
      description: 'Notebook',
      amount: 300000,
      date: from,
      accountId: accounts[0].id,
      recurrenceKind: 'installment',
      installments: 3,
    });
    expect(created.status).toBe(201);
    expect(created.body.map((t: { amount: number }) => t.amount)).toEqual([100000, 100000, 100000]);

    const paid = await call('PATCH', `/transactions/${created.body[0].id}/paid`, { paid: true });
    expect(paid.body.paid).toBe(true);

    const invalid = await call('POST', '/transactions', { type: 'expense', description: '', amount: 0, date: 'x' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toBe('validation_error');

    expect((await call('DELETE', `/transactions/${created.body[0].id}?scope=all`)).status).toBe(204);
  });

  it('splits an amount across categories (migration 0001 applied)', async () => {
    const cats = (await call('GET', '/categories?type=expense')).body;
    const split = await call('POST', '/transactions', {
      type: 'expense',
      description: 'Compra dividida',
      amount: 5000,
      date: from,
      splits: [
        { categoryId: cats[0].id, amount: 3000 },
        { categoryId: cats[1].id, amount: 2000 },
      ],
    });
    expect(split.status).toBe(201);
    expect(split.body.map((t: { amount: number }) => t.amount)).toEqual([3000, 2000]);
    expect(split.body[0].splitGroupId).toBe(split.body[1].splitGroupId);
  });

  it('registers new users with default categories', async () => {
    const reg = await call('POST', '/auth/register', { name: 'Teste', email: 'teste@demo.app', password: 'senha12345', acceptTerms: true });
    expect(reg.status).toBe(201);
    const cats = await call('GET', '/categories');
    expect(cats.body.length).toBeGreaterThan(5);
  });
});
