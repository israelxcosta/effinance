// File imports (OFX/CSV): preview, commit, idempotency, duplicates, card invoices, undo, permissions
// and tenant isolation, through the HTTP API against the real database.

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MAX_IMPORT_CONTENT_CHARS, type ImportPreview } from '@effinance/shared';
import type { App } from '../src/app';
import { executeRows } from '../src/lib/sql';
import { fixture } from './import-fixtures';
import { admin, createAccount, createTestApp, firstCategory, registerUser, resetDb, type Client } from './helpers';

let app: App;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await resetDb(app);
});

const CARD = { name: 'Roxinho', bank: 'nubank', brand: 'mastercard', limit: 500000, closingDay: 3, dueDay: 10 };

async function preview(c: Client, body: Record<string, unknown>) {
  return c.post<ImportPreview & { message?: string }>('/imports/preview', { fileName: 'extrato.ofx', ...body });
}

/** Commit body with the rows the preview did not flag. */
function commitBody(p: ImportPreview, overrides: Record<string, unknown> = {}) {
  return {
    fileName: p.fileName,
    format: p.format,
    target: p.target,
    rows: p.rows
      .filter((r) => !r.skip)
      .map((r) => ({ date: r.date, description: r.description, amount: r.amount, type: r.type, externalId: r.externalId, categoryId: r.categoryId })),
    ...overrides,
  };
}

async function familyWithViewer(owner: Client): Promise<{ workspaceId: string; viewer: Client }> {
  const ws = await owner.post('/workspaces', { name: 'Casa Importações', kind: 'family' });
  expect((await owner.post('/auth/switch-workspace', { workspaceId: ws.body.id })).status).toBe(200);
  const email = `leitor-${Date.now()}@teste.com`;
  const inv = await owner.post('/workspaces/current/invites', { email, role: 'viewer' });
  const viewer = await registerUser(app, 'Leitor', email);
  expect((await viewer.post(`/invites/${inv.body.inviteUrl.split('/convite/')[1]}/accept`)).status).toBe(200);
  return { workspaceId: ws.body.id, viewer };
}

