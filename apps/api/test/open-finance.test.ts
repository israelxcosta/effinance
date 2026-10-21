// Open Finance (read-only bank connections) through the HTTP API with the simulated provider: consent,
// connection, linking, sync/resync, webhooks, revocation, permissions, isolation and data protection.

import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays, type BankConnection, type FakeConnectResponse, type SyncResult } from '@effinance/shared';
import type { App } from '../src/app';
import { sanitizeUrl } from '../src/lib/log';
import { executeRows } from '../src/lib/sql';
import { FakeOpenFinanceProvider } from '../src/modules/open-finance/providers/fake';
import { PluggyProvider } from '../src/modules/open-finance/providers/pluggy';
import type { OpenFinanceSetup } from '../src/modules/open-finance/providers/types';
import { syncWindowStart } from '../src/modules/open-finance/service';
import { settleOpenFinanceJobs } from '../src/modules/open-finance/webhooks';
import { TEST_PASSWORD, admin, createAccount, createTestApp, registerUser, resetDb, type Client } from './helpers';

const TODAY = '2026-10-20';
const SECRET = 'whsec_test_0123456789_abcdefghijklmnopqrstuvwxyz';
const CARD = { name: 'Cartão Nubank', bank: 'nubank', brand: 'mastercard', limit: 800000, closingDay: 3, dueDay: 10 };

let app: App;
let fake: FakeOpenFinanceProvider;
let original: OpenFinanceSetup | null | undefined;

beforeAll(async () => {
  app = await createTestApp();
  original = app.platform.openFinance;
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await resetDb(app);
  fake = new FakeOpenFinanceProvider();
  app.platform.openFinance = { provider: fake, webhookUrl: `https://api.teste/api/open-finance/webhooks/fake/${SECRET}`, webhookSecret: SECRET };
});
afterEach(async () => {
  await settleOpenFinanceJobs();
  app.platform.openFinance = original;
});

const rows = <T>(query: ReturnType<typeof sql>) => executeRows<T>(admin(), query);
const workspaceOf = async (c: Client) => (await c.get('/auth/me')).body.workspace.id as string;

async function connect(c: Client, institutionId = 'nubank'): Promise<{ itemId: string; connection: BankConnection }> {
  const { itemId } = (await c.post<FakeConnectResponse>('/open-finance/dev/connect', { institutionId })).body;
  const res = await c.post('/open-finance/connections', { itemId });
  expect(res.status).toBe(201);
  return { itemId, connection: res.body };
}

function webhook(provider: string, secret: string, body: unknown) {
  return app.inject({ method: 'POST', url: `/api/open-finance/webhooks/${provider}/${secret}`, payload: body as object });
}

async function familyWithViewer(owner: Client): Promise<{ workspaceId: string; viewer: Client }> {
  const ws = await owner.post('/workspaces', { name: 'Casa OF', kind: 'family' });
  expect((await owner.post('/auth/switch-workspace', { workspaceId: ws.body.id })).status).toBe(200);
  const email = `leitor-of-${Date.now()}@teste.com`;
  const inv = await owner.post('/workspaces/current/invites', { email, role: 'viewer' });
  const viewer = await registerUser(app, 'Leitor OF', email);
  expect((await viewer.post(`/invites/${inv.body.inviteUrl.split('/convite/')[1]}/accept`)).status).toBe(200);
  return { workspaceId: ws.body.id, viewer };
}

