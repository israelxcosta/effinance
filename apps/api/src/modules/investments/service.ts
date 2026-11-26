import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import {
  INVESTMENT_INCOME_LABELS,
  MAX_AMOUNT_CENTS,
  buildPositions,
  formatBRL,
  purchaseTotal,
  roundQuantity,
  saleCost,
  type InvestmentBroker,
  type InvestmentIncome,
  type InvestmentPortfolioResponse,
  type InvestmentPurchase,
  type InvestmentSale,
  type investmentIncomeInputSchema,
  type investmentPurchaseInputSchema,
  type investmentSaleInputSchema,
} from '@effinance/shared';
import type { z } from 'zod';
import type { DbExecutor } from '../../db/client';
import {
  accounts,
  investmentIncomes,
  investmentPurchases,
  investmentSales,
  transactions,
  type InvestmentIncomeRow,
  type InvestmentPurchaseRow,
  type InvestmentSaleRow,
} from '../../db/schema';
import { today } from '../../lib/clock';
import { accountMovements } from '../accounts/balances';
import { ensureInvestmentIncomeCategory } from '../categories/service';
import { NotFoundError, ValidationError } from '../../lib/errors';
import { getAccountOrThrow } from '../common/ownership';
import { createTransfer } from '../transfers/service';

type PurchaseInput = z.output<typeof investmentPurchaseInputSchema>;
type SaleInput = z.output<typeof investmentSaleInputSchema>;
type IncomeInput = z.output<typeof investmentIncomeInputSchema>;

type AccountRef = { id: string; name: string; bank: InvestmentBroker['bank']; color: string };

/** Name/bank/color of accounts, filtered by workspace (ids come from the server). */
async function accountRefs(db: DbExecutor, workspaceId: string, ids: (string | null)[]): Promise<Map<string, AccountRef>> {
  const unique = [...new Set(ids.filter((v): v is string => Boolean(v)))];
  if (!unique.length) return new Map();
  const rows = await db
    .select({ id: accounts.id, name: accounts.name, bank: accounts.bank, color: accounts.color })
    .from(accounts)
    .where(and(eq(accounts.workspaceId, workspaceId), inArray(accounts.id, unique)));
  return new Map(rows.map((a) => [a.id, a]));
}

function toSale(r: InvestmentSaleRow, refs: Map<string, AccountRef>): InvestmentSale {
  const quantity = Number(r.quantity);
  return {
    id: r.id,
    ticker: r.ticker,
    accountId: r.accountId,
    account: r.accountId ? (refs.get(r.accountId) ?? null) : null,
    date: r.date,
    quantity,
    unitPrice: r.unitPrice,
    fees: r.fees,
    cost: r.cost,
    proceeds: Math.round(quantity * r.unitPrice) - r.fees,
    result: r.result,
    createdAt: r.createdAt.toISOString(),
  };
}

function toIncome(r: InvestmentIncomeRow, refs: Map<string, AccountRef>): InvestmentIncome {
  return {
    id: r.id,
    kind: r.kind,
    ticker: r.ticker,
    accountId: r.accountId,
    account: r.accountId ? (refs.get(r.accountId) ?? null) : null,
    date: r.date,
    amount: r.amount,
    transactionId: r.transactionId,
    createdAt: r.createdAt.toISOString(),
  };
}

async function toPurchases(db: DbExecutor, workspaceId: string, rows: InvestmentPurchaseRow[]): Promise<InvestmentPurchase[]> {
  // The linked transfers tell which account paid (filtered by workspace: ids come from the server).
  const transferIds = rows.map((r) => r.transferId).filter((v): v is string => Boolean(v));
  const transfers = transferIds.length
    ? await db
        .select({ id: transactions.id, accountId: transactions.accountId })
        .from(transactions)
        .where(and(eq(transactions.workspaceId, workspaceId), inArray(transactions.id, transferIds)))
    : [];
  const paidFromOf = new Map(transfers.map((t) => [t.id, t.accountId]));
  const ids = [
    ...new Set([...rows.map((r) => r.accountId), ...transfers.map((t) => t.accountId)].filter((v): v is string => Boolean(v))),
  ];
  const accountRows = ids.length
    ? await db
        .select({ id: accounts.id, name: accounts.name, bank: accounts.bank, color: accounts.color })
        .from(accounts)
        .where(and(eq(accounts.workspaceId, workspaceId), inArray(accounts.id, ids)))
    : [];
  const byId = new Map(accountRows.map((a) => [a.id, a]));
  return rows.map((r) => {
    const transferAlive = r.transferId ? paidFromOf.has(r.transferId) : false;
    const paidFromId = r.transferId ? (paidFromOf.get(r.transferId) ?? null) : null;
    return {
      id: r.id,
      assetType: r.assetType,
      ticker: r.ticker,
      name: r.name,
      accountId: r.accountId,
      account: r.accountId ? (byId.get(r.accountId) ?? null) : null,
      paidFrom: paidFromId ? (byId.get(paidFromId) ?? null) : null,
      transferId: transferAlive ? r.transferId : null,
      date: r.date,
      quantity: Number(r.quantity),
      unitPrice: r.unitPrice,
      fees: r.fees,
      total: purchaseTotal(Number(r.quantity), r.unitPrice, r.fees),
      createdAt: r.createdAt.toISOString(),
    };
  });
}

