import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { App } from '../src/app';
import { createAccount, createTestApp, registerUser, resetDb, type Client } from './helpers';

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
});
