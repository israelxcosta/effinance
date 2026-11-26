import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  buildPositions,
  purchaseTotal,
  type InvestmentPortfolioResponse,
  type InvestmentPurchase,
  type investmentPurchaseInputSchema,
} from '@effinance/shared';
import type { z } from 'zod';
import type { DbExecutor } from '../../db/client';
import { accounts, investmentPurchases, type InvestmentPurchaseRow } from '../../db/schema';
import { NotFoundError, ValidationError } from '../../lib/errors';
import { getAccountOrThrow } from '../common/ownership';

type PurchaseInput = z.output<typeof investmentPurchaseInputSchema>;

async function toPurchases(db: DbExecutor, workspaceId: string, rows: InvestmentPurchaseRow[]): Promise<InvestmentPurchase[]> {
  const ids = [...new Set(rows.map((r) => r.accountId).filter((v): v is string => Boolean(v)))];
  const accountRows = ids.length
    ? await db
        .select({ id: accounts.id, name: accounts.name, bank: accounts.bank, color: accounts.color })
        .from(accounts)
        .where(and(eq(accounts.workspaceId, workspaceId), inArray(accounts.id, ids)))
    : [];
  const byId = new Map(accountRows.map((a) => [a.id, a]));
  return rows.map((r) => ({
    id: r.id,
    assetType: r.assetType,
    ticker: r.ticker,
    name: r.name,
    accountId: r.accountId,
    account: r.accountId ? (byId.get(r.accountId) ?? null) : null,
    date: r.date,
    quantity: Number(r.quantity),
    unitPrice: r.unitPrice,
    fees: r.fees,
    total: purchaseTotal(Number(r.quantity), r.unitPrice, r.fees),
    createdAt: r.createdAt.toISOString(),
  }));
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
  return { positions, purchases, totalInvested: positions.reduce((a, p) => a + p.totalInvested, 0) };
}

export async function createPurchase(db: DbExecutor, workspaceId: string, input: PurchaseInput): Promise<InvestmentPurchase> {
  await checkAccount(db, workspaceId, input.accountId);
  const [row] = await db
    .insert(investmentPurchases)
    .values({ workspaceId, ...input })
    .returning();
  return (await toPurchases(db, workspaceId, [row!]))[0]!;
}

export async function updatePurchase(
  db: DbExecutor,
  workspaceId: string,
  id: string,
  input: PurchaseInput,
): Promise<InvestmentPurchase> {
  await getPurchaseOrThrow(db, workspaceId, id);
  await checkAccount(db, workspaceId, input.accountId);
  const [row] = await db
    .update(investmentPurchases)
    .set(input)
    .where(and(eq(investmentPurchases.workspaceId, workspaceId), eq(investmentPurchases.id, id)))
    .returning();
  return (await toPurchases(db, workspaceId, [row!]))[0]!;
}

export async function deletePurchase(db: DbExecutor, workspaceId: string, id: string): Promise<void> {
  await getPurchaseOrThrow(db, workspaceId, id);
  await db
    .delete(investmentPurchases)
    .where(and(eq(investmentPurchases.workspaceId, workspaceId), eq(investmentPurchases.id, id)));
}
