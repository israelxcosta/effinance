import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { App } from '../src/app';
import { createAccount, createTestApp, registerUser, resetDb, type Client } from './helpers';

let app: App;
let c: Client;
let account: string;
let nubankCard: string;
let itauCard: string;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await resetDb(app);
  c = await registerUser(app);
  account = await createAccount(c, { name: 'Nubank', bank: 'nubank', initialBalance: 1000000 });
  const nu = await c.post('/credit-cards', {
    name: 'Nubank Ultravioleta',
    bank: 'nubank',
    brand: 'mastercard',
    limit: 500000,
    closingDay: 3,
    dueDay: 10,
    defaultAccountId: account,
  });
  expect(nu.status).toBe(201);
  nubankCard = nu.body.id;
  const it = await c.post('/credit-cards', {
    name: 'Itaú Click',
    bank: 'itau',
    brand: 'visa',
    limit: 300000,
    closingDay: 25,
    dueDay: 5,
  });
  itauCard = it.body.id;
});

const buy = (card: string, date: string, amount: number, extra: Record<string, unknown> = {}) =>
  c.post('/transactions', { type: 'expense', description: `Compra ${date}`, amount, date, creditCardId: card, ...extra });

describe('credit cards', () => {
  it('validates card usage on transactions', async () => {
    const income = await c.post('/transactions', { type: 'income', description: 'x', amount: 1, date: '2026-10-01', creditCardId: nubankCard });
    expect(income.status).toBe(400);
    const both = await buy(nubankCard, '2026-10-01', 1, { accountId: account });
    expect(both.status).toBe(400);
  });

  it('judges card purchases overdue by the invoice due date', async () => {
    // today = 2026-10-20; Nubank closes on 3 and is due on 10.
    await buy(nubankCard, '2026-10-02', 10000); // invoice 2026-10, due 10/10 → overdue
    await buy(nubankCard, '2026-10-15', 20000); // invoice 2026-11, due 10/11 → not overdue yet
    const list = await c.get('/transactions?type=expense&from=2026-10-01&to=2026-10-31');
    expect(list.body.items.map((t: any) => [t.amount, t.overdue])).toEqual([
      [10000, true],
      [20000, false],
    ]);
    expect(list.body.summary).toMatchObject({ overdue: 10000, overdueCount: 1 });
    const overdue = await c.get('/transactions?status=overdue');
    expect(overdue.body.items.map((t: any) => t.amount)).toEqual([10000]);
  });

  it('assigns purchases to invoices by closing day', async () => {
    const before = await buy(nubankCard, '2026-10-02', 10000);
    const onClosing = await buy(nubankCard, '2026-10-03', 20000);
    expect(before.body[0]).toMatchObject({ invoiceMonth: '2026-10', paymentMethod: 'credit_card', accountId: null });
    expect(onClosing.body[0].invoiceMonth).toBe('2026-11');

    const installments = await buy(nubankCard, '2026-10-15', 90000, { recurrenceKind: 'installment', installments: 3 });
    expect(installments.body.map((t: any) => t.invoiceMonth)).toEqual(['2026-11', '2026-12', '2027-01']);

    // Due day before closing day: Itaú closes on 25, due on 5 of the next month.
    expect((await buy(itauCard, '2026-10-24', 1000)).body[0].invoiceMonth).toBe('2026-11');
    expect((await buy(itauCard, '2026-10-25', 1000)).body[0].invoiceMonth).toBe('2026-12');

    const cards = (await c.get('/credit-cards')).body;
    const nu = cards.find((x: any) => x.id === nubankCard);
    expect(nu.usedLimit).toBe(120000);
    expect(nu.availableLimit).toBe(380000);
    // Today (2026-10-20) purchases go to the November invoice.
    expect(nu.currentInvoice).toMatchObject({
      month: '2026-11',
      closingDate: '2026-11-03',
      dueDate: '2026-11-10',
      total: 50000,
      unpaidTotal: 50000,
      status: 'open',
    });

    const invoices = (await c.get(`/credit-cards/${nubankCard}/invoices?from=2026-10&to=2027-01`)).body;
    expect(invoices.map((i: any) => [i.month, i.total, i.status])).toEqual([
      ['2026-10', 10000, 'overdue'],
      ['2026-11', 50000, 'open'],
      ['2026-12', 30000, 'open'],
      ['2027-01', 30000, 'open'],
    ]);

    // Card purchases never touch account balances.
    const acc = (await c.get(`/accounts/${account}`)).body;
    expect(acc.balance).toBe(1000000);

    // The dashboard counts the card debt.
    const dash = (await c.get('/dashboard?month=2026-10')).body;
    expect(dash.balances.cardDebt).toBe(122000);
  });

  it('counts installments but not future subscription charges in the used limit', async () => {
    await buy(nubankCard, '2026-09-18', 5590, { description: 'Netflix', recurrenceKind: 'fixed' });
    await buy(nubankCard, '2026-10-01', 60000, { recurrenceKind: 'installment', installments: 6 });
    const nu = (await c.get('/credit-cards')).body.find((x: any) => x.id === nubankCard);
    // Netflix Sep + Oct (already charged) + the whole installment purchase.
    expect(nu.usedLimit).toBe(5590 * 2 + 60000);
    expect((await c.get('/dashboard?month=2026-10')).body.balances.cardDebt).toBe(5590 * 2 + 60000);
  });

  it('pays an invoice in full and can revert the payment', async () => {
    await buy(nubankCard, '2026-10-05', 30000);
    await buy(nubankCard, '2026-10-10', 20000);

    expect((await c.post(`/credit-cards/${nubankCard}/invoices/2026-11/pay`, { accountId: account, date: '2026-11-08', amount: 100 })).status).toBe(422);
    expect((await c.post(`/credit-cards/${nubankCard}/invoices/2026-12/pay`, { accountId: account, date: '2026-11-08' })).status).toBe(422);

    const paid = await c.post(`/credit-cards/${nubankCard}/invoices/2026-11/pay`, { accountId: account, date: '2026-10-20' });
    expect(paid.status).toBe(200);
    expect(paid.body).toMatchObject({ total: 50000, unpaidTotal: 0, status: 'paid' });
    expect(paid.body.transactions.every((t: any) => t.paid && t.paidAt === '2026-10-20')).toBe(true);
    expect(paid.body.payments).toHaveLength(1);
    expect(paid.body.payments[0]).toMatchObject({ transferKind: 'card_payment', amount: 50000, accountId: account });

    expect((await c.get(`/accounts/${account}`)).body.balance).toBe(950000);
    const nu = (await c.get('/credit-cards')).body.find((x: any) => x.id === nubankCard);
    expect(nu.usedLimit).toBe(0);

    // The payment shows up in the account statement.
    const st = await c.get(`/statement?accountId=${account}&from=2026-10-01&to=2026-10-31`);
    expect(st.body.entries.map((e: any) => e.amount)).toEqual([-50000]);

    // It cannot be toggled directly…
    expect((await c.patch(`/transactions/${paid.body.payments[0].id}/paid`, { paid: false })).status).toBe(422);
    // …but deleting it reopens the invoice.
    expect((await c.del(`/transfers/${paid.body.payments[0].id}`)).status).toBe(204);
    const reopened = (await c.get(`/credit-cards/${nubankCard}/invoices/2026-11`)).body;
    expect(reopened).toMatchObject({ unpaidTotal: 50000, status: 'open', payments: [] });
    expect((await c.get(`/accounts/${account}`)).body.balance).toBe(1000000);
  });

  it('re-assigns open purchases when the billing cycle changes and blocks deleting used cards', async () => {
    const tx = await buy(itauCard, '2026-10-20', 5000);
    expect(tx.body[0].invoiceMonth).toBe('2026-11');
    const upd = await c.put(`/credit-cards/${itauCard}`, {
      name: 'Itaú Click',
      bank: 'itau',
      brand: 'visa',
      limit: 300000,
      closingDay: 15,
      dueDay: 22,
    });
    expect(upd.status).toBe(200);
    expect((await c.get(`/transactions/${tx.body[0].id}`)).body.invoiceMonth).toBe('2026-11');
    expect((await c.del(`/credit-cards/${itauCard}`)).status).toBe(409);
  });

  it('projects unpaid invoices in the cash flow on their due date', async () => {
    await buy(nubankCard, '2026-10-05', 30000);
    const cf = (await c.get('/reports/cashflow?from=2026-10-01&to=2026-12-31&granularity=month')).body;
    const nov = cf.periods.find((p: any) => p.key === '2026-11');
    expect(nov.pendingOutflow).toBe(30000);
    const byAccount = (await c.get(`/reports/cashflow?from=2026-10-01&to=2026-12-31&accountId=${account}`)).body;
    expect(byAccount.periods.find((p: any) => p.key === '2026-11').pendingOutflow).toBe(30000);
  });
});