describe('OFX into an account', () => {
  it('previews with period, hints, duplicates in the file, bill payments and suggested categories', async () => {
    const user = await registerUser(app, 'Importa OFX');
    const accountId = await createAccount(user);
    const groceries = await firstCategory(user, 'expense', 'Alimentação');
    const sub = groceries.subcategories[0]!;
    // History: the same merchant categorized before (description written differently).
    await user.post('/transactions', {
      type: 'expense',
      description: 'compra com cartao   SUPERMERCADO bom preco',
      amount: 1000,
      date: '2026-09-01',
      categoryId: groceries.id,
      subcategoryId: sub.id,
    });

    const res = await preview(user, { content: fixture('bb-extrato-ofx1.ofx'), target: { kind: 'account', accountId } });
    expect(res.status).toBe(200);
    const p = res.body;
    expect(p).toMatchObject({
      format: 'ofx',
      institution: 'Banco do Brasil',
      accountHint: '7654',
      period: { from: '2026-10-01', to: '2026-10-15' },
      csvColumns: null,
      csvMapping: null,
    });
    expect(p.rows.map((r) => [r.type, r.amount, r.skip, r.note])).toEqual([
      ['income', 520000, false, null],
      ['expense', 8990, false, null],
      ['expense', 8990, false, null],
      ['expense', 153427, true, 'Pagamento de fatura de cartão — registre pela fatura do cartão'],
      ['expense', 15000, false, null],
      ['expense', 0, true, 'Valor zerado'],
    ]);
    // Both supermarket rows: distinct ids, same suggested subcategory.
    expect(p.rows[1]!.externalId).not.toBe(p.rows[2]!.externalId);
    expect(p.rows[1]!.categoryId).toBe(sub.id);
    expect(p.totals).toEqual({ count: 6, income: 520000, expense: 8990 * 2 + 153427 + 15000, duplicates: 0 });
  });

  it('commits as paid account movements, is idempotent and flags what was imported', async () => {
    const user = await registerUser(app, 'Commit OFX');
    const accountId = await createAccount(user, { initialBalance: 10000 });
    const salary = await firstCategory(user, 'income');
    const p = (await preview(user, { content: fixture('bb-extrato-ofx1.ofx'), target: { kind: 'account', accountId } })).body;
    const body = commitBody(p);
    body.rows[0]!.categoryId = salary.id;

    const res = await user.post('/imports', body);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      created: 4,
      skipped: 0,
      batch: { origin: 'file', format: 'ofx', fileName: 'extrato.ofx', accountId, creditCardId: null, createdCount: 4, skippedCount: 0, remainingCount: 4, createdByName: 'Commit OFX' },
    });
    const batchId = res.body.batch.id as string;

    const list = await user.get(`/transactions?accountId=${accountId}&from=2026-10-01&to=2026-10-31`);
    expect(list.body.items).toHaveLength(4);
    for (const t of list.body.items) {
      expect(t).toMatchObject({ origin: 'file', importBatchId: batchId, paid: true, paidAt: t.date, accountId });
    }
    const pix = list.body.items.find((t: { description: string }) => t.description.startsWith('Pix enviado'));
    expect(pix.paymentMethod).toBe('pix');
    expect(list.body.items.find((t: { type: string }) => t.type === 'income').categoryId).toBe(salary.id);
    const account = (await user.get(`/accounts/${accountId}`)).body;
    expect(account.balance).toBe(10000 + 520000 - 8990 * 2 - 15000);

    // The same file again: nothing created, everything counted as skipped.
    const again = await user.post('/imports', body);
    expect(again.status).toBe(201);
    expect(again.body).toMatchObject({ created: 0, skipped: 4 });
    expect((await user.get(`/transactions?accountId=${accountId}`)).body.total).toBe(4);
    // …and the preview now says so.
    const p2 = (await preview(user, { content: fixture('bb-extrato-ofx1.ofx'), target: { kind: 'account', accountId } })).body;
    expect(p2.rows.filter((r) => r.duplicate).map((r) => r.note)).toEqual(Array(4).fill('Já importado'));
    expect(p2.totals.duplicates).toBe(4);

    // Repeated externalIds inside one request are created once.
    const dup = commitBody(p, { fileName: 'outro.ofx' });
    const twice = { ...dup, rows: [{ ...dup.rows[1]!, externalId: 'x-1' }, { ...dup.rows[1]!, externalId: 'x-1' }] };
    expect((await user.post('/imports', twice)).body).toMatchObject({ created: 1, skipped: 1 });
  });

  it('detects a likely duplicate typed by hand (same date, amount and description)', async () => {
    const user = await registerUser(app, 'Duplicado Manual');
    const accountId = await createAccount(user);
    const manual = await user.post('/transactions', {
      type: 'expense',
      description: 'Pix enviado - JOÃO Exemplo & Cia',
      amount: 15000,
      date: '2026-10-12',
      accountId,
      paid: true,
    });
    const p = (await preview(user, { content: fixture('bb-extrato-ofx1.ofx'), target: { kind: 'account', accountId } })).body;
    const row = p.rows.find((r) => r.amount === 15000)!;
    expect(row).toMatchObject({ duplicate: true, duplicateTransactionId: manual.body[0].id, skip: true, note: 'Possível duplicado de um lançamento já registrado' });
  });
});

