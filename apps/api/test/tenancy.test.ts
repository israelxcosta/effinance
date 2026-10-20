import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { App } from '../src/app';
import { accounts, contacts, workspaces } from '../src/db/schema';
import type { MemoryMailer } from '../src/lib/mailer';
import { executeRows } from '../src/lib/sql';
import { withTenant } from '../src/lib/tenant';
import { createAccount, createTestApp, registerUser, resetDb, type Client } from './helpers';

let app: App;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await resetDb(app);
  (app.platform.mailer as MemoryMailer).outbox.length = 0;
});

async function workspaceOf(c: Client): Promise<string> {
  return (await c.get('/auth/me')).body.workspace.id;
}

/** Creates a family workspace for `owner` and switches to it. */
async function familyWorkspace(owner: Client, name = 'Família Teste'): Promise<string> {
  const created = await owner.post('/workspaces', { name, kind: 'family' });
  expect(created.status).toBe(201);
  expect(created.body).toMatchObject({ name, kind: 'family', role: 'owner', subscription: { status: 'trialing' } });
  const switched = await owner.post('/auth/switch-workspace', { workspaceId: created.body.id });
  expect(switched.status).toBe(200);
  expect(switched.body.workspace.id).toBe(created.body.id);
  return created.body.id;
}

async function invite(owner: Client, email: string, role: 'editor' | 'viewer' = 'viewer') {
  return owner.post('/workspaces/current/invites', { email, role });
}

/** Drizzle wraps the driver error; the Postgres message is in `cause`. */
async function pgError(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const e = error as Error & { cause?: Error };
    return e.cause?.message ?? e.message;
  }
  return 'no error';
}

function tokenFromUrl(url: string): string {
  return url.split('/convite/')[1]!;
}

describe('row level security', () => {
  it('a tenant transaction only sees its own rows, even without a workspace filter', async () => {
    const alice = await registerUser(app, 'Alice');
    const bob = await registerUser(app, 'Bob');
    await createAccount(alice, { name: 'Conta Alice' });
    await createAccount(bob, { name: 'Conta Bob' });
    const wa = await workspaceOf(alice);
    const wb = await workspaceOf(bob);

    const names = await withTenant(app.db, wa, async (tx) =>
      executeRows<{ name: string }>(tx, sql`select name from accounts order by name`),
    );
    expect(names.map((r) => r.name)).toEqual(['Carteira', 'Conta Alice']);
    const count = await withTenant(app.db, wa, async (tx) =>
      executeRows<{ n: number }>(tx, sql`select count(*)::int as n from transactions`),
    );
    expect(count[0]!.n).toBe(0);

    // Writing a row for another workspace violates the policy (WITH CHECK).
    expect(
      await pgError(
        withTenant(app.db, wa, (tx) =>
          tx.insert(accounts).values({ workspaceId: wb, name: 'Intrusa', type: 'checking', color: '#000000', icon: 'wallet' }),
        ),
      ),
    ).toMatch(/row-level security/);
    // Updates cannot reach other tenants' rows either.
    const updated = await withTenant(app.db, wa, (tx) =>
      executeRows(tx, sql`update accounts set name = 'hacked' where workspace_id = ${wb} returning id`),
    );
    expect(updated).toHaveLength(0);
  });

  it('without the tenant setting no row is visible, and the app role cannot read identity tables', async () => {
    const alice = await registerUser(app, 'Alice');
    await createAccount(alice, { name: 'Conta Alice' });
    const rows = await app.db.transaction(async (tx) => {
      await tx.execute(sql`set local role effinance_app`);
      return executeRows<{ n: number }>(tx, sql`select count(*)::int as n from accounts`);
    });
    expect(rows[0]!.n).toBe(0);
    expect(
      await pgError(
        app.db.transaction(async (tx) => {
          await tx.execute(sql`set local role effinance_app`);
          await tx.execute(sql`select * from users`);
        }),
      ),
    ).toMatch(/permission denied for table users/);
  });
});