describe('anticipate installments', () => {
  it('moves the last unpaid installments into the current invoice', async () => {
    // today = 2026-10-20 → Nubank (closes 3, due 10) receives today's purchases in invoice 2026-11
    const created = await buy(nubankCard, '2026-09-15', 100000, { recurrenceKind: 'installment', installments: 10 });
    expect(created.status).toBe(201);
    const second = created.body.find((t: any) => t.installmentNumber === 2);

    const res = await c.post(`/transactions/${second.id}/anticipate`, { count: 3 });
    expect(res.status).toBe(200);
    expect(res.body.map((t: any) => [t.installmentNumber, t.date, t.invoiceMonth])).toEqual([
      [8, '2026-10-20', '2026-11'],
      [9, '2026-10-20', '2026-11'],
      [10, '2026-10-20', '2026-11'],
    ]);

    const invoice = await c.get(`/credit-cards/${nubankCard}/invoices/2026-11`);
    const numbers = invoice.body.transactions.map((t: any) => t.installmentNumber).sort((a: number, b: number) => a - b);
    expect(numbers).toEqual([2, 8, 9, 10]);
    expect(invoice.body.total).toBe(40000);

    // without count: every remaining future installment after #2 (3..7) is anticipated
    const rest = await c.post(`/transactions/${second.id}/anticipate`, {});
    expect(rest.body.map((t: any) => t.installmentNumber)).toEqual([3, 4, 5, 6, 7]);
    const none = await c.post(`/transactions/${second.id}/anticipate`, {});
    expect(none.status).toBe(422);
  });

  it('only applies to installment purchases', async () => {
    const single = await buy(nubankCard, '2026-10-15', 5000);
    const res = await c.post(`/transactions/${single.body[0].id}/anticipate`, {});
    expect(res.status).toBe(422);
    expect(res.body.message).toBe('Só é possível antecipar parcelas de uma compra parcelada');
  });
});