describe('CSV into a credit card', () => {
  it('imports purchases into invoices, leaving payments and refunds out', async () => {
    const user = await registerUser(app, 'Fatura CSV');
    const cardId = (await user.post('/credit-cards', CARD)).body.id as string;
    const res = await preview(user, { fileName: 'nubank.csv', content: fixture('nubank-cartao.csv'), target: { kind: 'credit_card', creditCardId: cardId } });
    expect(res.status).toBe(200);
    const p = res.body;
    expect(p).toMatchObject({ format: 'csv', institution: 'Nubank', csvColumns: ['date', 'title', 'amount'], csvMapping: { invertSign: true } });
    expect(p.rows.map((r) => [r.type, r.amount, r.skip, r.note, r.installment])).toEqual([
      ['expense', 4590, false, null, null],
      ['expense', 25000, false, null, { number: 2, total: 10 }],
      ['income', 153427, true, 'Pagamento de fatura', null],
      ['expense', 8840, false, null, null],
      ['expense', 8840, false, null, null],
    ]);

    const committed = await user.post('/imports', commitBody(p));
    expect(committed.body).toMatchObject({ created: 4, batch: { creditCardId: cardId, accountId: null, invoiceMonth: null } });
    // Closing day 3: purchases from 3 Sep to 2 Oct go to the October invoice (due 10/10).
    const invoice = (await user.get(`/credit-cards/${cardId}/invoices/2026-10`)).body;
    expect(invoice.total).toBe(4590 + 25000 + 8840 * 2);
    expect(invoice.transactions.every((t: { paid: boolean; origin: string; paymentMethod: string }) => !t.paid && t.origin === 'file' && t.paymentMethod === 'credit_card')).toBe(true);

    // A refund cannot be imported into a card (the invoice only sums purchases).
    const refund = commitBody(p);
    refund.rows = [{ ...refund.rows[0]!, type: 'income', externalId: 'estorno-1' }];
    const refused = await user.post('/imports', refund);
    expect(refused.status).toBe(422);
    expect(refused.body.details).toEqual({ rows: [0] });
  });

  it('puts everything in the invoice chosen by the user', async () => {
    const user = await registerUser(app, 'Fatura Escolhida');
    const cardId = (await user.post('/credit-cards', CARD)).body.id as string;
    const target = { kind: 'credit_card', creditCardId: cardId, invoiceMonth: '2026-11' };
    const p = (await preview(user, { fileName: 'fatura.ofx', content: fixture('nubank-fatura-ofx2.ofx'), target })).body;
    expect(p.rows.map((r) => r.note)).toEqual([null, null, 'Pagamento de fatura', 'Estorno ou crédito no cartão — a fatura soma só compras; ajuste a compra original', null]);
    const res = await user.post('/imports', commitBody(p));
    expect(res.body).toMatchObject({ created: 3, batch: { invoiceMonth: '2026-11' } });
    expect((await user.get(`/credit-cards/${cardId}/invoices/2026-11`)).body.total).toBe(4590 + 25000 + 123456);
  });

  it('turns a subcategory into category + subcategory and validates types and ownership', async () => {
    const user = await registerUser(app, 'Categorias Import');
    const cardId = (await user.post('/credit-cards', CARD)).body.id as string;
    const food = await firstCategory(user, 'expense', 'Alimentação');
    const income = await firstCategory(user, 'income');
    const p = (await preview(user, { fileName: 'n.csv', content: fixture('nubank-cartao.csv'), target: { kind: 'credit_card', creditCardId: cardId } })).body;
    const body = commitBody(p);
    body.rows[0]!.categoryId = food.subcategories[0]!.id;
    expect((await user.post('/imports', { ...body, rows: [{ ...body.rows[1]!, categoryId: income.id }] })).status).toBe(422);
    const ok = await user.post('/imports', body);
    expect(ok.status).toBe(201);
    const tx = (await user.get(`/transactions?creditCardId=${cardId}&search=Padaria`)).body.items[0];
    expect(tx).toMatchObject({ categoryId: food.id, subcategoryId: food.subcategories[0]!.id });
  });
});

