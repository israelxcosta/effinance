import { and, asc, eq, inArray, ne, or, sql } from 'drizzle-orm';
import {
  addDays,
  type StatementEntry,
  type StatementResponse,
  type statementQuerySchema,
} from '@effinance/shared';
import type { z } from 'zod';
import type { Database, DbExecutor } from '../../db/client';
import { accounts, transactions, type AccountRow, type TransactionRow } from '../../db/schema';
import { getAccountWithBalance } from '../accounts/service';
import { accountMovements } from '../accounts/balances';
import { getAccountOrThrow } from '../common/ownership';
import { effectiveDateOf, loadRefMaps, toTransaction } from '../transactions/mapper';
import { ensureMaterialized } from '../transactions/series';
import { today } from '../../lib/clock';

type StatementQuery = z.output<typeof statementQuerySchema>;

/** Accounts that make up "saldo em contas": not investment, included in total, not archived. */
export async function cashAccounts(db: DbExecutor, userId: string): Promise<AccountRow[]> {
  return db
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.userId, userId),
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
export async function balanceAt(db: DbExecutor, userId: string, set: AccountRow[], date: string) {
  const sums = await accountMovements(db, userId, date);
  return set.reduce((acc, a) => acc + a.initialBalance + (sums.get(a.id)?.realized ?? 0), 0);
}

export async function getStatement(db: Database, userId: string, q: StatementQuery): Promise<StatementResponse> {
  await ensureMaterialized(db, userId, q.to);

  const set = q.accountId ? [await getAccountOrThrow(db, userId, q.accountId)] : await cashAccounts(db, userId);
  const ids = new Set(set.map((a) => a.id));
  const account = q.accountId ? await getAccountWithBalance(db, userId, q.accountId) : null;

  const openingBalance = set.length ? await balanceAt(db, userId, set, addDays(q.from, -1)) : 0;

  const rows =
    set.length === 0
      ? []
      : await db
          .select()
          .from(transactions)
          .where(
            and(
              eq(transactions.userId, userId),
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
    return {
      transaction: toTransaction(row, refs, now),
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
