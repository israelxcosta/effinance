// Security audit round 3 (security-node-api, 2026-11-26) — regression tests. Each "finding" test
// reproduces a path that worked before the fix; "guards" pin protections of the newer modules
// (investments, pay another amount, evolution report, parent categories) that were already correct.

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { App } from '../src/app';
import type { MemoryMailer } from '../src/lib/mailer';
import { PASSWORD_MAX_FAILURES } from '../src/modules/auth/password-attempts';
import { TEST_PASSWORD, admin, createAccount, createTestApp, firstCategory, registerUser, resetDb, type Client } from './helpers';

const FAKE_ID = '00000000-0000-4000-8000-000000000000';

let app: App;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await resetDb(app);
  outbox().length = 0;
});

const outbox = () => (app.platform.mailer as MemoryMailer).outbox;

/** Login from a given IP (each attempt from a different address defeats any per-IP limit). */
const loginFrom = (ip: string, email: string, password: string) =>
  app.inject({ method: 'POST', url: '/api/auth/login', remoteAddress: ip, payload: { email, password } });

// ---------------------------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------------------------

describe('finding: per-account password budget (CWE-307)', () => {
  it('locks password guessing on one account from many IPs, without touching other accounts', async () => {
    const victim = await registerUser(app, 'Alvo');
    const other = await registerUser(app, 'Vizinha');
    for (let i = 0; i < PASSWORD_MAX_FAILURES; i++) {
      expect((await loginFrom(`203.0.113.${i + 1}`, victim.email, `chute-errado-${i}`)).statusCode).toBe(401);
    }
    // Budget spent: even the right password gets no answer about it (a guess would be confirmed otherwise).
    const locked = await loginFrom('198.51.100.7', victim.email, TEST_PASSWORD);
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error).toBe('too_many_requests');
    expect((await loginFrom('198.51.100.7', other.email, TEST_PASSWORD)).statusCode).toBe(200);

    // Failures are audited against the account (they used to carry no user at all).
    const [row] = await admin().execute<{ n: number }>(
      sql`select count(*)::int as n from audit_logs where user_id = ${victim.userId} and action = 'auth.login_failed'`,
    );
    expect(row!.n).toBe(PASSWORD_MAX_FAILURES);

    // The owner gets back in through the e-mail link: a password reset starts a fresh budget.
    await app.inject({ method: 'POST', url: '/api/auth/password/forgot', payload: { email: victim.email } });
    const token = /token=([\w-]+)/.exec(outbox().at(-1)!.text)![1]!;
    const reset = await app.inject({ method: 'POST', url: '/api/auth/password/reset', payload: { token, password: 'nova-senha-forte-1' } });
    expect(reset.statusCode).toBe(204);
    expect((await loginFrom('198.51.100.7', victim.email, 'nova-senha-forte-1')).statusCode).toBe(200);
  });

  it('re-authentication (change password, delete account, enable 2FA) spends the same budget', async () => {
    const user = await registerUser(app, 'Sessão Roubada');
    // Someone holding a session tries to guess the current password to take the account over.
    for (let i = 0; i < PASSWORD_MAX_FAILURES - 2; i++) {
      expect((await user.post('/auth/password', { currentPassword: `chute-${i}`, newPassword: 'senha-do-invasor-1' })).status).toBe(422);
    }
    expect((await user.del('/auth/me', { password: 'chute-del' })).status).toBe(422);
    const { secret } = (await user.post('/auth/mfa/setup')).body;
    expect(secret).toBeTruthy();
    expect((await user.post('/auth/mfa/enable', { code: '000000', password: 'chute-mfa' })).status).toBe(422);

    expect((await user.post('/auth/password', { currentPassword: TEST_PASSWORD, newPassword: 'senha-do-invasor-1' })).status).toBe(429);
    expect((await user.del('/auth/me', { password: TEST_PASSWORD })).status).toBe(429);
    expect((await loginFrom('192.0.2.10', user.email, TEST_PASSWORD)).statusCode).toBe(429);
    const [alive] = await admin().execute<{ n: number }>(sql`select count(*)::int as n from users where id = ${user.userId}`);
    expect(alive!.n).toBe(1);
  });

  it('a few typos do not lock anyone out', async () => {
    const user = await registerUser(app, 'Distraída');
    for (let i = 0; i < 3; i++) expect((await loginFrom('192.0.2.20', user.email, 'quase-certa')).statusCode).toBe(401);
    expect((await loginFrom('192.0.2.20', user.email, TEST_PASSWORD)).statusCode).toBe(200);
    // Unknown e-mails answer like a wrong password (no enumeration through the message).
    const unknown = await loginFrom('192.0.2.20', 'ninguem@teste.com', TEST_PASSWORD);
    expect(unknown.statusCode).toBe(401);
    expect(unknown.json().message).toBe('E-mail ou senha incorretos');
  });
});

