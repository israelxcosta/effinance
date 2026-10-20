import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { App } from '../src/app';
import { createAccount, createTestApp, firstCategory, registerUser, resetDb, type Client } from './helpers';

let app: App;
let c: Client;
let account: string;
let food: Awaited<ReturnType<typeof firstCategory>>;
let home: Awaited<ReturnType<typeof firstCategory>>;
let salary: Awaited<ReturnType<typeof firstCategory>>;
let landlord: string;

beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await resetDb(app);
  c = await registerUser(app);
  account = await createAccount(c, { name: 'Conta', initialBalance: 100000 });
  food = await firstCategory(c, 'expense', 'Alimentação');
  home = await firstCategory(c, 'expense', 'Moradia');
  salary = await firstCategory(c, 'income', 'Salário');
  landlord = (await c.post('/contacts', { name: 'Imobiliária Lar' })).body.id;

  const tx = (body: Record<string, unknown>) => c.post('/transactions', { accountId: account, paid: true, ...body });
  await tx({ type: 'income', description: 'Salário', amount: 500000, date: '2026-09-05', categoryId: salary.id, recurrenceKind: 'fixed' });
  await tx({ type: 'expense', description: 'Aluguel', amount: 150000, date: '2026-09-10', categoryId: home.id, contactId: landlord, recurrenceKind: 'fixed', paymentMethod: 'bank_slip' });
  await tx({ type: 'expense', description: 'Mercado', amount: 50000, date: '2026-09-12', categoryId: food.id, subcategoryId: food.subcategories[0]!.id, paymentMethod: 'pix' });
  await tx({ type: 'expense', description: 'Mercado', amount: 60000, date: '2026-10-12', categoryId: food.id, subcategoryId: food.subcategories[0]!.id, paymentMethod: 'pix' });
  await tx({ type: 'expense', description: 'Restaurante', amount: 20000, date: '2026-10-14', categoryId: food.id, subcategoryId: food.subcategories[1]!.id, paymentMethod: 'debit_card' });
  // October salary & rent come from the fixed series (pending).
});