describe('status and consent', () => {
  it('reports the provider, issues connect tokens and hides the feature when disabled', async () => {
    const user = await registerUser(app, 'Status OF');
    expect((await user.get('/open-finance/status')).body).toEqual({ enabled: true, provider: 'fake', sandbox: true });
    const token = await user.post('/open-finance/connect-token', {});
    expect(token.status).toBe(200);
    expect(token.body).toMatchObject({ provider: 'fake', updateItemId: null, sandbox: true });
    expect(token.body.accessToken).toMatch(/^fake-connect-[0-9a-f]{32}$/);
    expect(Date.parse(token.body.expiresAt)).toBeGreaterThan(Date.now());
    expect((await user.get('/open-finance/dev/institutions')).body.map((i: { id: string }) => i.id)).toEqual(
      expect.arrayContaining(['nubank', 'itau', 'bb', 'inter']),
    );
    expect((await user.post('/open-finance/dev/connect', { institutionId: 'banco-x' })).status).toBe(404);

    // Re-consent: the token targets the connection's item.
    const { itemId, connection } = await connect(user);
    expect((await user.post('/open-finance/connect-token', { connectionId: connection.id })).body.updateItemId).toBe(itemId);

    app.platform.openFinance = null;
    expect((await user.get('/open-finance/status')).body).toEqual({ enabled: false, provider: null, sandbox: false });
    expect((await user.post('/open-finance/connect-token', {})).status).toBe(404);
    expect((await user.get('/open-finance/dev/institutions')).status).toBe(404);
    // Data already imported stays readable.
    expect((await user.get('/open-finance/connections')).body).toHaveLength(1);
  });

  it('dev routes exist only with the fake provider', async () => {
    const user = await registerUser(app, 'Dev Routes');
    app.platform.openFinance = {
      provider: new PluggyProvider({ clientId: 'id', clientSecret: 'secret', fetch: async () => new Response('{}', { status: 500 }) }),
      webhookUrl: null,
      webhookSecret: SECRET,
    };
    expect((await user.get('/open-finance/dev/institutions')).status).toBe(404);
    expect((await user.post('/open-finance/dev/connect', { institutionId: 'nubank' })).status).toBe(404);
    // Provider failures become 502 without details.
    const failed = await user.post('/open-finance/connect-token', {});
    expect(failed.status).toBe(502);
    expect(failed.body).toEqual({ error: 'provider_unavailable', message: expect.stringMatching(/não respondeu/) });
  });
});