describe('finding: investment purchase total is bounded like any amount (CWE-190)', () => {
  it('refuses a purchase whose total exceeds the money cap instead of booking an unsafe Aplicação', async () => {
    const user = await registerUser(app, 'Investidora');
    const from = await createAccount(user);
    const base = { assetType: 'stock', ticker: 'PETR4', date: '2026-10-10' };
    // 1,000,000 × R$ 1 bi = 10^17 cents: beyond Number.MAX_SAFE_INTEGER sums and the 10^11 cap of amounts.
    const huge = await user.post('/investments/purchases', { ...base, quantity: 1_000_000, unitPrice: 100_000_000_000, paidFromAccountId: from });
    expect(huge.status).toBe(422);
    const noTransfer = await user.post('/investments/purchases', { ...base, quantity: 1_000_000, unitPrice: 100_000_000_000 });
    expect(noTransfer.status).toBe(422);
    const [count] = await admin().execute<{ n: number }>(
      sql`select (select count(*) from transactions) + (select count(*) from investment_purchases) as n`,
    );
    expect(Number(count!.n)).toBe(0);

    // At the cap it is still accepted (R$ 1 bi in total), and editing obeys the same rule.
    const ok = await user.post('/investments/purchases', { ...base, quantity: 1000, unitPrice: 100_000_000, paidFromAccountId: from });
    expect(ok.status).toBe(201);
    expect(ok.body.total).toBe(100_000_000_000);
    const edit = await user.put(`/investments/purchases/${ok.body.id}`, { ...base, quantity: 1000, unitPrice: 100_000_000, fees: 1, paidFromAccountId: from });
    expect(edit.status).toBe(422);
    expect((await user.get('/investments')).body.totalInvested).toBe(100_000_000_000);
  });
});

// ---------------------------------------------------------------------------------------------
// Guards: newer modules
// ---------------------------------------------------------------------------------------------

