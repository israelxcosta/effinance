// Demo data shared by the CLI seed (`pnpm --filter @effinance/api db:seed`) and the in-browser
// demo build. Idempotent — the demo users and their workspaces are removed and recreated: Marina's
// personal workspace (in trial) with ~8 months of history, and "Família Costa" (Família plan) shared
// with Rafael. Keep this module free of Node-only imports: it also runs in the browser (PGlite).

import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import {
  addDays,
  addMonthKey,
  daysInMonth,
  getInvoiceDates,
  monthKey,
  parseISODate,
  todayISO,
  transactionInputSchema,
  type ISODate,
  type TransactionInput,
} from '@effinance/shared';
import type { DbExecutor } from './client';
import { accounts, categories, subscriptions, transactions, users, workspaceMembers, workspaces } from './schema';
import { withTenant } from '../lib/tenant';
import { register } from '../modules/auth/service';
import { seedDefaultCategories } from '../modules/categories/service';
import { createWorkspace } from '../modules/workspaces/service';
import { createAccount } from '../modules/accounts/service';
import { createCreditCard, payInvoice } from '../modules/credit-cards/service';
import { createContact } from '../modules/contacts/service';
import { addContribution, createGoal } from '../modules/goals/service';
import { createTransaction } from '../modules/transactions/service';
import { createTransfer } from '../modules/transfers/service';

export const DEMO_EMAIL = 'demo@effinance.app';
export const DEMO_PASSWORD = 'demo12345';
/** Second member of the shared "Família Costa" workspace. */
export const DEMO_PARTNER_EMAIL = 'rafael@effinance.app';
export const FAMILY_WORKSPACE_NAME = 'Família Costa';