describe('connection lifecycle (fake provider)', () => {
  it('connect → link (new + existing) → sync → resync → webhook (repeated) → disconnect', async () => {
    const user = await registerUser(app, 'Fluxo Completo');
    const workspaceId = await workspaceOf(user);
    const card = (await user.post('/credit-cards', CARD)).body;

    // 1. Connection: item fetched from the provider, ids encrypted, webhook index written.
    const { itemId, connection } = await connect(user);
    expect(connection).toMatchObject({
      provider: 'fake',
      institution: { name: 'Nubank', bank: 'nubank', imageUrl: null },
      status: 'active',
      statusDetail: null,
      lastSyncAt: null,
    });
    expect(connection.consentExpiresAt).not.toBeNull();
    expect(connection.accounts.map((a) => [a.kind, a.linkedAccountId, a.linkedCreditCardId])).toEqual([
      ['bank', null, null],
      ['credit_card', null, null],
    ]);
    for (const a of connection.accounts) expect(a.number).toMatch(/^•••• \d{4}$/);
    const [stored] = await rows<{ item: string; hash: string }>(sql`select provider_item_id as item, provider_item_hash as hash from bank_connections`);
    expect(stored!.item).toMatch(/^v1\./);
    expect(JSON.stringify(stored)).not.toContain(itemId);
    const feedsRaw = await rows<{ id: string }>(sql`select provider_account_id as id from bank_connection_accounts`);
    expect(feedsRaw.every((f) => f.id.startsWith('v1.') && !f.id.includes(itemId))).toBe(true);
    const index = await rows<{ item_hash: string; workspace_id: string; connection_id: string }>(sql`select * from open_finance_items`);
    expect(index).toEqual([expect.objectContaining({ workspace_id: workspaceId, connection_id: connection.id })]);
    expect(index[0]!.item_hash).toMatch(/^[0-9a-f]{64}$/);

    // Re-sending the same item (re-consent) refreshes it.
    const again = await user.post('/open-finance/connections', { itemId });
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(connection.id);

    // 2. Link: the bank account creates a local account; the card feeds an existing card.
    const [bankFeed, cardFeed] = connection.accounts;
    const syncFrom = addDays(TODAY, -30);
    const linked = await user.put(`/open-finance/connections/${connection.id}/accounts`, {
      links: [
        { connectionAccountId: bankFeed!.id, target: { kind: 'new' }, syncFrom },
        { connectionAccountId: cardFeed!.id, target: { kind: 'credit_card', creditCardId: card.id } },
      ],
    });
    expect(linked.status).toBe(200);
    const newAccountId = linked.body.accounts[0].linkedAccountId as string;
    expect(linked.body.accounts.map((a: { linkedCreditCardId: string | null; syncFrom: string }) => [a.linkedCreditCardId, a.syncFrom])).toEqual([
      [null, syncFrom],
      [card.id, addDays(TODAY, -90)],
    ]);
    expect((await user.get(`/accounts/${newAccountId}`)).body).toMatchObject({ name: 'Nubank — Conta corrente', bank: 'nubank', type: 'checking', icon: 'landmark' });

    // 3. Sync.
    const first = await user.post<SyncResult>(`/open-finance/connections/${connection.id}/sync`);
    expect(first.status).toBe(200);
    expect(first.body.created).toBeGreaterThan(20);
    expect(first.body.updated).toBe(0);
    expect(first.body.connection.lastSyncAt).not.toBeNull();
    expect(first.body.connection.accounts.every((a) => a.lastSyncAt !== null)).toBe(true);

    const accountTxs = (await user.get(`/transactions?accountId=${newAccountId}&pageSize=100`)).body;
    expect(accountTxs.items.length).toBeGreaterThan(5);
    for (const t of accountTxs.items) {
      expect(t).toMatchObject({ origin: 'open_finance', paid: true, paidAt: t.date, accountId: newAccountId });
      expect(t.importBatchId).not.toBeNull();
      expect(t.date >= syncFrom).toBe(true);
    }
    // Card bill payments made from the account are transfers in Effinance, not expenses.
    expect(accountTxs.items.some((t: { description: string }) => /PAGAMENTO FATURA/.test(t.description))).toBe(false);
    // Balance of the new account matches the institution's.
    const [providerBank] = await fake.listAccounts(itemId);
    expect((await user.get(`/accounts/${newAccountId}`)).body.balance).toBe(providerBank!.balance);

    const cardTxs = (await user.get(`/transactions?creditCardId=${card.id}&pageSize=100`)).body.items as {
      type: string;
      date: string;
      paid: boolean;
      invoiceMonth: string;
      description: string;
    }[];
    expect(cardTxs.length).toBeGreaterThan(10);
    expect(cardTxs.every((t) => t.type === 'expense' && !t.paid)).toBe(true);
    // Pending purchases (yesterday/today) are not imported; payments and refunds are not purchases.
    expect(cardTxs.some((t) => t.date >= addDays(TODAY, -1))).toBe(false);
    expect(cardTxs.some((t) => /Pagamento recebido|Estorno/.test(t.description))).toBe(false);
    // Invoice: closing day 3 / due 10 → purchases from 3 Sep to 2 Oct belong to the October invoice
    // (known from the provider's bill), those from 3 Oct on to November's.
    const october = cardTxs.filter((t) => t.date >= '2026-09-03' && t.date <= '2026-10-02');
    expect(october.length).toBeGreaterThan(0);
    expect(new Set(october.map((t) => t.invoiceMonth))).toEqual(new Set(['2026-10']));
    expect(new Set(cardTxs.filter((t) => t.date >= '2026-10-03').map((t) => t.invoiceMonth))).toEqual(new Set(['2026-11']));

    const batches = (await user.get('/imports')).body.items as { origin: string; connectionId: string; accountId: string | null; creditCardId: string | null; createdCount: number }[];
    expect(batches).toHaveLength(2);
    expect(batches.every((b) => b.origin === 'open_finance' && b.connectionId === connection.id)).toBe(true);
    expect(batches.reduce((n, b) => n + b.createdCount, 0)).toBe(first.body.created);

    // 4. Resync: nothing duplicated.
    const total = async () => (await rows<{ n: number }>(sql`select count(*)::int as n from transactions where origin = 'open_finance'`))[0]!.n;
    const before = await total();
    const second = await user.post<SyncResult>(`/open-finance/connections/${connection.id}/sync`);
    expect(second.body).toMatchObject({ created: 0, updated: 0 });
    expect(second.body.skipped).toBeGreaterThan(0);
    expect(await total()).toBe(before);
    expect((await user.get('/imports')).body.total).toBe(2);

    // An amount corrected at the bank within the resync window is updated in place.
    const recent = accountTxs.items.find((t: { date: string }) => t.date >= addDays(TODAY, -6));
    expect(recent).toBeDefined();
    const [external] = await rows<{ external_id: string }>(sql`select external_id from transactions where id = ${recent.id}`);
    fake.adjustTransaction(external!.external_id, recent.amount + 100);
    const third = await user.post<SyncResult>(`/open-finance/connections/${connection.id}/sync`);
    expect(third.body).toMatchObject({ created: 0, updated: 1 });
    expect((await user.get(`/transactions/${recent.id}`)).body.amount).toBe(recent.amount + 100);

    // 5. Webhook: answered at once, processed after, idempotent per event id.
    const event = { event: 'transactions/created', eventId: 'evt-001', itemId, accountId: 'ignored', createdTransactionsLink: 'https://evil.example/x' };
    const hook = await webhook('fake', SECRET, event);
    expect(hook.statusCode).toBe(200);
    expect(hook.json()).toEqual({ received: true, duplicate: false });
    await settleOpenFinanceJobs();
    const [evt] = await rows<{ processed_at: Date | null }>(sql`select processed_at from open_finance_events where event_id = 'evt-001'`);
    expect(evt!.processed_at).not.toBeNull();
    const repeated = await webhook('fake', SECRET, event);
    expect(repeated.json()).toEqual({ received: true, duplicate: true });
    await settleOpenFinanceJobs();
    expect(await total()).toBe(before);
    const synced = await rows<{ metadata: Record<string, unknown> }>(sql`select metadata from audit_logs where action = 'open_finance.synced' and user_id is null`);
    expect(synced).toHaveLength(1);
    expect(synced[0]!.metadata).toMatchObject({ trigger: 'webhook', event: 'transactions/created', created: 0 });

    // 6. Disconnect: revoked at the provider, routing gone, imported data kept.
    expect((await user.del(`/open-finance/connections/${connection.id}`)).status).toBe(204);
    expect(await fake.getItem(itemId)).toBeNull();
    expect(await rows(sql`select 1 from open_finance_items`)).toEqual([]);
    expect(await total()).toBe(before);
    expect((await user.get('/imports')).body.items.every((b: { connectionId: string | null }) => b.connectionId === null)).toBe(true);
    expect((await user.get('/open-finance/connections')).body).toEqual([]);
    // Webhooks of the revoked item are ignored.
    expect((await webhook('fake', SECRET, { ...event, eventId: 'evt-002' })).statusCode).toBe(200);
    await settleOpenFinanceJobs();

    const actions = (await rows<{ action: string }>(sql`select action from audit_logs where action like 'open_finance.%' order by created_at`)).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['open_finance.connected', 'open_finance.synced', 'open_finance.disconnected']));
    expect(JSON.stringify(await rows(sql`select metadata, entity_id from audit_logs`))).not.toContain(itemId);
  });

  it('never recreates rows the user undid, deleted or moved (tombstones)', async () => {
    const user = await registerUser(app, 'Exclusões Respeitadas');
    const { connection } = await connect(user, 'nubank');
    const accountId = await createAccount(user, { name: 'Destino' });
    const otherId = await createAccount(user, { name: 'Outra conta' });
    const cardId = (await user.post('/credit-cards', CARD)).body.id as string;
    const syncFrom = addDays(TODAY, -6); // inside the 7-day resync overlap: everything is re-read
    await user.put(`/open-finance/connections/${connection.id}/accounts`, {
      links: [
        { connectionAccountId: connection.accounts[0]!.id, target: { kind: 'account', accountId }, syncFrom },
        { connectionAccountId: connection.accounts[1]!.id, target: { kind: 'credit_card', creditCardId: cardId }, syncFrom },
      ],
    });
    const sync = () => user.post<SyncResult>(`/open-finance/connections/${connection.id}/sync`);
    expect((await sync()).body.created).toBeGreaterThan(2);
    const ofTotal = async (filter: string) => (await user.get(`/transactions?${filter}&origin=open_finance`)).body.total as number;
    const accountRows = (await user.get(`/transactions?accountId=${accountId}&origin=open_finance`)).body.items as { id: string }[];
    expect(accountRows.length).toBeGreaterThanOrEqual(2);
    const cardBatch = (await user.get('/imports')).body.items.find((b: { creditCardId: string | null }) => b.creditCardId === cardId);
    expect(cardBatch.createdCount).toBeGreaterThan(0);

    // Deleted by hand, moved to another account, and a whole batch undone.
    expect((await user.del(`/transactions/${accountRows[0]!.id}`)).status).toBe(204);
    expect((await user.put(`/transactions/${accountRows[1]!.id}`, { accountId: otherId })).status).toBe(200);
    expect((await user.del(`/imports/${cardBatch.id}`)).status).toBe(204);

    const resync = await sync();
    expect(resync.body).toMatchObject({ created: 0, updated: 0 });
    expect(await ofTotal(`accountId=${accountId}`)).toBe(accountRows.length - 2);
    expect(await ofTotal(`accountId=${otherId}`)).toBe(1);
    expect(await ofTotal(`creditCardId=${cardId}`)).toBe(0);
    const [tombstones] = await rows<{ n: number }>(sql`select count(*)::int as n from import_tombstones`);
    expect(tombstones!.n).toBe(1 + cardBatch.createdCount);
  });

  it('marks the connection when the item is gone at the provider (webhook item/deleted)', async () => {
    const user = await registerUser(app, 'Item Removido');
    const { itemId, connection } = await connect(user, 'itau');
    await fake.deleteItem(itemId);
    expect((await webhook('fake', SECRET, { event: 'item/deleted', eventId: 'evt-del', itemId })).statusCode).toBe(200);
    await settleOpenFinanceJobs();
    const [after] = (await user.get('/open-finance/connections')).body as BankConnection[];
    expect(after).toMatchObject({ id: connection.id, status: 'error', statusDetail: expect.stringMatching(/não existe mais/) });
  });

  it('maps consent problems to the connection status', async () => {
    const user = await registerUser(app, 'Consentimento');
    const { itemId, connection } = await connect(user, 'bb');
    fake.setItemStatus(itemId, 'login_error');
    const res = await user.post<SyncResult>(`/open-finance/connections/${connection.id}/sync`);
    expect(res.body.connection).toMatchObject({ status: 'login_error', statusDetail: expect.stringMatching(/consentimento/) });
  });

  it('validates links: kinds, one feed per local account/card, history window', async () => {
    const user = await registerUser(app, 'Vínculos');
    const accountId = await createAccount(user);
    const cardId = (await user.post('/credit-cards', CARD)).body.id;
    const a = (await connect(user, 'nubank')).connection;
    const b = (await connect(user, 'inter')).connection;
    const put = (c: BankConnection, links: unknown[]) => user.put(`/open-finance/connections/${c.id}/accounts`, { links });

    expect((await put(a, [{ connectionAccountId: a.accounts[0]!.id, target: { kind: 'credit_card', creditCardId: cardId } }])).status).toBe(422);
    expect((await put(a, [{ connectionAccountId: a.accounts[1]!.id, target: { kind: 'account', accountId } }])).status).toBe(422);
    expect((await put(a, [{ connectionAccountId: a.accounts[0]!.id, target: { kind: 'account', accountId }, syncFrom: addDays(TODAY, -400) }])).status).toBe(422);
    expect((await put(a, [{ connectionAccountId: a.accounts[0]!.id, target: { kind: 'account', accountId }, syncFrom: addDays(TODAY, 1) }])).status).toBe(422);
    expect((await put(a, [{ connectionAccountId: b.accounts[0]!.id, target: { kind: 'account', accountId } }])).status).toBe(404);
    expect((await put(a, [{ connectionAccountId: a.accounts[0]!.id, target: { kind: 'account', accountId } }])).status).toBe(200);
    const taken = await put(b, [{ connectionAccountId: b.accounts[0]!.id, target: { kind: 'account', accountId } }]);
    expect(taken.status).toBe(409);
    // 'ignore' releases the account; a new card defaults to paying from the linked account.
    const ignored = await put(a, [{ connectionAccountId: a.accounts[0]!.id, target: { kind: 'ignore' } }]);
    expect(ignored.body.accounts[0].linkedAccountId).toBeNull();
    const both = await put(b, [
      { connectionAccountId: b.accounts[0]!.id, target: { kind: 'account', accountId } },
      { connectionAccountId: b.accounts[1]!.id, target: { kind: 'new' } },
    ]);
    const newCard = (await user.get('/credit-cards')).body.find((c: { id: string }) => c.id === both.body.accounts[1].linkedCreditCardId);
    expect(newCard).toMatchObject({ bank: 'inter', brand: 'mastercard', limit: 800000, closingDay: 3, dueDay: 10, defaultAccountId: accountId });
  });

  it('computes the resync window from syncFrom, the last sync and the latest transaction', () => {
    const at = (iso: string) => new Date(`${iso}T15:00:00Z`);
    expect(syncWindowStart({ syncFrom: '2026-08-01', lastSyncAt: null, cursor: null })).toBe('2026-08-01');
    expect(syncWindowStart({ syncFrom: '2026-08-01', lastSyncAt: at('2026-10-20'), cursor: '2026-10-19' })).toBe('2026-10-12');
    // The provider was stale for weeks: re-read from a week before the newest transaction seen.
    expect(syncWindowStart({ syncFrom: '2026-08-01', lastSyncAt: at('2026-10-20'), cursor: '2026-09-20' })).toBe('2026-09-13');
    expect(syncWindowStart({ syncFrom: '2026-10-15', lastSyncAt: at('2026-10-20'), cursor: '2026-10-19' })).toBe('2026-10-15');
  });
});