describe('roles, subscription and members', () => {
  it('invites, accepts, enforces viewer read-only and plan member limits', async () => {
    const owner = await registerUser(app, 'Dona');
    // Personal workspace in trial: individual, no members.
    const blocked = await invite(owner, 'alguem@teste.com');
    expect(blocked.status).toBe(422);

    const familyId = await familyWorkspace(owner);
    const inv = await invite(owner, 'convidado@teste.com', 'viewer');
    expect(inv.status).toBe(201);
    expect(inv.body).toMatchObject({ email: 'convidado@teste.com', role: 'viewer' });
    expect(inv.body.inviteUrl).toMatch(/\/convite\//);
    const mail = (app.platform.mailer as MemoryMailer).outbox.at(-1)!;
    expect(mail.to).toBe('convidado@teste.com');
    expect(mail.text).toContain(inv.body.inviteUrl);
    const token = tokenFromUrl(inv.body.inviteUrl);

    const preview = await app.inject({ method: 'GET', url: `/api/invites/${token}` });
    expect(preview.json()).toMatchObject({ workspaceName: 'Família Teste', workspaceKind: 'family', invitedBy: 'Dona', expired: false });

    // Someone else cannot use it.
    const stranger = await registerUser(app, 'Estranho');
    expect((await stranger.post(`/invites/${token}/accept`)).status).toBe(403);

    const guest = await registerUser(app, 'Convidado', 'convidado@teste.com');
    const accepted = await guest.post(`/invites/${token}/accept`);
    expect(accepted.status).toBe(200);
    expect(accepted.body.workspace).toMatchObject({ id: familyId, role: 'viewer' });
    expect(accepted.body.workspaces).toHaveLength(2);
    expect((await guest.post(`/invites/${token}/accept`)).status).toBe(404);

    // Viewer: reads, never writes.
    expect((await guest.get('/accounts')).status).toBe(200);
    const denied = await guest.post('/accounts', { name: 'x', type: 'checking' });
    expect(denied.status).toBe(403);
    expect(denied.body.error).toBe('forbidden');
    expect((await guest.post('/billing/checkout', { planCode: 'family_monthly' })).status).toBe(403);
    expect((await guest.get('/workspaces/current/export')).status).toBe(403);

    // Promoted to editor: takes effect on the next request.
    const promoted = await owner.patch(`/workspaces/current/members/${guest.userId}`, { role: 'editor' });
    expect(promoted.body).toMatchObject({ role: 'editor', name: 'Convidado' });
    expect((await guest.post('/accounts', { name: 'Conta da casa', type: 'checking' })).status).toBe(201);

    const members = await owner.get('/workspaces/current/members');
    expect(members.body.map((m: any) => [m.name, m.role, m.isYou])).toEqual([
      ['Dona', 'owner', true],
      ['Convidado', 'editor', false],
    ]);

    // Trial family workspace allows 5 people: 2 members + 3 pending invites, the next one is refused.
    for (const n of [1, 2, 3]) expect((await invite(owner, `p${n}@teste.com`)).status).toBe(201);
    const over = await invite(owner, 'p4@teste.com');
    expect(over.status).toBe(422);
    expect(over.body.message).toMatch(/até 5 membros/);
    expect((await owner.get('/workspaces/current/invites')).body).toHaveLength(3);

    // Removed member loses access at once; refreshing moves them back to their own workspace.
    expect((await owner.del(`/workspaces/current/members/${guest.userId}`)).status).toBe(204);
    expect((await guest.get('/accounts')).status).toBe(401);
    const refreshed = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      cookies: { effinance_refresh: guest.refreshToken! },
    });
    expect(refreshed.statusCode).toBe(204);
    const newToken = refreshed.cookies.find((c) => c.name === 'effinance_token')!.value;
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${newToken}` } });
    expect(me.json().workspace.kind).toBe('personal');
  });

  it('blocks writes with 402 when the trial is over; reads and export keep working', async () => {
    const owner = await registerUser(app, 'Expirada');
    const workspaceId = await workspaceOf(owner);
    await app.db.execute(sql`update subscriptions set trial_ends_at = now() - interval '1 day' where workspace_id = ${workspaceId}`);

    const me = await owner.get('/auth/me');
    expect(me.body.workspace.subscription).toMatchObject({ status: 'expired', canWrite: false });
    const write = await owner.post('/accounts', { name: 'Nova', type: 'checking' });
    expect(write.status).toBe(402);
    expect(write.body.error).toBe('subscription_required');
    expect((await owner.get('/accounts')).status).toBe(200);
    expect((await owner.get('/workspaces/current/export')).status).toBe(200);

    // Fake provider: checkout → simulated activation.
    const checkout = await owner.post('/billing/checkout', { planCode: 'individual_monthly' });
    expect(checkout.status).toBe(200);
    expect(checkout.body.checkoutUrl).toContain('simular=individual_monthly');
    expect((await owner.get('/billing/subscription')).body).toMatchObject({ status: 'pending', canWrite: false });
    const activated = await owner.post('/billing/dev/activate', { planCode: 'individual_monthly' });
    expect(activated.body).toMatchObject({ status: 'active', canWrite: true, plan: { code: 'individual_monthly' }, maxMembers: 1 });
    expect((await owner.post('/accounts', { name: 'Nova', type: 'checking' })).status).toBe(201);

    // Cancel: stays usable until the end of the paid period.
    const canceled = await owner.post('/billing/cancel');
    expect(canceled.body).toMatchObject({ cancelAtPeriodEnd: true, canWrite: true });
    expect((await owner.post('/billing/checkout', { planCode: 'business_monthly' })).status).toBe(422);
  });
});

describe('workspace lifecycle and LGPD', () => {
  it('exports decrypted data, lists the audit log and crypto-shreds a deleted workspace', async () => {
    const owner = await registerUser(app, 'Titular');
    const familyId = await familyWorkspace(owner, 'Casa');
    const account = await createAccount(owner, { name: 'Conjunta' });
    const contact = await owner.post('/contacts', { name: 'Diarista', document: '529.982.247-25', phone: '(11) 98765-4321' });
    expect(contact.status).toBe(201);
    await owner.post('/transactions', {
      type: 'expense',
      description: 'Faxina',
      amount: 15000,
      date: '2026-10-10',
      accountId: account,
      contactId: contact.body.id,
      notes: 'Pagar em dinheiro',
    });

    const exported = await app.inject({
      method: 'GET',
      url: '/api/workspaces/current/export',
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(exported.statusCode).toBe(200);
    expect(exported.headers['content-disposition']).toMatch(/attachment; filename="effinance-/);
    const data = exported.json();
    expect(data.workspace).toMatchObject({ id: familyId, name: 'Casa' });
    expect(data.contacts[0]).toMatchObject({ document: '52998224725', phone: '11987654321' });
    expect(data.contacts[0].documentHash).toBeUndefined();
    expect(data.transactions[0].notes).toBe('Pagar em dinheiro');
    expect(data.members).toEqual([expect.objectContaining({ name: 'Titular', role: 'owner' })]);

    const auditLog = await owner.get('/workspaces/current/audit');
    expect(auditLog.body.items.map((e: any) => e.action)).toEqual(
      expect.arrayContaining(['workspace.created', 'data.exported']),
    );
    expect(auditLog.body.items[0]).toMatchObject({ userName: 'Titular' });

    expect((await owner.del('/workspaces/current')).status).toBe(400);
    expect((await owner.del('/workspaces/current', { confirmName: 'Outro nome' })).status).toBe(422);
    const removed = await owner.del('/workspaces/current', { confirmName: 'Casa' });
    expect(removed.status).toBe(204);
    // Session moved back to the personal workspace; rows and the wrapped key are gone.
    expect((await owner.get('/auth/me')).body.workspace.kind).toBe('personal');
    expect(await app.db.select().from(workspaces).where(sql`${workspaces.id} = ${familyId}`)).toEqual([]);
    expect(await app.db.select().from(contacts).where(sql`${contacts.workspaceId} = ${familyId}`)).toEqual([]);

    // The personal workspace goes only with the account.
    const personal = await owner.del('/workspaces/current', { confirmName: 'Pessoal' });
    expect(personal.status).toBe(422);
  });

  it('deletes the account with every owned workspace', async () => {
    const owner = await registerUser(app, 'Saindo');
    const wrong = await app.inject({
      method: 'DELETE',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${owner.token}` },
      payload: { password: 'errada-123' },
    });
    expect(wrong.statusCode).toBe(422);
    const ok = await app.inject({
      method: 'DELETE',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${owner.token}` },
      payload: { password: 'senha-segura-123' },
    });
    expect(ok.statusCode).toBe(204);
    expect((await owner.get('/auth/me')).status).toBe(401);
    const rows = await executeRows<{ n: number }>(app.db, sql`select count(*)::int as n from workspaces`);
    expect(rows[0]!.n).toBe(0);
  });
});