/** Deterministic PRNG so every seed run produces the same numbers. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCpf(base: string): string {
  const d = base.split('').map(Number);
  for (const len of [9, 10]) {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += d[i]! * (len + 1 - i);
    const rest = (sum * 10) % 11;
    d.push(rest === 10 ? 0 : rest);
  }
  return d.join('');
}

function makeCnpj(base: string): string {
  const d = base.split('').map(Number);
  for (const weights of [
    [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2],
    [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2],
  ]) {
    const sum = weights.reduce((acc, w, i) => acc + w * d[i]!, 0);
    const rest = sum % 11;
    d.push(rest < 2 ? 0 : 11 - rest);
  }
  return d.join('');
}

async function seedPersonal(db: DbExecutor, workspaceId: string): Promise<number> {
  const today = todayISO();
  const rand = mulberry32(20261020);
  const between = (min: number, max: number) => Math.round(min + rand() * (max - min));
  const dayIn = (month: string, day: number): ISODate => {
    const { year, month: m } = parseISODate(`${month}-01`);
    return `${month}-${String(Math.min(day, daysInMonth(year, m))).padStart(2, '0')}`;
  };
  const currentMonth = monthKey(today);
  const firstMonth = addMonthKey(currentMonth, -7);
  const months: string[] = [];
  for (let m = firstMonth; m <= currentMonth; m = addMonthKey(m, 1)) months.push(m);

  const cats = await db.select().from(categories).where(eq(categories.workspaceId, workspaceId));
  const cat = (name: string, sub?: string) => {
    const parent = cats.find((c) => c.name === name && !c.parentId);
    if (!parent) throw new Error(`category ${name} not found`);
    const child = sub ? cats.find((c) => c.parentId === parent.id && c.name === sub) : undefined;
    if (sub && !child) throw new Error(`subcategory ${sub} not found`);
    return { categoryId: parent.id, subcategoryId: child?.id ?? null };
  };

  // --- accounts & cards -----------------------------------------------------
  const [wallet] = await db.select().from(accounts).where(eq(accounts.workspaceId, workspaceId));
  await db.update(accounts).set({ initialBalance: 30000 }).where(eq(accounts.id, wallet!.id));
  const nubank = await createAccount(db, workspaceId, {
    name: 'Nubank',
    type: 'checking',
    bank: 'nubank',
    color: '#820AD1',
    icon: 'wallet',
    initialBalance: 320000,
    includeInTotal: true,
    archived: false,
  });
  const itau = await createAccount(db, workspaceId, {
    name: 'Itaú Personnalité',
    type: 'checking',
    bank: 'itau',
    color: '#EC7000',
    icon: 'landmark',
    initialBalance: 850000,
    includeInTotal: true,
    archived: false,
  });
  const xp = await createAccount(db, workspaceId, {
    name: 'XP Investimentos',
    type: 'investment',
    bank: 'xp',
    color: '#111111',
    icon: 'trending-up',
    initialBalance: 1500000,
    includeInTotal: true,
    archived: false,
  });

  const nuCard = await createCreditCard(db, workspaceId, {
    name: 'Nubank Mastercard',
    bank: 'nubank',
    brand: 'mastercard',
    limit: 800000,
    closingDay: 3,
    dueDay: 10,
    color: '#820AD1',
    defaultAccountId: nubank.id,
    archived: false,
  });
  const itauCard = await createCreditCard(db, workspaceId, {
    name: 'Itaú Visa Infinite',
    bank: 'itau',
    brand: 'visa',
    limit: 1200000,
    closingDay: 25,
    dueDay: 5,
    color: '#EC7000',
    defaultAccountId: itau.id,
    archived: false,
  });

  // --- contacts -------------------------------------------------------------
  const contact = async (input: Parameters<typeof createContact>[2]) => (await createContact(db, workspaceId, input)).id;
  const blank = {
    email: null,
    phone: null,
    zipCode: null,
    street: null,
    number: null,
    complement: null,
    district: null,
    city: null,
    state: null,
    notes: null,
  };
  const employer = await contact({
    ...blank,
    name: 'Tech Solutions Ltda',
    document: makeCnpj('112223330001'),
    email: 'rh@techsolutions.com.br',
    phone: '1130304040',
    city: 'São Paulo',
    state: 'SP',
  });
  const landlord = await contact({
    ...blank,
    name: 'Imobiliária Lar Doce Lar',
    document: makeCnpj('445556660001'),
    email: 'contato@lardocelar.com.br',
    phone: '1132324545',
    zipCode: '04538133',
    street: 'Av. Brigadeiro Faria Lima',
    number: '3477',
    district: 'Itaim Bibi',
    city: 'São Paulo',
    state: 'SP',
  });
  const condo = await contact({
    ...blank,
    name: 'Condomínio Residencial Aurora',
    document: makeCnpj('778889990001'),
    city: 'São Paulo',
    state: 'SP',
  });
  const mariana = await contact({
    ...blank,
    name: 'Mariana Souza',
    document: makeCpf('529982247'),
    email: 'mariana.souza@email.com',
    phone: '11987654321',
    zipCode: '01310100',
    street: 'Av. Paulista',
    number: '1000',
    complement: 'Sala 12',
    district: 'Bela Vista',
    city: 'São Paulo',
    state: 'SP',
    notes: 'Cliente de projetos de design',
  });
  const carlos = await contact({
    ...blank,
    name: 'Carlos Pereira',
    document: makeCpf('390533447'),
    email: 'carlos.pereira@email.com',
    phone: '21998761234',
    city: 'Rio de Janeiro',
    state: 'RJ',
  });
  const dentist = await contact({
    ...blank,
    name: 'Dra. Fernanda Lima',
    document: makeCpf('111444777'),
    phone: '1133445566',
    city: 'São Paulo',
    state: 'SP',
  });

  // --- helpers --------------------------------------------------------------
  const create = (input: TransactionInput) => createTransaction(db, workspaceId, transactionInputSchema.parse(input));
  /** Marks every account-based occurrence of a series due before today as paid on its due date. */
  const settlePast = async (recurrenceId: string | null | undefined, inclusive = false) => {
    if (!recurrenceId) return;
    await db
      .update(transactions)
      .set({ paid: true, paidAt: sql`${transactions.date}` })
      .where(
        and(
          eq(transactions.recurrenceId, recurrenceId),
          inclusive ? lte(transactions.date, today) : sql`${transactions.date} < ${today}`,
        ),
      );
  };

  // --- fixed income & bills -------------------------------------------------
  const start = (day: number) => dayIn(firstMonth, day);
  const salary = await create({
    type: 'income',
    description: 'Salário',
    amount: 850000,
    date: start(5),
    accountId: itau.id,
    contactId: employer,
    paymentMethod: 'transfer',
    recurrenceKind: 'fixed',
    ...cat('Salário', 'Salário mensal'),
  });
  await settlePast(salary[0]?.recurrenceId, true);

  const fixedBills: [string, number, number, string, string | undefined, TransactionInput['paymentMethod'], string | null][] = [
    ['Aluguel', 220000, 10, 'Moradia', 'Aluguel', 'bank_slip', landlord],
    ['Condomínio', 65000, 10, 'Moradia', 'Condomínio', 'bank_slip', condo],
    ['Plano de saúde', 48000, 8, 'Saúde', 'Plano de saúde', 'auto_debit', null],
  ];
  for (const [description, amount, day, c, s, paymentMethod, contactId] of fixedBills) {
    const rows = await create({
      type: 'expense',
      description,
      amount,
      date: start(day),
      accountId: itau.id,
      paymentMethod,
      contactId,
      recurrenceKind: 'fixed',
      ...cat(c, s),
    });
    await settlePast(rows[0]?.recurrenceId);
  }
  const internet = await create({
    type: 'expense',
    description: 'Internet fibra',
    amount: 11990,
    date: start(15),
    accountId: nubank.id,
    paymentMethod: 'auto_debit',
    recurrenceKind: 'fixed',
    ...cat('Moradia', 'Internet'),
  });
  await settlePast(internet[0]?.recurrenceId);

  // Subscriptions charged on the cards (settled by invoice payments below).
  await create({
    type: 'expense',
    description: 'Smart Fit',
    amount: 12990,
    date: start(12),
    creditCardId: nuCard.id,
    recurrenceKind: 'fixed',
    ...cat('Saúde', 'Academia'),
  });
  await create({
    type: 'expense',
    description: 'Netflix',
    amount: 5590,
    date: start(18),
    creditCardId: nuCard.id,
    recurrenceKind: 'fixed',
    ...cat('Assinaturas', 'Streaming'),
  });
  await create({
    type: 'expense',
    description: 'Spotify Família',
    amount: 3490,
    date: start(20),
    creditCardId: itauCard.id,
    recurrenceKind: 'fixed',
    ...cat('Assinaturas', 'Música'),
  });

  // Semiannual car insurance (open-ended) and IPTU in 10 installments.
  const insurance = await create({
    type: 'expense',
    description: 'Seguro auto',
    amount: 98000,
    date: dayIn(addMonthKey(firstMonth, 2), 15),
    accountId: itau.id,
    paymentMethod: 'bank_slip',
    recurrenceKind: 'recurring',
    frequency: 'semiannual',
    ...cat('Transporte', 'Manutenção do veículo'),
  });
  await settlePast(insurance[0]?.recurrenceId);
  const iptu = await create({
    type: 'expense',
    description: 'IPTU',
    amount: 18000,
    date: dayIn(firstMonth, 7),
    accountId: itau.id,
    paymentMethod: 'bank_slip',
    recurrenceKind: 'installment',
    installments: 10,
    installmentAmountMode: 'per_installment',
    ...cat('Impostos e taxas', 'IPTU/IPVA'),
  });
  await settlePast(iptu[0]?.recurrenceId);

  // --- monthly variable spending ---------------------------------------------
  const paidUntilToday = (date: ISODate) => ({ paid: date < today, paidAt: date < today ? date : null });
  for (const month of months) {
    const isCurrent = month === currentMonth;
    const { year, month: monthNumber } = parseISODate(`${month}-01`);
    const lastDay = isCurrent ? parseISODate(today).day : daysInMonth(year, monthNumber);
    const randomDay = () => between(1, Math.max(1, lastDay));
    const seasonal = month.endsWith('-12') ? 1.35 : 1;

    // Utilities paid from Itaú (current month still pending).
    const energyDate = dayIn(month, 22);
    await create({
      type: 'expense',
      description: 'Conta de luz',
      amount: Math.round(between(17000, 26000) * seasonal),
      date: energyDate,
      accountId: itau.id,
      paymentMethod: 'auto_debit',
      ...paidUntilToday(energyDate),
      ...cat('Moradia', 'Energia'),
    });
    const waterDate = dayIn(month, 17);
    await create({
      type: 'expense',
      description: 'Conta de água',
      amount: between(8000, 11500),
      date: waterDate,
      accountId: itau.id,
      paymentMethod: 'bank_slip',
      ...(isCurrent ? { paid: false } : { paid: true, paidAt: waterDate }),
      ...cat('Moradia', 'Água'),
    });

    // Card purchases.
    const purchases: [string, number, number, string, string, string][] = [];
    for (let i = 0; i < 4; i++) purchases.push(['Supermercado Pão de Açúcar', 18000, 46000, 'Alimentação', 'Supermercado', nuCard.id]);
    for (let i = 0; i < 5; i++) purchases.push(['iFood', 3500, 9000, 'Alimentação', 'Delivery', nuCard.id]);
    for (let i = 0; i < 7; i++) purchases.push(['Uber', 1500, 4800, 'Transporte', 'App de transporte', nuCard.id]);
    for (let i = 0; i < 3; i++) purchases.push(['Restaurante', 8000, 26000, 'Alimentação', 'Restaurantes', itauCard.id]);
    for (let i = 0; i < 2; i++) purchases.push(['Posto Shell', 20000, 28000, 'Transporte', 'Combustível', itauCard.id]);
    purchases.push(['Padaria Real', 1500, 4500, 'Alimentação', 'Padaria e café', nuCard.id]);
    if (rand() > 0.5) purchases.push(['Renner', 12000, 38000, 'Compras', 'Roupas', itauCard.id]);
    if (rand() > 0.6) purchases.push(['Cinema Cinemark', 6000, 11000, 'Lazer', 'Cinema e shows', nuCard.id]);
    if (rand() > 0.6) purchases.push(['Petz', 9000, 22000, 'Pets', 'Ração', nuCard.id]);
    for (const [description, min, max, c, s, card] of purchases) {
      await create({
        type: 'expense',
        description,
        amount: Math.round(between(min, max) * seasonal),
        date: dayIn(month, randomDay()),
        creditCardId: card,
        ...cat(c, s),
      });
    }

    // Pharmacy via Pix.
    const pharmacyDate = dayIn(month, randomDay());
    await create({
      type: 'expense',
      description: 'Drogasil',
      amount: between(3000, 12000),
      date: pharmacyDate,
      accountId: nubank.id,
      paymentMethod: 'pix',
      paid: true,
      paidAt: pharmacyDate,
      ...cat('Saúde', 'Farmácia'),
    });

    // Freelance income every other month.
    if (months.indexOf(month) % 2 === 0 && !isCurrent) {
      const date = dayIn(month, between(12, 26));
      await create({
        type: 'income',
        description: 'Projeto de identidade visual',
        amount: between(120000, 260000),
        date,
        accountId: nubank.id,
        contactId: mariana,
        paymentMethod: 'pix',
        paid: true,
        paidAt: date,
        ...cat('Freelance', 'Projetos'),
      });
    }

    // Dividends straight into the investment account.
    const divDate = dayIn(month, 15);
    if (divDate <= today) {
      await create({
        type: 'income',
        description: 'Dividendos FIIs',
        amount: between(3000, 6500),
        date: divDate,
        accountId: xp.id,
        paymentMethod: 'transfer',
        paid: true,
        paidAt: divDate,
        ...cat('Rendimentos', 'Dividendos'),
      });
    }

    // Moving money around: salary share to Nubank and the monthly investment.
    const moveDate = dayIn(month, 6);
    if (moveDate <= today) {
      await createTransfer(db, workspaceId, {
        fromAccountId: itau.id,
        toAccountId: nubank.id,
        amount: 300000,
        date: moveDate,
        description: 'Transferência para Nubank',
        notes: null,
        paid: true,
      });
      await createTransfer(db, workspaceId, {
        fromAccountId: nubank.id,
        toAccountId: xp.id,
        amount: 100000,
        date: moveDate,
        description: null,
        notes: 'Aporte mensal',
        paid: true,
      });
    }
  }

  // Bigger installment purchases.
  await create({
    type: 'expense',
    description: 'iPhone 16',
    amount: 720000,
    date: dayIn(addMonthKey(currentMonth, -4), 14),
    creditCardId: itauCard.id,
    recurrenceKind: 'installment',
    installments: 12,
    ...cat('Compras', 'Eletrônicos'),
  });
  await create({
    type: 'expense',
    description: 'Viagem Florianópolis',
    amount: 360000,
    date: dayIn(addMonthKey(currentMonth, -2), 8),
    creditCardId: nuCard.id,
    recurrenceKind: 'installment',
    installments: 6,
    ...cat('Lazer', 'Viagens'),
  });
  await create({
    type: 'expense',
    description: 'Curso de UX Design',
    amount: 89700,
    date: dayIn(addMonthKey(currentMonth, -1), 3),
    creditCardId: nuCard.id,
    recurrenceKind: 'installment',
    installments: 3,
    ...cat('Educação', 'Cursos'),
  });

  // One-off redemption from investments three months ago.
  await createTransfer(db, workspaceId, {
    fromAccountId: xp.id,
    toAccountId: itau.id,
    amount: 200000,
    date: dayIn(addMonthKey(currentMonth, -3), 20),
    description: null,
    notes: 'Resgate para a viagem',
    paid: true,
  });

  // Payables / receivables that need attention.
  await create({
    type: 'expense',
    description: 'Tratamento dentário',
    amount: 35000,
    date: addDays(today, -5),
    contactId: dentist,
    paymentMethod: 'pix',
    notes: 'Restauração + limpeza',
    ...cat('Saúde', 'Consultas e exames'),
  });
  await create({
    type: 'expense',
    description: 'Revisão do carro',
    amount: 65000,
    date: addDays(today, 6),
    accountId: itau.id,
    paymentMethod: 'debit_card',
    ...cat('Transporte', 'Manutenção do veículo'),
  });
  await create({
    type: 'income',
    description: 'Empréstimo devolvido',
    amount: 50000,
    date: addDays(today, -10),
    accountId: nubank.id,
    contactId: carlos,
    paymentMethod: 'pix',
    notes: 'Combinado em 2x — 1ª parcela',
    ...cat('Outras receitas', 'Reembolsos'),
  });
  await create({
    type: 'income',
    description: 'Projeto landing page',
    amount: 180000,
    date: addDays(today, 12),
    accountId: nubank.id,
    contactId: mariana,
    paymentMethod: 'pix',
    ...cat('Freelance', 'Projetos'),
  });
  await create({
    type: 'income',
    description: '13º salário — 1ª parcela',
    amount: 425000,
    date: dayIn(addMonthKey(currentMonth, currentMonth.endsWith('-11') ? 0 : 1), 28),
    accountId: itau.id,
    contactId: employer,
    paymentMethod: 'transfer',
    ...cat('Salário', '13º salário'),
  });

  // --- settle past card invoices ---------------------------------------------
  for (const card of [nuCard, itauCard]) {
    const open = await db
      .selectDistinct({ month: transactions.invoiceMonth })
      .from(transactions)
      .where(and(eq(transactions.creditCardId, card.id), eq(transactions.paid, false)));
    const monthsToPay = open
      .map((o) => o.month!)
      .filter((m) => getInvoiceDates(m, card.closingDay, card.dueDay).dueDate < today)
      .sort();
    for (const m of monthsToPay) {
      const due = getInvoiceDates(m, card.closingDay, card.dueDay).dueDate;
      await payInvoice(db, workspaceId, card.id, m, { accountId: card.defaultAccountId!, date: due });
    }
  }

  // --- goals -----------------------------------------------------------------
  const goal = async (input: Parameters<typeof createGoal>[2], contributions: [ISODate, number][]) => {
    const g = await createGoal(db, workspaceId, input);
    for (const [date, amount] of contributions) await addContribution(db, workspaceId, g.id, { amount, date, note: null });
  };
  const monthly = (amount: number, day = 7) =>
    months.filter((m) => dayIn(m, day) <= today).map((m) => [dayIn(m, day), amount] as [ISODate, number]);
  await goal(
    {
      name: 'Reserva de emergência',
      targetAmount: 3000000,
      deadline: dayIn(addMonthKey(currentMonth, 12), 28),
      icon: 'shield',
      color: '#152B61',
      accountId: xp.id,
      notes: '6 meses de custo de vida',
      archived: false,
    },
    [[dayIn(firstMonth, 2), 800000], ...monthly(100000)],
  );
  await goal(
    {
      name: 'Viagem para Europa',
      targetAmount: 1500000,
      deadline: dayIn(addMonthKey(currentMonth, 18), 1),
      icon: 'plane',
      color: '#0EA5E9',
      accountId: null,
      notes: 'Portugal e Espanha em 15 dias',
      archived: false,
    },
    monthly(80000, 10).slice(-6),
  );
  await goal(
    {
      name: 'Notebook novo',
      targetAmount: 800000,
      deadline: dayIn(addMonthKey(currentMonth, 3), 15),
      icon: 'laptop',
      color: '#A855F7',
      accountId: nubank.id,
      notes: null,
      archived: false,
    },
    [[dayIn(addMonthKey(currentMonth, -5), 20), 300000], ...monthly(70000, 20).slice(-5)],
  );
  await goal(
    {
      name: 'Entrada do apartamento',
      targetAmount: 8000000,
      deadline: dayIn(addMonthKey(currentMonth, 36), 1),
      icon: 'house',
      color: '#12A150',
      accountId: xp.id,
      notes: null,
      archived: false,
    },
    [[dayIn(firstMonth, 3), 1200000]],
  );

  const [count] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(transactions)
    .where(inArray(transactions.workspaceId, [workspaceId]));
  return count?.n ?? 0;
}