describe('security', () => {
  it("refuses another customer's item and items that do not exist", async () => {
    const alice = await registerUser(app, 'Alice OF');
    const bob = await registerUser(app, 'Bob OF');
    const { itemId } = (await alice.post('/open-finance/dev/connect', { institutionId: 'nubank' })).body;
    const stolen = await bob.post('/open-finance/connections', { itemId });
    expect(stolen.status).toBe(404);
    expect((await bob.post('/open-finance/connections', { itemId: 'fake_nubank_00000000000000000000000000000000_000000000000' })).status).toBe(404);
    expect((await bob.post('/open-finance/connections', { itemId: 'qualquer-coisa' })).status).toBe(404);
    expect(await rows(sql`select 1 from bank_connections`)).toEqual([]);
    // Alice can still use it.
    expect((await alice.post('/open-finance/connections', { itemId })).status).toBe(201);
  });

  it('accepts only Open Finance connectors outside the sandbox (Pluggy)', async () => {
    const user = await registerUser(app, 'Somente OF');
    const workspaceId = await workspaceOf(user);
    let connector = { name: 'Banco Raspagem', isOpenFinance: false, isSandbox: false, imageUrl: 'http://cdn.example/x.png' };
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
      if (url.endsWith('/auth')) return json({ apiKey: 'key' });
      if (url.includes('/items/')) return json({ id: 'item-1', status: 'UPDATED', clientUserId: workspaceId, connector });
      if (url.includes('/accounts')) return json({ results: [], page: 1, totalPages: 1 });
      return json({}, 404);
    };
    const setup = (sandbox: boolean): OpenFinanceSetup => ({
      provider: new PluggyProvider({ clientId: 'id', clientSecret: 'secret', sandbox, fetch: fetchImpl }),
      webhookUrl: null,
      webhookSecret: SECRET,
    });
    app.platform.openFinance = setup(false);
    const refused = await user.post('/open-finance/connections', { itemId: 'item-1' });
    expect(refused.status).toBe(422);
    expect(refused.body.message).toMatch(/Open Finance/);
    connector = { ...connector, isOpenFinance: true, isSandbox: true };
    expect((await user.post('/open-finance/connections', { itemId: 'item-1' })).status).toBe(422);
    app.platform.openFinance = setup(true);
    const sandbox = await user.post('/open-finance/connections', { itemId: 'item-1' });
    expect(sandbox.status).toBe(201);
    // Non-https images from the provider are dropped.
    expect(sandbox.body.institution).toMatchObject({ name: 'Banco Raspagem', imageUrl: null, bank: null });
  });

  it('authenticates webhooks by the path secret and validates the envelope', async () => {
    const user = await registerUser(app, 'Webhook Seguro');
    const { itemId } = await connect(user);
    const ok = { event: 'item/updated', eventId: 'evt-x', itemId };
    expect((await webhook('fake', `${SECRET.slice(0, -1)}X`, ok)).statusCode).toBe(401);
    expect((await webhook('fake', 'curto', ok)).statusCode).toBe(401);
    expect((await webhook('pluggy', SECRET, ok)).statusCode).toBe(404);
    expect((await webhook('fake', SECRET, { event: 'item/updated' })).statusCode).toBe(400);
    expect((await webhook('fake', SECRET, { ...ok, eventId: 'e'.repeat(201) })).statusCode).toBe(400);
    expect(await rows(sql`select 1 from open_finance_events`)).toEqual([]);
    // Without a configured secret the route does not exist.
    app.platform.openFinance = { provider: fake, webhookUrl: null, webhookSecret: null };
    expect((await webhook('fake', SECRET, ok)).statusCode).toBe(404);
    expect(sanitizeUrl(`/api/open-finance/webhooks/pluggy/${SECRET}`)).toBe('/api/open-finance/webhooks/pluggy/[secret]');
    expect(sanitizeUrl(`/api/open-finance/webhooks/pluggy/${SECRET}?x=1`)).toBe('/api/open-finance/webhooks/pluggy/[secret]?x=[redacted]');
  });

  it('viewers read; writes need editor/owner and an active subscription', async () => {
    const owner = await registerUser(app, 'Dona OF');
    const { workspaceId, viewer } = await familyWithViewer(owner);
    const { itemId, connection } = await connect(owner);
    const mutations: [string, string, unknown?][] = [
      ['POST', '/open-finance/connect-token', {}],
      ['POST', '/open-finance/dev/connect', { institutionId: 'nubank' }],
      ['POST', '/open-finance/connections', { itemId }],
      ['PUT', `/open-finance/connections/${connection.id}/accounts`, { links: [{ connectionAccountId: connection.accounts[0]!.id, target: { kind: 'ignore' } }] }],
      ['POST', `/open-finance/connections/${connection.id}/sync`],
      ['DELETE', `/open-finance/connections/${connection.id}`],
    ];
    const call = (c: Client, method: string, url: string, body?: unknown) =>
      app.inject({ method: method as 'POST', url: `/api${url}`, headers: { authorization: `Bearer ${c.token}` }, ...(body !== undefined ? { payload: body as object } : {}) });
    for (const [method, url, body] of mutations) expect((await call(viewer, method, url, body)).statusCode, `${method} ${url}`).toBe(403);
    expect((await viewer.get('/open-finance/status')).status).toBe(200);
    expect((await viewer.get('/open-finance/connections')).body).toHaveLength(1);

    await admin().execute(sql`update subscriptions set trial_ends_at = now() - interval '1 day' where workspace_id = ${workspaceId}`);
    for (const [method, url, body] of mutations) expect((await call(owner, method, url, body)).statusCode, `${method} ${url}`).toBe(402);
    expect((await owner.get('/open-finance/connections')).status).toBe(200);
  });

  it('never reaches another workspace', async () => {
    const alice = await registerUser(app, 'Alice Conexões');
    const bob = await registerUser(app, 'Bob Conexões');
    const { connection } = await connect(alice);
    const aliceAccount = await createAccount(alice);
    const bobAccount = await createAccount(bob);
    const { connection: bobConnection } = await connect(bob, 'inter');

    expect((await bob.post(`/open-finance/connections/${connection.id}/sync`)).status).toBe(404);
    expect((await bob.del(`/open-finance/connections/${connection.id}`)).status).toBe(404);
    expect((await bob.post('/open-finance/connect-token', { connectionId: connection.id })).status).toBe(404);
    expect(
      (await bob.put(`/open-finance/connections/${connection.id}/accounts`, { links: [{ connectionAccountId: connection.accounts[0]!.id, target: { kind: 'account', accountId: bobAccount } }] })).status,
    ).toBe(404);
    // Bob's own connection, pointed at Alice's account or at Alice's connection account.
    expect(
      (await bob.put(`/open-finance/connections/${bobConnection.id}/accounts`, { links: [{ connectionAccountId: bobConnection.accounts[0]!.id, target: { kind: 'account', accountId: aliceAccount } }] })).status,
    ).toBe(404);
    expect(
      (await bob.put(`/open-finance/connections/${bobConnection.id}/accounts`, { links: [{ connectionAccountId: connection.accounts[0]!.id, target: { kind: 'account', accountId: bobAccount } }] })).status,
    ).toBe(404);
    expect((await bob.get('/open-finance/connections')).body.map((c: BankConnection) => c.id)).toEqual([bobConnection.id]);
  });

  it('exports connection metadata without provider ids and revokes items when workspaces or accounts are deleted', async () => {
    const owner = await registerUser(app, 'Exclusões OF');
    const personal = await connect(owner, 'nubank');
    const exported = (await owner.get('/workspaces/current/export')).body;
    expect(exported.bankConnections).toEqual([
      expect.objectContaining({ id: personal.connection.id, provider: 'fake', institution: 'Nubank', status: 'active', accounts: expect.any(Array) }),
    ]);
    expect(exported.importBatches).toEqual([]);
    const text = JSON.stringify(exported);
    expect(text).not.toContain(personal.itemId);
    expect(text).not.toMatch(/providerItem|providerAccount|Hash|cursor|externalId/);

    // Deleting a shared workspace revokes its items.
    await owner.post('/workspaces', { name: 'Empresa OF', kind: 'business' });
    const business = (await owner.get('/workspaces')).body.find((w: { name: string }) => w.name === 'Empresa OF');
    await owner.post('/auth/switch-workspace', { workspaceId: business.id });
    const shared = await connect(owner, 'itau');
    expect((await owner.del('/workspaces/current', { confirmName: 'Empresa OF' })).status).toBe(204);
    expect(await fake.getItem(shared.itemId)).toBeNull();
    expect(await fake.getItem(personal.itemId)).not.toBeNull();

    // Deleting the account revokes the items of the workspaces it owns.
    expect((await owner.del('/auth/me', { password: TEST_PASSWORD })).status).toBe(204);
    expect(await fake.getItem(personal.itemId)).toBeNull();
    expect(await rows(sql`select 1 from open_finance_items`)).toEqual([]);
  });
});

