import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { App } from '../src/app';
import { createAccount, createTestApp, firstCategory, registerUser, resetDb, type Client } from './helpers';

let app: App;
let c: Client;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await resetDb(app);
  c = await registerUser(app);
});

describe('categories', () => {
  it('builds a tree and subcategories inherit the parent type', async () => {
    const parent = await c.post('/categories', { name: 'Viagem', type: 'expense', icon: 'plane', color: '#3F64BE' });
    expect(parent.status).toBe(201);
    const sub = await c.post('/categories', {
      name: 'Hospedagem',
      type: 'income', // ignored: follows the parent
      icon: 'house',
      color: '#3F64BE',
      parentId: parent.body.id,
    });
    expect(sub.status).toBe(201);
    expect(sub.body).toMatchObject({ type: 'expense', parentId: parent.body.id });

    const nested = await c.post('/categories', { name: 'x', type: 'expense', parentId: sub.body.id });
    expect(nested.status).toBe(422);

    const tree = await c.get('/categories?type=expense');
    const viagem = tree.body.find((x: any) => x.id === parent.body.id);
    expect(viagem.subcategories.map((s: any) => s.name)).toEqual(['Hospedagem']);
    expect(tree.body.every((x: any) => x.type === 'expense' && x.parentId === null)).toBe(true);
  });

  it('blocks deleting categories in use and supports archiving', async () => {
    const cat = await firstCategory(c, 'expense', 'Moradia');
    const sub = cat.subcategories[0]!;
    const tx = await c.post('/transactions', {
      type: 'expense',
      description: 'Aluguel',
      amount: 150000,
      date: '2026-10-05',
      categoryId: cat.id,
      subcategoryId: sub.id,
    });
    expect(tx.status).toBe(201);
    expect((await c.del(`/categories/${cat.id}`)).status).toBe(409);
    expect((await c.del(`/categories/${sub.id}`)).status).toBe(409);

    const archived = await c.put(`/categories/${cat.id}`, { name: 'Moradia', archived: true });
    expect(archived.body.archived).toBe(true);
    const visible = await c.get('/categories?type=expense');
    expect(visible.body.find((x: any) => x.id === cat.id)).toBeUndefined();
    const all = await c.get('/categories?type=expense&includeArchived=true');
    expect(all.body.find((x: any) => x.id === cat.id)).toBeDefined();

    const free = await c.post('/categories', { name: 'Temporária', type: 'income' });
    expect((await c.del(`/categories/${free.body.id}`)).status).toBe(204);
  });

  it('rejects a category of the wrong type or a foreign subcategory', async () => {
    const income = await firstCategory(c, 'income');
    const expense = await firstCategory(c, 'expense', 'Moradia');
    const other = await firstCategory(c, 'expense', 'Alimentação');
    const wrongType = await c.post('/transactions', {
      type: 'expense',
      description: 'x',
      amount: 100,
      date: '2026-10-01',
      categoryId: income.id,
    });
    expect(wrongType.status).toBe(422);
    const wrongSub = await c.post('/transactions', {
      type: 'expense',
      description: 'x',
      amount: 100,
      date: '2026-10-01',
      categoryId: expense.id,
      subcategoryId: other.subcategories[0]!.id,
    });
    expect(wrongSub.status).toBe(422);
  });
});

describe('accounts', () => {
  it('creates, updates, archives and refuses to delete accounts in use', async () => {
    const id = await createAccount(c, { name: 'Nubank', bank: 'nubank', initialBalance: 123456 });
    const list = await c.get('/accounts');
    expect(list.body.find((a: any) => a.id === id)).toMatchObject({ balance: 123456, bank: 'nubank' });

    const upd = await c.put(`/accounts/${id}`, { name: 'Nubank PF', type: 'checking', bank: 'nubank', initialBalance: 1000 });
    expect(upd.body).toMatchObject({ name: 'Nubank PF', balance: 1000 });

    await c.post('/transactions', { type: 'income', description: 'Pix', amount: 500, date: '2026-10-01', paid: true, accountId: id });
    expect((await c.del(`/accounts/${id}`)).status).toBe(409);

    const empty = await createAccount(c, { name: 'Vazia' });
    expect((await c.del(`/accounts/${empty}`)).status).toBe(204);
  });
});

describe('contacts', () => {
  it('validates and normalizes CPF, phone and CEP', async () => {
    const bad = await c.post('/contacts', { name: 'João', document: '123.456.789-00' });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toBe('CPF/CNPJ inválido');

    const ok = await c.post('/contacts', {
      name: 'João Silva',
      document: '529.982.247-25',
      email: 'JOAO@exemplo.com',
      phone: '(11) 98765-4321',
      zipCode: '01310-100',
      street: 'Av. Paulista',
      number: '1000',
      city: 'São Paulo',
      state: 'sp',
    });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({
      document: '52998224725',
      email: 'joao@exemplo.com',
      phone: '11987654321',
      zipCode: '01310100',
      state: 'SP',
    });

    // CPF/CNPJ is encrypted: search is exact (blind index), partial digits do not match.
    expect((await c.get('/contacts?search=529.982.247-25')).body.total).toBe(1);
    expect((await c.get('/contacts?search=529982')).body.total).toBe(0);
    expect((await c.get(`/contacts/${ok.body.id}`)).body.email).toBe('joao@exemplo.com');
    const byName = await c.get('/contacts?search=silva');
    expect(byName.body.items[0].id).toBe(ok.body.id);

    expect((await c.del(`/contacts/${ok.body.id}`)).status).toBe(204);
    expect((await c.get(`/contacts/${ok.body.id}`)).status).toBe(404);
  });
});

describe('goals', () => {
  it('tracks contributions, progress and the monthly amount needed', async () => {
    const goal = await c.post('/goals', { name: 'Reserva', targetAmount: 1200000, deadline: '2027-09-30' });
    expect(goal.status).toBe(201);
    const id = goal.body.id;
    await c.post(`/goals/${id}/contributions`, { amount: 300000, date: '2026-09-01' });
    const w = await c.post(`/goals/${id}/contributions`, { amount: -50000, date: '2026-10-01', note: 'Saque' });
    expect(w.status).toBe(201);

    const list = await c.get('/goals');
    const g = list.body[0];
    expect(g.currentAmount).toBe(250000);
    expect(g.progress).toBeCloseTo(250000 / 1200000);
    // Oct/2026 → Sep/2027 = 12 months; (1.200.000 − 250.000) / 12 = 79.166,67 → ceil
    expect(g.monthlyNeeded).toBe(79167);
    expect(g.completed).toBe(false);

    const contributions = await c.get(`/goals/${id}/contributions`);
    expect(contributions.body).toHaveLength(2);
    expect((await c.del(`/goals/${id}/contributions/${w.body.id}`)).status).toBe(204);
    expect((await c.get('/goals')).body[0].currentAmount).toBe(300000);
  });
});
