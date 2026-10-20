// Runs the in-browser API (PGlite + real route plugins) in Node to guard the demo build.
import { beforeAll, describe, expect, it } from 'vitest';
import { monthKey, todayISO } from '@effinance/shared';
import { demoFetch } from './fetch';
import { DEMO_EMAIL, DEMO_PARTNER_EMAIL, DEMO_PASSWORD, getDemoServer } from './server';

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
    const me = (await call('GET', '/auth/me')).body;
    expect(me.user.email).toBe(DEMO_EMAIL);
    expect(me.workspace).toMatchObject({ name: 'Pessoal', kind: 'personal', role: 'owner' });
    expect(me.workspace.subscription).toMatchObject({ status: 'trialing', canWrite: true });
    expect(me.workspaces.map((w: { name: string }) => w.name)).toEqual(['Pessoal', 'Família Costa']);
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

  it('keeps workspaces isolated with RLS and encrypts personal data in PGlite', async () => {
    const { client } = await getDemoServer();
    const me = (await call('GET', '/auth/me')).body;
    const family = me.workspaces.find((w: { kind: string }) => w.kind === 'family');

    const personalAccounts = (await call('GET', '/accounts')).body.map((a: { name: string }) => a.name);
    const switched = await call('POST', '/auth/switch-workspace', { workspaceId: family.id });
    expect(switched.body.workspace).toMatchObject({ name: 'Família Costa', role: 'owner', subscription: { status: 'active' } });
    const familyAccounts = (await call('GET', '/accounts')).body.map((a: { name: string }) => a.name);
    expect(familyAccounts).toContain('Conta conjunta');
    expect(familyAccounts).not.toEqual(expect.arrayContaining(personalAccounts.filter((n: string) => n !== 'Carteira')));
    const members = (await call('GET', '/workspaces/current/members')).body;
    expect(members.map((m: { email: string }) => m.email)).toEqual([DEMO_EMAIL, DEMO_PARTNER_EMAIL]);

    // The tenant role only sees the workspace pinned in the transaction.
    const visible = await client.transaction(async (tx) => {
      await tx.query(`select set_config('role', 'effinance_app', true), set_config('app.workspace_id', $1, true)`, [family.id]);
      return (await tx.query<{ n: number }>('select count(distinct workspace_id)::int as n from accounts')).rows[0]!.n;
    });
    expect(visible).toBe(1);

    const invite = await call('POST', '/workspaces/current/invites', { email: 'amiga@demo.app', role: 'viewer' });
    expect(invite.status).toBe(201);
    expect(invite.body.inviteUrl).toContain('/convite/');

    await call('POST', '/auth/switch-workspace', { workspaceId: me.workspace.id });
    const contacts = (await client.query<{ email: string | null }>('select email from contacts where email is not null')).rows;
    expect(contacts.length).toBeGreaterThan(0);
    expect(contacts.every((c) => c.email!.startsWith('v1.'))).toBe(true);
    const plain = (await call('GET', '/contacts')).body.items.find((c: { email: string | null }) => c.email);
    expect(plain.email).toContain('@');
  });

  it('runs the fake checkout and activates a plan', async () => {
    const checkout = await call('POST', '/billing/checkout', { planCode: 'individual_monthly' });
    expect(checkout.body.checkoutUrl).toContain('#/configuracoes?aba=assinatura&simular=individual_monthly');
    const active = await call('POST', '/billing/dev/activate', { planCode: 'individual_monthly' });
    expect(active.body).toMatchObject({ status: 'active', canWrite: true, plan: { code: 'individual_monthly' } });
    expect((await call('GET', '/billing/plans')).body).toHaveLength(4);
  });

  it('registers new users with default categories', async () => {
    const reg = await call('POST', '/auth/register', { name: 'Teste', email: 'teste@demo.app', password: 'senha12345', acceptTerms: true });
    expect(reg.status).toBe(201);
    const cats = await call('GET', '/categories');
    expect(cats.body.length).toBeGreaterThan(5);
    const sessions = await call('GET', '/auth/sessions');
    expect(sessions.body).toEqual([expect.objectContaining({ current: true })]);
    expect((await call('POST', '/auth/logout')).status).toBe(204);
    expect((await call('GET', '/auth/me')).status).toBe(401);
    expect((await call('POST', '/auth/refresh')).status).toBe(401);
  });
});
