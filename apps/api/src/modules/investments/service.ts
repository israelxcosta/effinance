import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import {
  MAX_AMOUNT_CENTS,
  buildPositions,
  formatBRL,
  purchaseTotal,
  type InvestmentBroker,
  type InvestmentPortfolioResponse,
  type InvestmentPurchase,
  type investmentPurchaseInputSchema,
} from '@effinance/shared';
import type { z } from 'zod';
import type { DbExecutor } from '../../db/client';
import { accounts, investmentPurchases, transactions, type InvestmentPurchaseRow } from '../../db/schema';
import { NotFoundError, ValidationError } from '../../lib/errors';
import { getAccountOrThrow } from '../common/ownership';
import { createTransfer } from '../transfers/service';

type PurchaseInput = z.output<typeof investmentPurchaseInputSchema>;

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
  const rows = await db
    .select()
    .from(investmentPurchases)
    .where(eq(investmentPurchases.workspaceId, workspaceId))
    .orderBy(desc(investmentPurchases.date), desc(investmentPurchases.createdAt));
  const purchases = await toPurchases(db, workspaceId, rows);
  const positions = buildPositions(purchases);
  const brokerRows = await db
    .select({ id: accounts.id, name: accounts.name, bank: accounts.bank, color: accounts.color, archived: accounts.archived })
    .from(accounts)
    .where(and(eq(accounts.workspaceId, workspaceId), eq(accounts.type, 'investment')))
    .orderBy(asc(accounts.createdAt));
  const brokers: InvestmentBroker[] = brokerRows
    .map((b) => {
      const mine = purchases.filter((p) => p.accountId === b.id);
      return { id: b.id, name: b.name, bank: b.bank, color: b.color, invested: mine.reduce((s, p) => s + p.total, 0), assets: new Set(mine.map((p) => p.ticker)).size, archived: b.archived };
    })
    .filter((b) => !b.archived || b.invested > 0)
    .map(({ archived: _a, ...b }) => b)
    .sort((a, b) => b.invested - a.invested);
  return { positions, brokers, purchases, totalInvested: positions.reduce((a, p) => a + p.totalInvested, 0) };
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