export const DEFAULT_BROKER_NAME = 'Carteira';

/** The default broker ("Carteira", an investment account), created on first use. */
async function defaultBroker(db: DbExecutor, workspaceId: string): Promise<string> {
  const [existing] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.workspaceId, workspaceId), eq(accounts.type, 'investment'), eq(accounts.name, DEFAULT_BROKER_NAME)))
    .orderBy(asc(accounts.createdAt))
    .limit(1);
  if (existing) return existing.id;
  const [row] = await db
    .insert(accounts)
    .values({ workspaceId, name: DEFAULT_BROKER_NAME, type: 'investment', color: '#152B61', icon: 'trending-up', initialBalance: 0 })
    .returning({ id: accounts.id });
  return row!.id;
}

/** Books (or rebooks) the purchase's Aplicação from the paying account to the broker. */
async function bookTransfer(db: DbExecutor, workspaceId: string, input: PurchaseInput, brokerId: string): Promise<string | null> {
  if (!input.paidFromAccountId) return null;
  const from = await getAccountOrThrow(db, workspaceId, input.paidFromAccountId);
  if (from.id === brokerId) throw new ValidationError('A conta de pagamento deve ser diferente da corretora');
  if (from.type === 'investment') throw new ValidationError('Pague com uma conta corrente, poupança ou carteira');
  const transfer = await createTransfer(db, workspaceId, {
    fromAccountId: from.id,
    toAccountId: brokerId,
    amount: purchaseTotal(input.quantity, input.unitPrice, input.fees),
    date: input.date,
    description: `Compra ${input.ticker} (${String(input.quantity).replace('.', ',')} × ${formatBRL(input.unitPrice)})`.slice(0, 120),
    notes: null,
    paid: true,
  });
  return transfer.id;
}

async function dropTransfer(db: DbExecutor, workspaceId: string, transferId: string | null) {
  if (!transferId) return;
  await db.delete(transactions).where(and(eq(transactions.workspaceId, workspaceId), eq(transactions.id, transferId), eq(transactions.type, 'transfer')));
}

/** Defense in depth (the contract already refuses it): the total is a money amount like any other. */
function checkTotal(input: PurchaseInput) {
  if (purchaseTotal(input.quantity, input.unitPrice, input.fees) > MAX_AMOUNT_CENTS) {
    throw new ValidationError('Valor total da compra muito alto');
  }
}

async function checkAccount(db: DbExecutor, workspaceId: string, accountId: string | null) {
  if (!accountId) return;
  const account = await getAccountOrThrow(db, workspaceId, accountId);
  if (account.type !== 'investment') throw new ValidationError('Escolha uma conta do tipo investimento (corretora)');
}

async function getPurchaseOrThrow(db: DbExecutor, workspaceId: string, id: string): Promise<InvestmentPurchaseRow> {
  const [row] = await db
    .select()
    .from(investmentPurchases)
    .where(and(eq(investmentPurchases.workspaceId, workspaceId), eq(investmentPurchases.id, id)));
  if (!row) throw new NotFoundError('Compra não encontrada');
  return row;
}