describe('reports', () => {
  it('evolution by category with projection flags', async () => {
    const res = await c.get('/reports/categories?from=2026-09-01&to=2026-12-31&type=expense&granularity=month');
    expect(res.status).toBe(200);
    const r = res.body;
    expect(r.periods.map((p: any) => [p.key, p.projected])).toEqual([
      ['2026-09', false],
      ['2026-10', false],
      ['2026-11', true],
      ['2026-12', true],
    ]);
    const moradia = r.series.find((s: any) => s.categoryId === home.id);
    expect(moradia.values).toEqual([150000, 150000, 150000, 150000]);
    const alim = r.series.find((s: any) => s.categoryId === food.id);
    expect(alim.values).toEqual([50000, 80000, 0, 0]);
    expect(alim.average).toBe(65000);
    expect(r.totals).toEqual([200000, 230000, 150000, 150000]);
    expect(r.total).toBe(730000);
    expect(r.series[0].categoryId).toBe(home.id);

    const paidOnly = (await c.get('/reports/categories?from=2026-09-01&to=2026-12-31&status=paid')).body;
    expect(paidOnly.total).toBe(130000 + 150000);

    const subs = (await c.get(`/reports/categories?from=2026-09-01&to=2026-10-31&categoryId=${food.id}`)).body;
    expect(subs.series.map((s: any) => [s.name, s.total])).toEqual([
      [food.subcategories[0]!.name, 110000],
      [food.subcategories[1]!.name, 20000],
    ]);

    const weekly = (await c.get('/reports/categories?from=2026-10-01&to=2026-10-31&granularity=week')).body;
    expect(weekly.periods[0].start).toBe('2026-09-27');
    expect(weekly.totals.reduce((a: number, b: number) => a + b, 0)).toBe(230000);
  });

  it('totals and evolution by contact', async () => {
    const res = (await c.get('/reports/contacts?from=2026-09-01&to=2026-10-31')).body;
    const lar = res.items.find((i: any) => i.contactId === landlord);
    expect(lar).toMatchObject({ name: 'Imobiliária Lar', expense: 300000, income: 0, net: -300000, count: 2 });
    expect(lar.expenseValues).toEqual([150000, 150000]);
    const none = res.items.find((i: any) => i.contactId === null);
    expect(none).toMatchObject({ name: 'Sem contato', income: 1000000 });
  });

  it('compares two periods by category', async () => {
    const res = (
      await c.get('/reports/comparison?aFrom=2026-09-01&aTo=2026-09-30&bFrom=2026-10-01&bTo=2026-10-31&type=expense')
    ).body;
    expect(res.a).toMatchObject({ income: 500000, expense: 200000, net: 300000 });
    expect(res.b).toMatchObject({ income: 500000, expense: 230000, net: 270000 });
    const alim = res.rows.find((r: any) => r.categoryId === food.id);
    expect(alim).toMatchObject({ a: 50000, b: 80000, diff: 30000 });
    expect(alim.diffPercent).toBeCloseTo(0.6);
    expect(res.rows.find((r: any) => r.categoryId === home.id).diffPercent).toBe(0);
  });

  it('cash flow with realized and pending amounts and running balance', async () => {
    const res = (await c.get('/reports/cashflow?from=2026-09-01&to=2026-11-30&granularity=month')).body;
    expect(res.openingBalance).toBe(100000);
    const [sep, oct, nov] = res.periods;
    expect(sep).toMatchObject({ realizedInflow: 500000, realizedOutflow: 200000, pendingInflow: 0, balance: 400000 });
    expect(oct).toMatchObject({
      realizedInflow: 0,
      realizedOutflow: 80000,
      pendingInflow: 500000,
      pendingOutflow: 150000,
      net: 270000,
      balance: 670000,
    });
    expect(nov).toMatchObject({ projected: true, inflow: 500000, outflow: 150000, balance: 1020000 });
    expect(res.closingBalance).toBe(1020000);
  });

  it('overview with split, payment methods and insights', async () => {
    const res = (await c.get('/reports/overview?from=2026-10-01&to=2026-10-31')).body;
    expect(res).toMatchObject({
      income: 500000,
      expense: 230000,
      net: 270000,
      fixedExpense: 150000,
      variableExpense: 80000,
      installmentExpense: 0,
      averageDailyExpense: Math.round(230000 / 31),
    });
    expect(res.savingsRate).toBeCloseTo(0.54);
    expect(res.byPaymentMethod.map((m: any) => [m.label, m.amount])).toEqual([
      ['Boleto', 150000],
      ['Pix', 60000],
      ['Cartão de débito', 20000],
    ]);
    expect(res.topExpenses[0]).toMatchObject({ description: 'Aluguel', amount: 150000 });
    expect(res.insights.map((i: any) => i.title)).toContain('Gastos com Alimentação subiram 60%');
  });

  it('dashboard summary, health score and insights', async () => {
    const res = await c.get('/dashboard?month=2026-10');
    expect(res.status).toBe(200);
    const d = res.body;
    expect(d.summary).toMatchObject({ month: '2026-10', income: 500000, expense: 230000, paidExpense: 80000, pendingIncome: 500000 });
    expect(d.previous).toMatchObject({ month: '2026-09', income: 500000, expense: 200000 });
    expect(d.monthly.map((m: any) => m.month)).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
    expect(d.expensesByCategory[0]).toMatchObject({ categoryId: home.id, amount: 150000 });
    expect(d.expensesByCategory.reduce((a: number, x: any) => a + x.share, 0)).toBeCloseTo(1);
    expect(d.fixedExpenses.map((t: any) => t.description)).toEqual(['Aluguel']);
    expect(d.fixedIncome.map((t: any) => t.description)).toEqual(['Salário']);
    // Oct salary (05) and rent (10) are pending and overdue.
    expect(d.overdue).toMatchObject({ count: 1, amount: 150000 });
    expect(d.upcoming.map((t: any) => t.description)).toEqual(['Salário', 'Aluguel']);
    expect(d.health.score).toBeGreaterThan(0);
    expect(d.health.score).toBeLessThanOrEqual(1000);
    expect(d.health.factors).toHaveLength(5);
    expect(d.insights.length).toBeGreaterThan(0);
    expect(d.insights[0]).toMatchObject({ kind: 'warning', title: '1 conta vencida' });
  });

  it('search finds transactions, categories and contacts', async () => {
    const res = (await c.get('/search?q=lar')).body;
    expect(res.contacts.map((x: any) => x.name)).toEqual(['Imobiliária Lar']);
    const tx = (await c.get('/search?q=mercado')).body;
    expect(tx.transactions).toHaveLength(2);
    const cat = (await c.get('/search?q=aliment')).body;
    expect(cat.categories.map((x: any) => x.name)).toContain('Alimentação');
  });
});
