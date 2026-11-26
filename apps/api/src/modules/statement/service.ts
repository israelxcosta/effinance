import { and, asc, eq, inArray, ne, or, sql } from 'drizzle-orm';
import {
  addDays,
  formatBRL,
  type StatementEntry,
  type StatementResponse,
  type statementQuerySchema,
} from '@effinance/shared';
import type { z } from 'zod';
import type { DbExecutor } from '../../db/client';
import { accounts, investmentSales, transactions, type AccountRow, type InvestmentSaleRow, type TransactionRow } from '../../db/schema';
import { getAccountWithBalance } from '../accounts/service';
import { accountMovements } from '../accounts/balances';
import { getAccountOrThrow } from '../common/ownership';
import { effectiveDateOf, loadRefMaps, toTransaction } from '../transactions/mapper';
import { ensureMaterialized } from '../transactions/series';
import { today } from '../../lib/clock';

type StatementQuery = z.output<typeof statementQuerySchema>;

/** Accounts that make up "saldo em contas": not investment, included in total, not archived. */
export async function cashAccounts(db: DbExecutor, workspaceId: string): Promise<AccountRow[]> {
  return db
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.workspaceId, workspaceId),
        ne(accounts.type, 'investment'),
        eq(accounts.includeInTotal, true),
        eq(accounts.archived, false),
      ),
    );
}

/** Signed effect of a row on a set of accounts (internal transfers net to zero). */
export function effectOn(row: TransactionRow, ids: Set<string>): number {
  let effect = 0;
  if (row.accountId && ids.has(row.accountId)) effect += row.type === 'income' ? row.amount : -row.amount;
  if (row.type === 'transfer' && row.toAccountId && ids.has(row.toAccountId)) effect += row.amount;
  return effect;
}

/** Paid balance of a set of accounts at the end of `date` (initial balances included). */
export async function balanceAt(db: DbExecutor, workspaceId: string, set: AccountRow[], date: string) {
  const sums = await accountMovements(db, workspaceId, date);
  return set.reduce((acc, a) => acc + a.initialBalance + (sums.get(a.id)?.realized ?? 0), 0);
}

export async function getStatement(db: DbExecutor, workspaceId: string, q: StatementQuery): Promise<StatementResponse> {
  await ensureMaterialized(db, workspaceId, q.to);

  const set = q.accountId ? [await getAccountOrThrow(db, workspaceId, q.accountId)] : await cashAccounts(db, workspaceId);
  const ids = new Set(set.map((a) => a.id));
  const account = q.accountId ? await getAccountWithBalance(db, workspaceId, q.accountId) : null;

  const openingBalance = set.length ? await balanceAt(db, workspaceId, set, addDays(q.from, -1)) : 0;

  const rows =
    set.length === 0
      ? []
      : await db
          .select()
          .from(transactions)
          .where(
            and(
              eq(transactions.workspaceId, workspaceId),
              or(inArray(transactions.accountId, [...ids]), inArray(transactions.toAccountId, [...ids])),
              or(
                sql`${transactions.paid} and coalesce(${transactions.paidAt}, ${transactions.date}) between ${q.from} and ${q.to}`,
                q.includePending
                  ? sql`not ${transactions.paid} and ${transactions.date} between ${q.from} and ${q.to}`
                  : undefined,
              ),
            ),
          )
          .orderBy(asc(transactions.date), asc(transactions.createdAt));

  // Investment sale results move broker balances (accountMovements): read-only lines keep the
  // running balance of a broker's statement right. Only brokers selected one by one have them.
  const sales =
    set.some((a) => a.type === 'investment')
      ? await db
          .select()
          .from(investmentSales)
          .where(
            and(
              eq(investmentSales.workspaceId, workspaceId),
              inArray(investmentSales.accountId, [...ids]),
              sql`${investmentSales.date} between ${q.from} and ${q.to}`,
              ne(investmentSales.result, 0),
            ),
          )
      : [];
  const saleIds = new Set(sales.map((sale) => sale.id));
  rows.push(...sales.map(saleRow));

  rows.sort((a, b) => {
    const ea = effectiveDateOf(a);
    const eb = effectiveDateOf(b);
    return ea === eb ? a.createdAt.getTime() - b.createdAt.getTime() : ea < eb ? -1 : 1;
  });

  const refs = await loadRefMaps(db, rows);
  const now = today();
  let realized = openingBalance;
  let projected = openingBalance;
  let totalIn = 0;
  let totalOut = 0;
  let pendingIn = 0;
  let pendingOut = 0;
  const entries: StatementEntry[] = rows.map((row) => {
    const amount = effectOn(row, ids);
    const pending = !row.paid;
    projected += amount;
    if (pending) {
      if (amount > 0) pendingIn += amount;
      else pendingOut += -amount;
    } else {
      realized += amount;
      if (amount > 0) totalIn += amount;
      else totalOut += -amount;
    }
    const transaction = toTransaction(row, refs, now);
    if (saleIds.has(row.id)) transaction.investmentSaleId = row.id;
    return {
      transaction,
      amount,
      balanceAfter: pending ? projected : realized,
      pending,
    };
  });

  return {
    account,
    from: q.from,
    to: q.to,
    openingBalance,
    closingBalance: realized,
    projectedClosingBalance: projected,
    totalIn,
    totalOut,
    pendingIn,
    pendingOut,
    entries,
  };
}

/** A sale result as a statement row (never stored as a transaction). */
function saleRow(sale: InvestmentSaleRow): TransactionRow {
  const qty = String(sale.quantity).replace('.', ',');
  return {
    id: sale.id,
    workspaceId: sale.workspaceId,
    type: sale.result > 0 ? 'income' : 'expense',
    description: `Venda ${sale.ticker} (${qty} × ${formatBRL(sale.unitPrice)}) · ${sale.result > 0 ? 'lucro' : 'prejuízo'}`,
    amount: Math.abs(sale.result),
    date: sale.date,
    paid: true,
    paidAt: sale.date,
    accountId: sale.accountId,
    toAccountId: null,
    creditCardId: null,
    invoiceMonth: null,
    categoryId: null,
    subcategoryId: null,
    contactId: null,
    paymentMethod: null,
    notes: null,
    transferKind: null,
    recurrenceId: null,
    recurrenceKind: 'single',
    frequency: null,
    installmentNumber: null,
    installmentTotal: null,
    occurrenceIndex: null,
    splitGroupId: null,
    origin: 'manual',
    importBatchId: null,
    externalId: null,
    createdAt: sale.createdAt,
    updatedAt: sale.createdAt,
  };
}