export async function getPortfolio(db: DbExecutor, workspaceId: string): Promise<InvestmentPortfolioResponse> {
  const [rows, saleRows, incomeRows] = await Promise.all([
    db
      .select()
      .from(investmentPurchases)
      .where(eq(investmentPurchases.workspaceId, workspaceId))
      .orderBy(desc(investmentPurchases.date), desc(investmentPurchases.createdAt)),
    db
      .select()
      .from(investmentSales)
      .where(eq(investmentSales.workspaceId, workspaceId))
      .orderBy(desc(investmentSales.date), desc(investmentSales.createdAt)),
    db
      .select()
      .from(investmentIncomes)
      .where(eq(investmentIncomes.workspaceId, workspaceId))
      .orderBy(desc(investmentIncomes.date), desc(investmentIncomes.createdAt)),
  ]);
  const purchases = await toPurchases(db, workspaceId, rows);
  const refs = await accountRefs(db, workspaceId, [...saleRows.map((r) => r.accountId), ...incomeRows.map((r) => r.accountId)]);
  const sales = saleRows.map((r) => toSale(r, refs));
  const incomes = incomeRows.map((r) => toIncome(r, refs));
  const positions = buildPositions(purchases, sales, incomes);
  const held = new Set(positions.map((p) => p.ticker));

  const brokerRows = await db
    .select({ id: accounts.id, name: accounts.name, bank: accounts.bank, color: accounts.color, archived: accounts.archived, initialBalance: accounts.initialBalance })
    .from(accounts)
    .where(and(eq(accounts.workspaceId, workspaceId), eq(accounts.type, 'investment')))
    .orderBy(asc(accounts.createdAt));
  const now = today();
  const movements = await accountMovements(db, workspaceId, now);
  const brokers: InvestmentBroker[] = brokerRows
    .map((b) => {
      const mine = purchases.filter((p) => p.accountId === b.id);
      // Cost of what is still held here: purchases minus the cost of what was sold here.
      const invested =
        mine.reduce((sum, p) => sum + p.total, 0) - sales.filter((x) => x.accountId === b.id).reduce((sum, x) => sum + x.cost, 0);
      const balance = b.initialBalance + (movements.get(b.id)?.realized ?? 0);
      return {
        id: b.id,
        name: b.name,
        bank: b.bank,
        color: b.color,
        invested,
        assets: new Set(mine.map((p) => p.ticker).filter((t) => held.has(t))).size,
        available: balance - invested,
        archived: b.archived,
      };
    })
    .filter((b) => !b.archived || b.invested > 0 || b.available !== 0)
    .map(({ archived: _a, ...b }) => b)
    .sort((a, b) => b.invested - a.invested);
  const year = now.slice(0, 4);
  return {
    positions,
    brokers,
    purchases,
    sales,
    incomes,
    totalInvested: positions.reduce((a, p) => a + p.totalInvested, 0),
    available: brokers.reduce((a, b) => a + b.available, 0),
    realizedResult: sales.reduce((a, x) => a + x.result, 0),
    incomesYear: incomes.filter((x) => x.date.startsWith(year)).reduce((a, x) => a + x.amount, 0),
  };
}

/** Broker for a sale/income: the one chosen, else the latest purchase of the asset, else "Carteira". */
async function brokerFor(db: DbExecutor, workspaceId: string, accountId: string | null, ticker: string | null): Promise<string> {
  if (accountId) {
    await checkAccount(db, workspaceId, accountId);
    return accountId;
  }
  if (ticker) {
    const [last] = await db
      .select({ accountId: investmentPurchases.accountId })
      .from(investmentPurchases)
      .where(and(eq(investmentPurchases.workspaceId, workspaceId), eq(investmentPurchases.ticker, ticker)))
      .orderBy(desc(investmentPurchases.date), desc(investmentPurchases.createdAt))
      .limit(1);
    if (last?.accountId) return last.accountId;
  }
  return defaultBroker(db, workspaceId);
}

/** Current position of one asset (purchases minus sales). */
export async function positionOf(db: DbExecutor, workspaceId: string, ticker: string) {
  const [buys, sells] = await Promise.all([
    db.select().from(investmentPurchases).where(and(eq(investmentPurchases.workspaceId, workspaceId), eq(investmentPurchases.ticker, ticker))),
    db.select().from(investmentSales).where(and(eq(investmentSales.workspaceId, workspaceId), eq(investmentSales.ticker, ticker))),
  ]);
  const [position] = buildPositions(
    buys.map((b) => ({ ...b, quantity: Number(b.quantity) })),
    sells.map((x) => ({ ticker: x.ticker, quantity: Number(x.quantity), cost: x.cost, result: x.result })),
  );
  return position ?? null;
}

/**
 * Sells part or all of a position. The cost is the average price × quantity (the average price of
 * what is left does not change); the result (proceeds − fees − cost) changes the broker balance only.
 */
export async function createSale(db: DbExecutor, workspaceId: string, input: SaleInput): Promise<InvestmentSale> {
  const row = await db.transaction(async (tx) => {
    const position = await positionOf(tx, workspaceId, input.ticker);
    if (!position) throw new ValidationError(`Não há ${input.ticker} na carteira para vender`);
    if (roundQuantity(input.quantity - position.quantity) > 0) {
      throw new ValidationError(`A carteira tem ${String(position.quantity).replace('.', ',')} de ${input.ticker}`);
    }
    const brokerId = await brokerFor(tx, workspaceId, input.accountId, input.ticker);
    const cost = saleCost(position, input.quantity);
    const result = Math.round(input.quantity * input.unitPrice) - input.fees - cost;
    const [created] = await tx
      .insert(investmentSales)
      .values({ workspaceId, accountId: brokerId, ticker: input.ticker, date: input.date, quantity: input.quantity, unitPrice: input.unitPrice, fees: input.fees, cost, result })
      .returning();
    return created!;
  });
  return toSale(row, await accountRefs(db, workspaceId, [row.accountId]));
}