describe('CSV detection and limits', () => {
  it('returns the columns without rows when the layout is unknown, and accepts a mapping', async () => {
    const user = await registerUser(app, 'Mapeamento');
    const accountId = await createAccount(user);
    const content = 'quando|o que|quanto\n01/10/2026|Feira|-12,30\n02/10/2026|Venda|50,00\n';
    const unknown = (await preview(user, { fileName: 'x.csv', content, target: { kind: 'account', accountId } })).body;
    expect(unknown).toMatchObject({ format: 'csv', csvColumns: ['quando', 'o que', 'quanto'], rows: [] });
    // Values alone are enough here (dates and amounts), so a mapping is proposed.
    const mapping = {
      delimiter: '|',
      hasHeader: true,
      dateColumn: 0,
      descriptionColumn: 1,
      amountColumn: 2,
      debitColumn: null,
      creditColumn: null,
      dateFormat: 'DD/MM/YYYY',
      decimalSeparator: ',',
      invertSign: false,
    };
    const mapped = (await preview(user, { fileName: 'x.csv', content, target: { kind: 'account', accountId }, csv: mapping })).body;
    expect(mapped.rows.map((r) => [r.type, r.amount])).toEqual([
      ['expense', 1230],
      ['income', 5000],
    ]);
    const outOfRange = await preview(user, { fileName: 'x.csv', content, target: { kind: 'account', accountId }, csv: { ...mapping, amountColumn: 9 } });
    expect(outOfRange.status).toBe(422);
  });

  it('accepts bodies up to the content limit (no 413) and caps rows per import', async () => {
    const user = await registerUser(app, 'Arquivo Grande');
    const accountId = await createAccount(user);
    const line = (i: number) => `01/10/2026;Compra ${i} ${'x'.repeat(400)};-1,00\n`;
    let content = 'Data;Descrição;Valor\n';
    for (let i = 0; content.length < 1_600_000; i++) content += line(i);
    const big = await preview(user, { fileName: 'grande.csv', content, target: { kind: 'account', accountId } });
    expect(big.status).toBe(422);
    expect(big.body.message).toMatch(/limite por importação é 3000/);
    const tooLong = await preview(user, { fileName: 'g.csv', content: 'x'.repeat(MAX_IMPORT_CONTENT_CHARS + 1), target: { kind: 'account', accountId } });
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.message).toBe('Arquivo muito grande');
  });
});

describe('batches', () => {
  it('lists batches with remaining counts and undoes one', async () => {
    const user = await registerUser(app, 'Desfazer');
    const accountId = await createAccount(user);
    const p = (await preview(user, { content: fixture('bb-extrato-ofx1.ofx'), target: { kind: 'account', accountId } })).body;
    const first = (await user.post('/imports', commitBody(p))).body.batch;
    const csv = (await preview(user, { fileName: 'conta.csv', content: fixture('nubank-conta.csv'), target: { kind: 'account', accountId } })).body;
    const second = (await user.post('/imports', commitBody(csv))).body.batch;
    // Editing or deleting imported rows changes what is left of the batch.
    const tx = (await user.get(`/transactions?accountId=${accountId}&search=SUPERMERCADO`)).body.items[0];
    expect((await user.del(`/transactions/${tx.id}`)).status).toBe(204);

    const list = await user.get('/imports?page=1&pageSize=10');
    expect(list.body).toMatchObject({ total: 2, page: 1, pageSize: 10 });
    expect(list.body.items.map((b: { id: string; remainingCount: number }) => [b.id, b.remainingCount])).toEqual([
      [second.id, 3],
      [first.id, 3],
    ]);
    expect((await user.get('/imports?page=2&pageSize=1')).body.items.map((b: { id: string }) => b.id)).toEqual([first.id]);

    expect((await user.del(`/imports/${first.id}`)).status).toBe(204);
    expect((await user.get(`/transactions?accountId=${accountId}`)).body.total).toBe(3);
    expect((await user.get('/imports')).body.items.map((b: { id: string }) => b.id)).toEqual([second.id]);
    expect((await user.del(`/imports/${first.id}`)).status).toBe(404);

    const workspaceId = (await user.get('/auth/me')).body.workspace.id;
    const logs = await executeRows<{ action: string; metadata: Record<string, unknown> }>(
      admin(),
      sql`select action, metadata from audit_logs where workspace_id = ${workspaceId} and action like 'import.%' order by created_at`,
    );
    expect(logs.map((l) => l.action)).toEqual(['import.created', 'import.created', 'import.undone']);
    expect(logs[2]!.metadata).toEqual({ origin: 'file', removed: 3 });
    // No amounts, descriptions or file names in the audit trail.
    expect(JSON.stringify(logs)).not.toMatch(/extrato|SUPERMERCADO|5200/);
  });
});