describe('production environment (Open Finance)', () => {
  const hardened: Record<string, string> = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgres://api:secret@db.internal:5432/effinance',
    DATABASE_SSL: 'verify-full',
    DATABASE_CA_FILE: '/etc/ssl/rds-global-bundle.pem',
    JWT_SECRET: 'Zx9-'.repeat(12),
    KEY_PROVIDER: 'aws',
    KMS_KEY_ID: 'arn:aws:kms:sa-east-1:111122223333:key/abcd',
    AWS_REGION: 'sa-east-1',
    BILLING_PROVIDER: 'mercadopago',
    MP_ACCESS_TOKEN: 'APP_USR-token',
    MP_WEBHOOK_SECRET: 'whsec',
    MAILER: 'ses',
    APP_URL: 'https://app.effinance.com.br',
    CORS_ORIGIN: 'https://app.effinance.com.br',
  };
  const pluggy = {
    OPEN_FINANCE_PROVIDER: 'pluggy',
    PLUGGY_CLIENT_ID: 'client-id',
    PLUGGY_CLIENT_SECRET: 'client-secret',
    OPEN_FINANCE_WEBHOOK_SECRET: 'Qx7_'.repeat(12),
    API_PUBLIC_URL: 'https://api.effinance.com.br/',
  };

  async function loadEnv(overrides: Record<string, string | undefined>) {
    vi.resetModules();
    for (const [k, v] of Object.entries({ ...hardened, ...overrides })) vi.stubEnv(k, v);
    try {
      const mod = await import('../src/env');
      return { env: mod.env, error: null as string | null, provider: mod.openFinanceProviderOf(mod.env) };
    } catch (error) {
      return { env: null, error: (error as Error).message, provider: null };
    } finally {
      vi.unstubAllEnvs();
    }
  }

  it('is disabled by default in production and accepts a complete Pluggy setup', async () => {
    expect((await loadEnv({})).provider).toBe('disabled');
    const ok = await loadEnv(pluggy);
    expect(ok.error).toBeNull();
    expect(ok.provider).toBe('pluggy');
    expect(ok.env!.API_PUBLIC_URL).toBe('https://api.effinance.com.br');
  });

  it.each([
    ['the fake provider', { OPEN_FINANCE_PROVIDER: 'fake' }, 'OPEN_FINANCE_PROVIDER'],
    ['missing Pluggy credentials', { ...pluggy, PLUGGY_CLIENT_SECRET: undefined }, 'PLUGGY_CLIENT_ID'],
    ['missing webhook secret', { ...pluggy, OPEN_FINANCE_WEBHOOK_SECRET: undefined }, 'OPEN_FINANCE_WEBHOOK_SECRET'],
    ['short webhook secret', { ...pluggy, OPEN_FINANCE_WEBHOOK_SECRET: 'a'.repeat(40) }, 'OPEN_FINANCE_WEBHOOK_SECRET'],
    ['placeholder webhook secret', { ...pluggy, OPEN_FINANCE_WEBHOOK_SECRET: `change-me-${'a'.repeat(40)}` }, 'OPEN_FINANCE_WEBHOOK_SECRET'],
    ['webhook secret with URL characters', { ...pluggy, OPEN_FINANCE_WEBHOOK_SECRET: `${'a'.repeat(40)}/../x?y` }, 'OPEN_FINANCE_WEBHOOK_SECRET'],
    ['plain-http public URL', { ...pluggy, API_PUBLIC_URL: 'http://api.effinance.com.br' }, 'API_PUBLIC_URL'],
    ['missing public URL', { ...pluggy, API_PUBLIC_URL: undefined }, 'API_PUBLIC_URL'],
    ['sandbox connectors', { ...pluggy, PLUGGY_SANDBOX: 'true' }, 'PLUGGY_SANDBOX'],
  ])('refuses %s', async (_label, overrides, variable) => {
    const { error } = await loadEnv(overrides);
    expect(error).toContain(variable);
  });
});