export async function deleteSale(db: DbExecutor, workspaceId: string, id: string): Promise<void> {
  const deleted = await db
    .delete(investmentSales)
    .where(and(eq(investmentSales.workspaceId, workspaceId), eq(investmentSales.id, id)))
    .returning({ id: investmentSales.id });
  if (!deleted.length) throw new NotFoundError('Venda não encontrada');
}

/** Dividends, JCP, interest or yield: an income transaction in "Rendimentos" at the broker account. */
export async function createIncome(db: DbExecutor, workspaceId: string, input: IncomeInput): Promise<InvestmentIncome> {
  const row = await db.transaction(async (tx) => {
    const brokerId = await brokerFor(tx, workspaceId, input.accountId, input.ticker);
    const label = INVESTMENT_INCOME_LABELS[input.kind];
    const category = await ensureInvestmentIncomeCategory(tx, workspaceId, label);
    const [transaction] = await tx
      .insert(transactions)
      .values({
        workspaceId,
        type: 'income',
        description: input.ticker ? `${label} ${input.ticker}` : label,
        amount: input.amount,
        date: input.date,
        paid: true,
        paidAt: input.date,
        accountId: brokerId,
        categoryId: category.categoryId,
        subcategoryId: category.subcategoryId,
        recurrenceKind: 'single',
      })
      .returning({ id: transactions.id });
    const [created] = await tx
      .insert(investmentIncomes)
      .values({ workspaceId, accountId: brokerId, kind: input.kind, ticker: input.ticker, date: input.date, amount: input.amount, transactionId: transaction!.id })
      .returning();
    return created!;
  });
  return toIncome(row, await accountRefs(db, workspaceId, [row.accountId]));
}

export async function deleteIncome(db: DbExecutor, workspaceId: string, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const deleted = await tx
      .delete(investmentIncomes)
      .where(and(eq(investmentIncomes.workspaceId, workspaceId), eq(investmentIncomes.id, id)))
      .returning({ transactionId: investmentIncomes.transactionId });
    if (!deleted.length) throw new NotFoundError('Provento não encontrado');
    const transactionId = deleted[0]!.transactionId;
    if (transactionId) {
      await tx.delete(transactions).where(and(eq(transactions.workspaceId, workspaceId), eq(transactions.id, transactionId)));
    }
  });
}

export async function createPurchase(db: DbExecutor, workspaceId: string, input: PurchaseInput): Promise<InvestmentPurchase> {
  checkTotal(input);
  await checkAccount(db, workspaceId, input.accountId);
  const row = await db.transaction(async (tx) => {
    const brokerId = input.accountId ?? (await defaultBroker(tx, workspaceId));
    const transferId = await bookTransfer(tx, workspaceId, input, brokerId);
    const { paidFromAccountId: _paid, ...values } = input;
    const [created] = await tx
      .insert(investmentPurchases)
      .values({ workspaceId, ...values, accountId: brokerId, transferId })
      .returning();
    return created!;
  });
  return (await toPurchases(db, workspaceId, [row]))[0]!;
}

export async function updatePurchase(
  db: DbExecutor,
  workspaceId: string,
  id: string,
  input: PurchaseInput,
): Promise<InvestmentPurchase> {
  checkTotal(input);
  const current = await getPurchaseOrThrow(db, workspaceId, id);
  await checkAccount(db, workspaceId, input.accountId);
  const row = await db.transaction(async (tx) => {
    const brokerId = input.accountId ?? (await defaultBroker(tx, workspaceId));
    // Simplest consistent rule: the old Aplicação goes away and a new one matches the edited purchase.
    await dropTransfer(tx, workspaceId, current.transferId);
    const transferId = await bookTransfer(tx, workspaceId, input, brokerId);
    const { paidFromAccountId: _paid, ...values } = input;
    const [updated] = await tx
      .update(investmentPurchases)
      .set({ ...values, accountId: brokerId, transferId })
      .where(and(eq(investmentPurchases.workspaceId, workspaceId), eq(investmentPurchases.id, id)))
      .returning();
    return updated!;
  });
  return (await toPurchases(db, workspaceId, [row]))[0]!;
}

export async function deletePurchase(db: DbExecutor, workspaceId: string, id: string): Promise<void> {
  const current = await getPurchaseOrThrow(db, workspaceId, id);
  await db.transaction(async (tx) => {
    await dropTransfer(tx, workspaceId, current.transferId);
    await tx
      .delete(investmentPurchases)
      .where(and(eq(investmentPurchases.workspaceId, workspaceId), eq(investmentPurchases.id, id)));
  });
}