describe('guards: newer modules', () => {
  async function familyWith(owner: Client, email: string, role: 'viewer' | 'editor') {
    const ws = await owner.post('/workspaces', { name: `Espaço ${email}`, kind: 'family' });
    await owner.post('/auth/switch-workspace', { workspaceId: ws.body.id });
    const inv = await owner.post('/workspaces/current/invites', { email, role });
    const member = await registerUser(app, 'Membro', email);
    expect((await member.post(`/invites/${inv.body.inviteUrl.split('/convite/')[1]}/accept`)).status).toBe(200);
    return { workspaceId: ws.body.id as string, member };
  }

  it('investment mutations need editor/owner (403) and a writable subscription (402)', async () => {
    const owner = await registerUser(app, 'Dona Carteira');
    const { workspaceId, member: viewer } = await familyWith(owner, 'leitor-inv@teste.com', 'viewer');
    const purchase = { assetType: 'stock', ticker: 'VALE3', date: '2026-10-10', quantity: 1, unitPrice: 1000 };
    const created = await owner.post('/investments/purchases', purchase);
    expect(created.status).toBe(201);
    const calls: [string, string, unknown?][] = [
      ['POST', '/investments/purchases', purchase],
      ['PUT', `/investments/purchases/${created.body.id}`, purchase],
      ['DELETE', `/investments/purchases/${created.body.id}`],
    ];
    const run = async (c: Client) => {
      const codes: number[] = [];
      for (const [method, url, body] of calls) {
        const res = method === 'POST' ? await c.post(url, body) : method === 'PUT' ? await c.put(url, body) : await c.del(url);
        codes.push(res.status);
      }
      return codes;
    };
    expect(await run(viewer)).toEqual([403, 403, 403]);
    await admin().execute(sql`update subscriptions set trial_ends_at = now() - interval '1 day' where workspace_id = ${workspaceId}`);
    expect(await run(owner)).toEqual([402, 402, 402]);
    expect((await viewer.get('/investments')).body.purchases).toHaveLength(1);
  });

  it('rejects ids of another workspace in purchases, pay-another-amount and parent categories (BOLA)', async () => {
    const alice = await registerUser(app, 'Alice R3');
    const bob = await registerUser(app, 'Bob R3');
    const aAccount = await createAccount(alice);
    const aBroker = await createAccount(alice, { name: 'Corretora A', type: 'investment' });
    const aCategory = await firstCategory(alice, 'expense');
    const aPurchase = (await alice.post('/investments/purchases', { assetType: 'stock', ticker: 'ITSA4', date: '2026-10-10', quantity: 1, unitPrice: 1000 })).body.id;

    const bAccount = await createAccount(bob);
    const bCategory = await firstCategory(bob, 'expense');
    const bTx = (await bob.post('/transactions', { type: 'expense', description: 'Luz', amount: 10000, date: '2026-10-01', accountId: bAccount })).body[0].id;
    const purchase = { assetType: 'stock', ticker: 'BBAS3', date: '2026-10-10', quantity: 1, unitPrice: 1000 };

    const probes: [string, string, unknown?][] = [
      ['POST', '/investments/purchases', { ...purchase, accountId: aBroker }],
      ['POST', '/investments/purchases', { ...purchase, paidFromAccountId: aAccount }],
      ['PUT', `/investments/purchases/${aPurchase}`, purchase],
      ['DELETE', `/investments/purchases/${aPurchase}`],
      ['PATCH', `/transactions/${bTx}/paid`, { paid: true, paidAt: '2026-10-15', amount: 12000, differenceCategoryId: aCategory.id }],
      ['PATCH', `/transactions/${bTx}/paid`, { paid: true, paidAt: '2026-10-15', amount: 12000, differenceCategoryId: bCategory.id, differenceSubcategoryId: aCategory.subcategories[0]!.id }],
      ['POST', '/categories', { name: 'Filha', type: 'expense', parentId: aCategory.id }],
    ];
    for (const [method, url, body] of probes) {
      const res = await app.inject({
        method: method as 'POST',
        url: `/api${url}`,
        headers: { authorization: `Bearer ${bob.token}` },
        ...(body !== undefined ? { payload: body as object } : {}),
      });
      expect([404, 422], `${method} ${url}`).toContain(res.statusCode);
    }
    // Nothing of Alice's changed and Bob's bill is still unpaid, with no extra entry.
    expect((await alice.get('/investments')).body.purchases).toHaveLength(1);
    const bills = (await bob.get('/transactions?from=2026-10-01&to=2026-10-31')).body;
    expect(bills.items).toHaveLength(1);
    expect(bills.items[0].paid).toBe(false);
    // The purchase id is never a reference: a client-sent transferId is ignored (server-only column).
    const forged = await bob.post('/investments/purchases', { ...purchase, transferId: FAKE_ID, workspaceId: FAKE_ID });
    expect(forged.status).toBe(201);
    expect(forged.body.transferId).toBeNull();
  });

  it('caps the evolution report window and refuses far-off years', async () => {
    const user = await registerUser(app, 'Relatórios');
    expect((await user.get('/reports/evolution?to=2026-10&months=37')).status).toBe(400);
    expect((await user.get('/reports/evolution?to=2300-01&months=12')).status).toBe(400);
    expect((await user.get('/reports/evolution?to=2026-10&months=36&interval=month')).status).toBe(200);
  });
});
