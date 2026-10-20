import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { App } from '../src/app';
import { createAccount, createTestApp, firstCategory, registerUser, resetDb } from './helpers';

let app: App;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await resetDb(app);
});

describe('auth', () => {
  it('registers, sets the session cookie and seeds defaults', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { name: 'Ana', email: 'Ana@Exemplo.com', password: '12345678' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.user).toMatchObject({ name: 'Ana', email: 'ana@exemplo.com' });
    expect(body.user.passwordHash).toBeUndefined();
    const cookie = res.cookies.find((c) => c.name === 'effinance_token');
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('Lax');

    const me = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: { effinance_token: cookie!.value } });
    expect(me.statusCode).toBe(200);
    expect(me.json().email).toBe('ana@exemplo.com');

    const cats = await app.inject({
      method: 'GET',
      url: '/api/categories',
      headers: { authorization: `Bearer ${body.token}` },
    });
    expect(cats.json().length).toBeGreaterThan(10);
    const accounts = await app.inject({
      method: 'GET',
      url: '/api/accounts',
      headers: { authorization: `Bearer ${body.token}` },
    });
    expect(accounts.json()).toEqual([expect.objectContaining({ name: 'Carteira', type: 'wallet', balance: 0 })]);
  });

  it('rejects duplicates, wrong passwords and missing auth', async () => {
    const payload = { name: 'Bia', email: 'bia@exemplo.com', password: '12345678' };
    expect((await app.inject({ method: 'POST', url: '/api/auth/register', payload })).statusCode).toBe(201);
    expect((await app.inject({ method: 'POST', url: '/api/auth/register', payload })).statusCode).toBe(409);

    const bad = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'bia@exemplo.com', password: 'errada123' },
    });
    expect(bad.statusCode).toBe(401);
    expect(bad.json().message).toBe('E-mail ou senha incorretos');

    const ok = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'BIA@exemplo.com', password: '12345678' },
    });
    expect(ok.statusCode).toBe(200);

    expect((await app.inject({ method: 'GET', url: '/api/accounts' })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: 'GET', url: '/api/accounts', headers: { authorization: 'Bearer nope' } })).statusCode,
    ).toBe(401);
  });

  it('returns 400 with details for invalid payloads', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'x' } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'validation_error' });
    expect(res.json().details.length).toBeGreaterThan(0);
  });

  it('isolates data between users (no IDOR)', async () => {
    const alice = await registerUser(app, 'Alice');
    const bob = await registerUser(app, 'Bob');

    const aliceAccount = await createAccount(alice, { name: 'Conta Alice', initialBalance: 100000 });
    const aliceCategory = await firstCategory(alice, 'expense');
    const tx = await alice.post('/transactions', {
      type: 'expense',
      description: 'Mercado',
      amount: 5000,
      date: '2026-10-10',
      accountId: aliceAccount,
      categoryId: aliceCategory.id,
    });
    expect(tx.status).toBe(201);
    const txId = tx.body[0].id;

    // Bob cannot read, change or delete Alice's resources…
    expect((await bob.get(`/accounts/${aliceAccount}`)).status).toBe(404);
    expect((await bob.put(`/accounts/${aliceAccount}`, { name: 'x', type: 'checking' })).status).toBe(404);
    expect((await bob.del(`/accounts/${aliceAccount}`)).status).toBe(404);
    expect((await bob.get(`/transactions/${txId}`)).status).toBe(404);
    expect((await bob.patch(`/transactions/${txId}/paid`, { paid: true })).status).toBe(404);
    expect((await bob.del(`/transactions/${txId}`)).status).toBe(404);
    expect((await bob.get(`/statement?accountId=${aliceAccount}&from=2026-10-01&to=2026-10-31`)).status).toBe(404);

    // …nor reference them in his own records.
    const sneaky = await bob.post('/transactions', {
      type: 'expense',
      description: 'x',
      amount: 100,
      date: '2026-10-10',
      accountId: aliceAccount,
    });
    expect(sneaky.status).toBe(404);
    const sneakyCat = await bob.post('/transactions', {
      type: 'expense',
      description: 'x',
      amount: 100,
      date: '2026-10-10',
      categoryId: aliceCategory.id,
    });
    expect(sneakyCat.status).toBe(404);

    // Listings only show own data.
    const list = await bob.get('/transactions');
    expect(list.body.total).toBe(0);
    const accounts = await bob.get('/accounts');
    expect(accounts.body.map((a: any) => a.name)).toEqual(['Carteira']);
    const search = await bob.get('/search?q=Mercado');
    expect(search.body.transactions).toEqual([]);
  });
});
