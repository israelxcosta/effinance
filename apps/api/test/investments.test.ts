import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { App } from '../src/app';
import { executeRows } from '../src/lib/sql';
import { admin, createAccount, createTestApp, registerUser, resetDb, type Client } from './helpers';

let app: App;
let c: Client;
let broker: string;

beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await resetDb(app);
  c = await registerUser(app);
  broker = await createAccount(c, { name: 'XP Investimentos', type: 'investment', bank: 'xp' });
});

const buy = (body: Record<string, unknown>) =>
  c.post('/investments/purchases', { assetType: 'stock', ticker: 'PETR4', date: '2026-11-26', quantity: 100, unitPrice: 1500, ...body });

describe('investments (portfolio purchases)', () => {
  it('records purchases and computes position and average price', async () => {
    const first = await buy({ fees: 490, accountId: broker });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ ticker: 'PETR4', quantity: 100, unitPrice: 1500, fees: 490, total: 150490 });
    expect(first.body.account).toMatchObject({ id: broker, name: 'XP Investimentos' });
    await buy({ ticker: 'petr4', date: '2026-12-03', quantity: 50, unitPrice: 1800 });
    await buy({ assetType: 'fii', ticker: 'HGLG11', name: 'CSHG Logística', quantity: 10, unitPrice: 16000 });

    const r = (await c.get('/investments')).body;
    expect(r.totalInvested).toBe(150490 + 90000 + 160000);
    expect(r.positions.map((p: any) => [p.ticker, p.quantity, p.totalInvested, p.averagePrice, p.purchases])).toEqual([
      ['PETR4', 150, 240490, 1603, 2],
      ['HGLG11', 10, 160000, 16000, 1],
    ]);
    expect(r.positions[1]).toMatchObject({ assetType: 'fii', name: 'CSHG Logística' });
    // Newest purchase first.
    expect(r.purchases.map((p: any) => p.date)).toEqual(['2026-12-03', '2026-11-26', '2026-11-26']);
  });

  it('accepts fractional quantities (crypto) and edits / deletes purchases', async () => {
    const btc = (await buy({ assetType: 'crypto', ticker: 'BTC', quantity: 0.015, unitPrice: 50000000 })).body;
    expect(btc.total).toBe(750000);
    const edited = await c.put(`/investments/purchases/${btc.id}`, {
      assetType: 'crypto', ticker: 'BTC', date: '2026-11-20', quantity: 0.02, unitPrice: 50000000, fees: 0,
    });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ quantity: 0.02, total: 1000000, date: '2026-11-20' });
    expect((await c.del(`/investments/purchases/${btc.id}`)).status).toBe(204);
    expect((await c.get('/investments')).body.positions).toEqual([]);
  });

  it('validates the input and the broker account', async () => {
    expect((await buy({ quantity: 0 })).status).toBe(400);
    expect((await buy({ unitPrice: 0 })).status).toBe(400);
    expect((await buy({ ticker: '' })).status).toBe(400);
    expect((await buy({ assetType: 'option' })).status).toBe(400);
    const checking = await createAccount(c, { name: 'Corrente' });
    expect((await buy({ accountId: checking })).status).toBe(422);
  });

  it('keeps the purchases when the broker account is deleted', async () => {
    await buy({ accountId: broker });
    expect((await c.del(`/accounts/${broker}`)).status).toBeLessThan(300);
    const r = (await c.get('/investments')).body;
    expect(r.purchases[0]).toMatchObject({ accountId: null, account: null, ticker: 'PETR4' });
  });

  it("never shows or changes another workspace's purchases", async () => {
    const mine = (await buy({})).body;
    const other = await registerUser(app);
    expect((await other.get('/investments')).body.positions).toEqual([]);
    expect((await other.put(`/investments/purchases/${mine.id}`, {
      assetType: 'stock', ticker: 'PETR4', date: '2026-11-26', quantity: 1, unitPrice: 1,
    })).status).toBe(404);
    expect((await other.del(`/investments/purchases/${mine.id}`)).status).toBe(404);
    // Another workspace's account cannot be used as broker either.
    expect((await other.post('/investments/purchases', {
      assetType: 'stock', ticker: 'VALE3', date: '2026-11-26', quantity: 1, unitPrice: 1, accountId: broker,
    })).status).toBe(404);
    expect((await c.get('/investments')).body.positions[0].quantity).toBe(100);
  });

  it('uses the default "Carteira" broker when none is chosen (created once)', async () => {
    const a = (await buy({})).body;
    const b = (await buy({ ticker: 'VALE3' })).body;
    expect(a.account).toMatchObject({ name: 'Carteira' });
    expect(b.accountId).toBe(a.accountId);
    const r = (await c.get('/investments')).body;
    expect(r.brokers.map((x: any) => [x.name, x.invested, x.assets])).toEqual([
      ['Carteira', 300000, 2],
      ['XP Investimentos', 0, 0],
    ]);
  });

  it('"Pago com" books an Aplicação (transfer) to the broker, outside expenses', async () => {
    const checking = await createAccount(c, { name: 'Nubank', initialBalance: 1000000 });
    const p = (await buy({ accountId: broker, paidFromAccountId: checking, fees: 490, date: '2026-10-15' })).body;
    expect(p.paidFrom).toMatchObject({ id: checking, name: 'Nubank' });
    expect(p.transferId).toBeTruthy();
    const transfers = (await c.get('/transfers?kind=investment')).body.items;
    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toMatchObject({ amount: 150490, transferKind: 'investment', accountId: checking, toAccountId: broker, paid: true });
    expect(transfers[0].description).toContain('Compra PETR4');
    expect((await c.get(`/accounts/${checking}`)).body.balance).toBe(1000000 - 150490);
    expect((await c.get(`/accounts/${broker}`)).body.balance).toBe(150490);
    // Not an expense: the month's expense total stays at zero.
    expect((await c.get('/dashboard?month=2026-10')).body.summary.expense).toBe(0);

    // Editing rebooks the Aplicação with the new total; deleting removes it.
    const edited = (await c.put(`/investments/purchases/${p.id}`, {
      assetType: 'stock', ticker: 'PETR4', date: '2026-10-15', quantity: 200, unitPrice: 1500, fees: 0, accountId: broker, paidFromAccountId: checking,
    })).body;
    const after = (await c.get('/transfers?kind=investment')).body.items;
    expect(after).toHaveLength(1);
    expect(after[0].amount).toBe(300000);
    expect(after[0].id).toBe(edited.transferId);
    await c.del(`/investments/purchases/${p.id}`);
    expect((await c.get('/transfers?kind=investment')).body.items).toHaveLength(0);
    expect((await c.get(`/accounts/${checking}`)).body.balance).toBe(1000000);
  });

  it('without "Pago com" no transfer is booked; invalid paying accounts are refused', async () => {
    const p = (await buy({ accountId: broker })).body;
    expect(p).toMatchObject({ transferId: null, paidFrom: null });
    expect((await c.get('/transfers?kind=investment')).body.items).toHaveLength(0);
    expect((await buy({ accountId: broker, paidFromAccountId: broker })).status).toBe(422);
    const other = await createAccount(c, { name: 'Rico', type: 'investment' });
    expect((await buy({ accountId: broker, paidFromAccountId: other })).status).toBe(422);
  });

  it('deleting the Aplicação in the statement keeps the purchase, just unlinked', async () => {
    const checking = await createAccount(c, { name: 'Nubank', initialBalance: 1000000 });
    const p = (await buy({ accountId: broker, paidFromAccountId: checking })).body;
    expect((await c.del(`/transfers/${p.transferId}`)).status).toBe(204);
    const r = (await c.get('/investments')).body;
    expect(r.purchases[0]).toMatchObject({ id: p.id, transferId: null, paidFrom: null });
    // The link itself is cleared by the database (FK ON DELETE SET NULL, migration 0009).
    const [row] = await executeRows<{ transfer_id: string | null }>(admin(), sql`select transfer_id from investment_purchases where id = ${p.id}`);
    expect(row!.transfer_id).toBeNull();
  });

  it('refuses a purchase whose total exceeds the money cap of the contract (no oversized Aplicação)', async () => {
    // Audit 2026-11 (DB-02): quantity × unit price was unbounded, so "Pago com" booked transfers far
    // beyond the R$ 1 bilhão cap of /transfers — or beyond bigint, failing with a 500.
    const checking = await createAccount(c, { name: 'Nubank', initialBalance: 1000000 });
    for (const quantity of [1_000_000, 1_000_000_000_000]) {
      const res = await buy({ accountId: broker, paidFromAccountId: checking, quantity, unitPrice: 100_000_000_000 });
      expect(res.status, String(quantity)).toBe(400);
    }
    expect((await buy({ accountId: broker, quantity: 1, unitPrice: 100_000_000_000 })).status).toBe(201);
    expect((await buy({ accountId: broker, quantity: 1, unitPrice: 100_000_000_000, fees: 1 })).status).toBe(400);
    expect((await c.get('/transfers?kind=investment')).body.items).toHaveLength(0);
  });
});
