import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { App } from '../src/app';
import { createAccount, createTestApp, registerUser, resetDb, type Client } from './helpers';

let app: App;
let c: Client;
let checking: string;
let reserve: string;

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
  reserve = await createAccount(c, { name: 'Tesouro Selic', type: 'investment' });
});

const balance = async (id: string) => (await c.get(`/accounts/${id}`)).body.balance as number;
const newGoal = async (body: Record<string, unknown> = {}) => {
  const res = await c.post('/goals', { name: 'Reserva de emergência', targetAmount: 2400000, accountId: reserve, ...body });
  expect(res.status).toBe(201);
  return res.body.id as string;
};
const contribute = (goalId: string, body: Record<string, unknown>) =>
  c.post(`/goals/${goalId}/contributions`, { date: '2026-10-15', ...body });

describe('goals kept in an Aplicação', () => {
  it('saving moves money from the current account by transfer (Aplicação), outside expenses', async () => {
    const goal = await newGoal();
    const res = await contribute(goal, { amount: 300000, accountId: checking });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ amount: 300000, account: { id: checking, name: 'Itaú' } });
    expect(res.body.transferId).toBeTruthy();

    expect(await balance(checking)).toBe(700000);
    expect(await balance(reserve)).toBe(300000);
    const transfer = (await c.get(`/transactions/${res.body.transferId}`)).body;
    expect(transfer).toMatchObject({ type: 'transfer', amount: 300000, transferKind: 'investment', paid: true });
    expect((await c.get('/goals')).body[0]).toMatchObject({ currentAmount: 300000 });
  });

  it('withdrawing books the Resgate back to the chosen account', async () => {
    const goal = await newGoal();
    await contribute(goal, { amount: 300000, accountId: checking });
    const out = await contribute(goal, { amount: -100000, accountId: checking });
    expect(out.status).toBe(201);
    expect(out.body.account).toMatchObject({ id: checking });
    expect((await c.get(`/transactions/${out.body.transferId}`)).body).toMatchObject({ transferKind: 'redemption', amount: 100000 });
    expect(await balance(checking)).toBe(800000);
    expect(await balance(reserve)).toBe(200000);
  });

  it('deleting a contribution removes its transfer; deleting the transfer only unlinks it', async () => {
    const goal = await newGoal();
    const a = (await contribute(goal, { amount: 300000, accountId: checking })).body;
    const b = (await contribute(goal, { amount: 50000, accountId: checking })).body;
    expect((await c.del(`/goals/${goal}/contributions/${a.id}`)).status).toBe(204);
    expect((await c.get(`/transactions/${a.transferId}`)).status).toBe(404);
    expect(await balance(checking)).toBe(950000);

    expect((await c.del(`/transactions/${b.transferId}`)).status).toBeLessThan(300);
    const list = (await c.get(`/goals/${goal}/contributions`)).body;
    expect(list).toMatchObject([{ id: b.id, transferId: null, account: null }]);
  });

  it('"Já estava na aplicação": no account, no transfer', async () => {
    const goal = await newGoal();
    const res = await contribute(goal, { amount: 500000 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ transferId: null, account: null });
    expect(await balance(checking)).toBe(1000000);
  });

  it('validates the goal account and the current account', async () => {
    // The goal lives in an Aplicação or savings account, never a current account.
    expect((await c.post('/goals', { name: 'X', targetAmount: 1000, accountId: checking })).status).toBe(422);
    const savings = await createAccount(c, { name: 'Poupança', type: 'savings' });
    await newGoal({ accountId: savings });

    const goal = await newGoal();
    expect((await contribute(goal, { amount: 1000, accountId: reserve })).status).toBe(422);
    const otherBroker = await createAccount(c, { name: 'XP', type: 'investment' });
    expect((await contribute(goal, { amount: 1000, accountId: otherBroker })).status).toBe(422);

    const loose = await newGoal({ accountId: null });
    expect((await contribute(loose, { amount: 1000, accountId: checking })).status).toBe(422);
  });

  it("never moves money through another workspace's accounts", async () => {
    const goal = await newGoal();
    const other = await registerUser(app);
    const foreign = await createAccount(other, { name: 'Alheia', initialBalance: 100000 });
    expect((await contribute(goal, { amount: 1000, accountId: foreign })).status).toBe(404);
    expect((await other.post(`/goals/${goal}/contributions`, { amount: 1000, date: '2026-10-15' })).status).toBe(404);
    expect(await balance(checking)).toBe(1000000);
  });
});
