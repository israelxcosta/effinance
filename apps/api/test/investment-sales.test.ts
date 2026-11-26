import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { App } from '../src/app';
import { createAccount, createTestApp, registerUser, resetDb, type Client } from './helpers';

let app: App;
let c: Client;
let checking: string;
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
  checking = await createAccount(c, { name: 'Itaú', initialBalance: 1000000 });
  broker = await createAccount(c, { name: 'XP Investimentos', type: 'investment', bank: 'xp' });
  // 100 × R$ 15,00 + R$ 4,90 and 50 × R$ 18,00, paid from the checking account: average R$ 16,03.
  await c.post('/investments/purchases', { assetType: 'stock', ticker: 'PETR4', date: '2026-10-01', quantity: 100, unitPrice: 1500, fees: 490, accountId: broker, paidFromAccountId: checking });
  await c.post('/investments/purchases', { assetType: 'stock', ticker: 'PETR4', date: '2026-10-05', quantity: 50, unitPrice: 1800, accountId: broker, paidFromAccountId: checking });
});

const balance = async (id: string) => (await c.get(`/accounts/${id}`)).body.balance as number;
const sell = (body: Record<string, unknown>) => c.post('/investments/sales', { ticker: 'PETR4', date: '2026-10-15', ...body });

describe('investment sales', () => {
  it('a sale below the average price is a loss; the money stays at the broker', async () => {
    const res = await sell({ quantity: 100, unitPrice: 1500 });
    expect(res.status).toBe(201);
    // Cost = 240490 / 150 × 100 = 160327 (average price unchanged for the 50 left).
    expect(res.body).toMatchObject({ quantity: 100, cost: 160327, proceeds: 150000, result: -10327, accountId: broker });

    const p = (await c.get('/investments')).body;
    expect(p.positions[0]).toMatchObject({ ticker: 'PETR4', quantity: 50, totalInvested: 80163, averagePrice: 1603, realizedResult: -10327 });
    expect(p.realizedResult).toBe(-10327);
    // Broker balance = held cost + money available; the loss is not an expense anywhere.
    expect(await balance(broker)).toBe(240490 - 10327);
    expect(p.brokers[0]).toMatchObject({ id: broker, invested: 80163, available: 150000 });
    expect(p.available).toBe(150000);
    expect(await balance(checking)).toBe(1000000 - 240490);
    const expenses = (await c.get('/transactions?type=expense&from=2026-10-01&to=2026-10-31')).body;
    expect(JSON.stringify(expenses)).not.toContain('PETR4');
  });

  it('a sale above the average price is a profit; selling everything takes the whole cost', async () => {
    const res = await sell({ quantity: 150, unitPrice: 2000, fees: 1000 });
    expect(res.body).toMatchObject({ cost: 240490, proceeds: 299000, result: 58510 });
    const p = (await c.get('/investments')).body;
    expect(p.positions).toEqual([]);
    expect(p.brokers[0]).toMatchObject({ invested: 0, available: 299000 });
    // Reapplying the money already at the broker ("Já estava na corretora") uses the available money.
    await c.post('/investments/purchases', { assetType: 'fixed_income', ticker: 'CDB X', date: '2026-10-20', quantity: 1, unitPrice: 100000, accountId: broker });
    expect((await c.get('/investments')).body.brokers[0]).toMatchObject({ invested: 100000, available: 199000 });
  });

  it('refuses selling more than the position or an asset not held', async () => {
    expect((await sell({ quantity: 151, unitPrice: 1500 })).status).toBe(422);
    expect((await sell({ ticker: 'VALE3', quantity: 1, unitPrice: 1500 })).status).toBe(422);
    expect((await sell({ quantity: 0, unitPrice: 1500 })).status).toBe(400);
  });

  it('the broker statement shows the result as a read-only line with the right running balance', async () => {
    const sale = (await sell({ quantity: 100, unitPrice: 1500 })).body;
    const st = (await c.get(`/statement?accountId=${broker}&from=2026-10-01&to=2026-10-31`)).body;
    const line = st.entries.find((e: { transaction: { investmentSaleId?: string } }) => e.transaction.investmentSaleId === sale.id);
    expect(line).toMatchObject({ amount: -10327, transaction: { type: 'expense', description: expect.stringContaining('prejuízo') } });
    expect(st.closingBalance).toBe(240490 - 10327);
    // Deleting the sale gives the units and the balance back.
    expect((await c.del(`/investments/sales/${sale.id}`)).status).toBe(204);
    expect(await balance(broker)).toBe(240490);
    expect((await c.get('/investments')).body.positions[0]).toMatchObject({ quantity: 150 });
  });

  it("never sells or deletes another workspace's sales", async () => {
    const sale = (await sell({ quantity: 10, unitPrice: 1500 })).body;
    const other = await registerUser(app);
    expect((await other.del(`/investments/sales/${sale.id}`)).status).toBe(404);
    expect((await other.post('/investments/sales', { ticker: 'PETR4', date: '2026-10-15', quantity: 1, unitPrice: 1500 })).status).toBe(422);
    expect((await other.post('/investments/sales', { ticker: 'PETR4', date: '2026-10-15', quantity: 1, unitPrice: 1500, accountId: broker })).status).toBe(422);
  });
});