/** Removes the demo users and every workspace they own (data cascades). */
async function removeDemoUsers(db: DbExecutor) {
  const demoUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(inArray(users.email, [DEMO_EMAIL, DEMO_PARTNER_EMAIL]));
  if (demoUsers.length === 0) return;
  const ids = demoUsers.map((u) => u.id);
  const owned = await db
    .select({ id: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(and(inArray(workspaceMembers.userId, ids), eq(workspaceMembers.role, 'owner')));
  if (owned.length) await db.delete(workspaces).where(inArray(workspaces.id, owned.map((w) => w.id)));
  await db.delete(users).where(inArray(users.id, ids));
}

/** Shared household workspace on the Família plan, with Rafael as editor. */
async function seedFamily(db: DbExecutor, ownerId: string, partnerId: string): Promise<string> {
  const workspaceId = await db.transaction((tx) =>
    createWorkspace(tx, { name: FAMILY_WORKSPACE_NAME, kind: 'family', ownerId }),
  );
  const periodEnd = new Date();
  periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);
  await db
    .update(subscriptions)
    .set({ planCode: 'family_monthly', status: 'active', provider: 'fake', trialEndsAt: null, currentPeriodEnd: periodEnd })
    .where(eq(subscriptions.workspaceId, workspaceId));
  await db.insert(workspaceMembers).values({ workspaceId, userId: partnerId, role: 'editor' });

  await withTenant(db, workspaceId, async (tx) => {
    await seedDefaultCategories(tx, workspaceId);
    const cats = await tx.select().from(categories).where(eq(categories.workspaceId, workspaceId));
    const find = (name: string, sub?: string) => {
      const parent = cats.find((c) => c.name === name && !c.parentId)!;
      const child = sub ? cats.find((c) => c.parentId === parent.id && c.name === sub) : undefined;
      return { categoryId: parent.id, subcategoryId: child?.id ?? null };
    };
    const joint = await createAccount(tx, workspaceId, {
      name: 'Conta conjunta',
      type: 'checking',
      bank: 'inter',
      color: '#FF7A00',
      icon: 'house',
      initialBalance: 450000,
      includeInTotal: true,
      archived: false,
    });
    const today = todayISO();
    const month = monthKey(today);
    const base = { accountId: joint.id, creditCardId: null, contactId: null, paymentMethod: 'pix' as const, notes: null };
    const fixed = (description: string, amount: number, day: number, cat: ReturnType<typeof find>) =>
      createTransaction(
        tx,
        workspaceId,
        transactionInputSchema.parse({
          ...base,
          ...cat,
          type: 'expense',
          description,
          amount,
          date: `${addMonthKey(month, -2)}-${String(day).padStart(2, '0')}`,
          paid: false,
          recurrenceKind: 'fixed',
          frequency: 'monthly',
        }),
      );
    await fixed('Aluguel', 280000, 5, find('Moradia'));
    await fixed('Condomínio', 65000, 10, find('Moradia'));
    await fixed('Escola das crianças', 190000, 8, find('Educação'));
    await createTransaction(
      tx,
      workspaceId,
      transactionInputSchema.parse({
        ...base,
        ...find('Alimentação'),
        type: 'expense',
        description: 'Compras do mês',
        amount: 98000,
        date: addDays(today, -3),
        paid: true,
      }),
    );
    // Past occurrences of the fixed bills are already paid.
    await tx
      .update(transactions)
      .set({ paid: true, paidAt: sql`${transactions.date}` })
      .where(and(eq(transactions.workspaceId, workspaceId), lte(transactions.date, today)));
  });
  return workspaceId;
}

export async function seedDemo(db: DbExecutor) {
  await removeDemoUsers(db);
  const { user, workspaceId } = await register(db, {
    name: 'Marina Costa',
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    acceptTerms: true,
  });
  const n = await withTenant(db, workspaceId, (tx) => seedPersonal(tx, workspaceId));
  const partner = await register(db, {
    name: 'Rafael Costa',
    email: DEMO_PARTNER_EMAIL,
    password: DEMO_PASSWORD,
    acceptTerms: true,
  });
  const familyId = await seedFamily(db, user.id, partner.user.id);
  // Marina opens her personal workspace; Rafael opens the family one.
  await db.update(users).set({ lastWorkspaceId: workspaceId }).where(eq(users.id, user.id));
  await db.update(users).set({ lastWorkspaceId: familyId }).where(eq(users.id, partner.user.id));
  return { userId: user.id, workspaceId, familyWorkspaceId: familyId, transactions: n };
}
