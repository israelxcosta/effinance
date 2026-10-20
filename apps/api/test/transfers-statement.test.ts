import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { App } from '../src/app';
import { createAccount, createTestApp, registerUser, resetDb, type Client } from './helpers';

let app: App;
let c: Client;
let nubank: string;
let itau: string;
let xp: string;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await resetDb(app);
  c = await registerUser(app);
  nubank = await createAccount(c, { name: 'Nubank', bank: 'nubank', initialBalance: 500000 });
  itau = await createAccount(c, { name: 'Itaú', bank: 'itau', initialBalance: 200000 });
  xp = await createAccount(c, { name: 'XP', type: 'investment', bank: 'xp', initialBalance: 0 });
});

describe('transfers and investments', () => {
  it('derives the transfer kind and keeps investments apart', async () => {
    const t = await c.post('/transfers', { fromAccountId: nubank, toAccountId: itau, amount: 100000, date: '2026-10-02' });
    expect(t.status).toBe(201);
    expect(t.body).toMatchObject({ type: 'transfer', transferKind: 'transfer', paid: true, description: 'Transferência para Itaú' });

    const inv = await c.post('/transfers', { fromAccountId: nubank, toAccountId: xp, amount: 150000, date: '2026-10-03' });
    expect(inv.body).toMatchObject({ transferKind: 'investment', description: 'Aplicação em XP' });

    const red = await c.post('/transfers', { fromAccountId: xp, toAccountId: itau, amount: 50000, date: '2026-10-04' });
    expect(red.body).toMatchObject({ transferKind: 'redemption', description: 'Resgate de XP' });

    const same = await c.post('/transfers', { fromAccountId: xp, toAccountId: xp, amount: 1, date: '2026-10-04' });
    expect(same.status).toBe(400);

    const accounts = Object.fromEntries((await c.get('/accounts')).body.map((a: any) => [a.name, a.balance]));
    expect(accounts).toMatchObject({ Nubank: 250000, Itaú: 350000, XP: 100000 });

    const dash = await c.get('/dashboard?month=2026-10');
    expect(dash.body.balances).toMatchObject({ accounts: 600000, investments: 100000, netWorth: 700000 });

    const onlyInvestments = await c.get('/transfers?kind=investment');
    expect(onlyInvestments.body.total).toBe(1);
    const xpTransfers = await c.get(`/transfers?accountId=${xp}`);
    expect(xpTransfers.body.total).toBe(2);

    // A transfer edited into a non-investment destination becomes a plain transfer.
    const upd = await c.put(`/transfers/${inv.body.id}`, { fromAccountId: nubank, toAccountId: itau, amount: 1000, date: '2026-10-03' });
    expect(upd.body.transferKind).toBe('transfer');
    expect((await c.put(`/transactions/${upd.body.id}`, { amount: 5 })).status).toBe(422);
    expect((await c.del(`/transfers/${upd.body.id}`)).status).toBe(204);
  });
});

describe('statement', () => {
  beforeEach(async () => {
    await c.post('/transactions', { type: 'income', description: 'Salário set', amount: 300000, date: '2026-09-05', paid: true, accountId: nubank });
    await c.post('/transactions', { type: 'income', description: 'Salário', amount: 300000, date: '2026-10-05', paid: true, accountId: nubank });
    await c.post('/transactions', { type: 'expense', description: 'Mercado', amount: 40000, date: '2026-10-08', paid: true, accountId: nubank });
    await c.post('/transactions', { type: 'expense', description: 'Aluguel', amount: 150000, date: '2026-10-25', accountId: nubank });
    await c.post('/transfers', { fromAccountId: nubank, toAccountId: itau, amount: 20000, date: '2026-10-10' });
    await c.post('/transfers', { fromAccountId: nubank, toAccountId: xp, amount: 30000, date: '2026-10-12' });
  });

  it('computes opening, running, closing and projected balances for one account', async () => {
    const res = await c.get(`/statement?accountId=${nubank}&from=2026-10-01&to=2026-10-31`);
    expect(res.status).toBe(200);
    const s = res.body;
    expect(s.account).toMatchObject({ name: 'Nubank' });
    expect(s.openingBalance).toBe(800000);
    expect(s.entries.map((e: any) => [e.transaction.description, e.amount, e.balanceAfter, e.pending])).toEqual([
      ['Salário', 300000, 1100000, false],
      ['Mercado', -40000, 1060000, false],
      ['Transferência para Itaú', -20000, 1040000, false],
      ['Aplicação em XP', -30000, 1010000, false],
      ['Aluguel', -150000, 860000, true],
    ]);
    expect(s).toMatchObject({
      closingBalance: 1010000,
      projectedClosingBalance: 860000,
      totalIn: 300000,
      totalOut: 90000,
      pendingIn: 0,
      pendingOut: 150000,
    });

    const realizedOnly = await c.get(`/statement?accountId=${nubank}&from=2026-10-01&to=2026-10-31&includePending=false`);
    expect(realizedOnly.body.entries).toHaveLength(4);
  });

  it('uses the payment date as the effective date', async () => {
    const tx = await c.post('/transactions', { type: 'expense', description: 'Boleto', amount: 1000, date: '2026-09-28', accountId: itau });
    await c.patch(`/transactions/${tx.body[0].id}/paid`, { paid: true, paidAt: '2026-10-02' });
    const sep = await c.get(`/statement?accountId=${itau}&from=2026-09-01&to=2026-09-30`);
    expect(sep.body.entries).toHaveLength(0);
    const oct = await c.get(`/statement?accountId=${itau}&from=2026-10-01&to=2026-10-31`);
    expect(oct.body.entries.map((e: any) => [e.transaction.description, e.transaction.effectiveDate])).toEqual([
      ['Boleto', '2026-10-02'],
      ['Transferência para Itaú', '2026-10-10'],
    ]);
  });

  it('nets internal transfers in "all accounts" mode and excludes investments', async () => {
    const res = await c.get('/statement?from=2026-10-01&to=2026-10-31');
    const s = res.body;
    expect(s.account).toBeNull();
    expect(s.openingBalance).toBe(500000 + 200000 + 300000);
    const internal = s.entries.find((e: any) => e.transaction.transferKind === 'transfer');
    expect(internal.amount).toBe(0);
    const investment = s.entries.find((e: any) => e.transaction.transferKind === 'investment');
    expect(investment.amount).toBe(-30000);
    expect(s.closingBalance).toBe(1000000 + 300000 - 40000 - 30000);
    expect(s.projectedClosingBalance).toBe(s.closingBalance - 150000);
  });
});