describe('investment income (proventos)', () => {
  it('books income in Rendimentos at the broker; deleting either side removes both', async () => {
    const res = await c.post('/investments/incomes', { kind: 'dividend', ticker: 'PETR4', date: '2026-10-14', amount: 11000 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ kind: 'dividend', ticker: 'PETR4', accountId: broker, amount: 11000 });
    const tx = (await c.get(`/transactions/${res.body.transactionId}`)).body;
    expect(tx).toMatchObject({ type: 'income', amount: 11000, paid: true, accountId: broker, category: { name: 'Rendimentos' }, subcategory: { name: 'Dividendos' } });
    expect(await balance(broker)).toBe(240490 + 11000);

    const p = (await c.get('/investments')).body;
    expect(p.incomesYear).toBe(11000);
    expect(p.positions[0]).toMatchObject({ incomes: 11000 });
    expect(p.brokers[0]).toMatchObject({ available: 11000 });

    // JCP creates its subcategory on first use.
    const jcp = (await c.post('/investments/incomes', { kind: 'jcp', ticker: 'PETR4', date: '2026-10-16', amount: 5000 })).body;
    expect((await c.get(`/transactions/${jcp.transactionId}`)).body.subcategory).toMatchObject({ name: 'JCP' });

    expect((await c.del(`/investments/incomes/${res.body.id}`)).status).toBe(204);
    expect((await c.get(`/transactions/${res.body.transactionId}`)).status).toBe(404);
    expect((await c.del(`/transactions/${jcp.transactionId}`)).status).toBeLessThan(300);
    expect((await c.get('/investments')).body.incomes).toEqual([]);
  });

  it('validates the kind, the amount and the broker', async () => {
    expect((await c.post('/investments/incomes', { kind: 'bonus', date: '2026-10-14', amount: 100 })).status).toBe(400);
    expect((await c.post('/investments/incomes', { kind: 'interest', date: '2026-10-14', amount: 0 })).status).toBe(400);
    expect((await c.post('/investments/incomes', { kind: 'interest', date: '2026-10-14', amount: 100, accountId: checking })).status).toBe(422);
  });
});

describe('goal withdrawal from a title', () => {
  it('sells that amount of the title and books the Resgate to the chosen account', async () => {
    const reserve = await createAccount(c, { name: 'Tesouro', type: 'investment' });
    const goal = (await c.post('/goals', { name: 'Reserva', targetAmount: 1000000, accountId: reserve, assetName: 'Tesouro Selic 2029' })).body.id;
    await c.post(`/goals/${goal}/contributions`, { amount: 300000, date: '2026-10-10', accountId: checking });
    const out = await c.post(`/goals/${goal}/contributions`, { amount: -100000, date: '2026-10-12', accountId: checking });
    expect(out.status).toBe(201);
    expect(out.body.saleId).toBeTruthy();
    const pos = (await c.get('/investments')).body.positions.find((x: { ticker: string }) => x.ticker === 'TESOURO SELIC 2029');
    expect(pos.totalInvested).toBe(200000);
    expect(await balance(reserve)).toBe(200000);
    expect((await c.post(`/goals/${goal}/contributions`, { amount: -500000, date: '2026-10-12', accountId: checking })).status).toBe(422);
    // Deleting the withdrawal undoes the sale and the Resgate.
    expect((await c.del(`/goals/${goal}/contributions/${out.body.id}`)).status).toBe(204);
    expect(await balance(reserve)).toBe(300000);
  });
});