describe('permissions and isolation', () => {
  it('viewers read but cannot import; expired workspaces get 402 on writes', async () => {
    const owner = await registerUser(app, 'Dona Import');
    const { workspaceId, viewer } = await familyWithViewer(owner);
    const accountId = await createAccount(owner);
    const p = (await preview(owner, { content: fixture('bb-extrato-ofx1.ofx'), target: { kind: 'account', accountId } })).body;
    const batch = (await owner.post('/imports', commitBody(p))).body.batch;

    expect((await preview(viewer, { content: fixture('bb-extrato-ofx1.ofx'), target: { kind: 'account', accountId } })).status).toBe(403);
    expect((await viewer.post('/imports', commitBody(p))).status).toBe(403);
    expect((await viewer.del(`/imports/${batch.id}`)).status).toBe(403);
    const seen = await viewer.get('/imports');
    expect(seen.status).toBe(200);
    expect(seen.body.items[0]).toMatchObject({ id: batch.id, createdByName: 'Dona Import' });

    await admin().execute(sql`update subscriptions set trial_ends_at = now() - interval '1 day' where workspace_id = ${workspaceId}`);
    expect((await preview(owner, { content: fixture('bb-extrato-ofx1.ofx'), target: { kind: 'account', accountId } })).status).toBe(402);
    expect((await owner.post('/imports', commitBody(p))).status).toBe(402);
    expect((await owner.del(`/imports/${batch.id}`)).status).toBe(402);
    expect((await owner.get('/imports')).status).toBe(200);
  });

  it('never reads or writes another workspace (targets, categories, batches)', async () => {
    const alice = await registerUser(app, 'Alice Import');
    const bob = await registerUser(app, 'Bob Import');
    const aliceAccount = await createAccount(alice);
    const aliceCard = (await alice.post('/credit-cards', CARD)).body.id;
    const aliceCategory = await firstCategory(alice, 'expense');
    const p = (await preview(alice, { content: fixture('bb-extrato-ofx1.ofx'), target: { kind: 'account', accountId: aliceAccount } })).body;
    const aliceBatch = (await alice.post('/imports', commitBody(p))).body.batch;

    const bobAccount = await createAccount(bob);
    expect((await preview(bob, { content: fixture('bb-extrato-ofx1.ofx'), target: { kind: 'account', accountId: aliceAccount } })).status).toBe(404);
    expect((await preview(bob, { content: fixture('nubank-cartao.csv'), target: { kind: 'credit_card', creditCardId: aliceCard } })).status).toBe(404);
    expect((await bob.post('/imports', commitBody(p))).status).toBe(404);
    const withForeignCategory = commitBody(p, { target: { kind: 'account', accountId: bobAccount } });
    withForeignCategory.rows[1]!.categoryId = aliceCategory.id;
    expect((await bob.post('/imports', withForeignCategory)).status).toBe(404);
    expect((await bob.del(`/imports/${aliceBatch.id}`)).status).toBe(404);
    expect((await bob.get('/imports')).body).toMatchObject({ items: [], total: 0 });
    // Bob's own copy of the same file does not collide with Alice's external ids.
    expect((await bob.post('/imports', commitBody(p, { target: { kind: 'account', accountId: bobAccount } }))).body.created).toBe(4);
    expect((await alice.get('/imports')).body.items[0]).toMatchObject({ id: aliceBatch.id, remainingCount: 4 });
  });
});
