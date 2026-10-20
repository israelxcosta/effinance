import { and, asc, eq, or } from 'drizzle-orm';
import { endOfMonth, type Account, type accountInputSchema } from '@effinance/shared';
import type { z } from 'zod';
import type { DbExecutor } from '../../db/client';
import { accounts, transactions, type AccountRow } from '../../db/schema';
import { today } from '../../lib/clock';
import { ConflictError } from '../../lib/errors';
import { getAccountOrThrow } from '../common/ownership';
import { ensureMaterialized } from '../transactions/series';
import { accountMovements, type AccountMovementSums } from './balances';

type AccountInput = z.output<typeof accountInputSchema>;

export function toAccount(row: AccountRow, sums?: AccountMovementSums): Account {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    bank: row.bank,
    color: row.color,
    icon: row.icon,
    initialBalance: row.initialBalance,
    includeInTotal: row.includeInTotal,
    archived: row.archived,
    createdAt: row.createdAt.toISOString(),
    balance: row.initialBalance + (sums?.realized ?? 0),
    projectedBalance: row.initialBalance + (sums?.projected ?? 0),
  };
}

/** Accounts with current and end-of-month projected balances. */
export async function listAccountsWithBalances(
  db: DbExecutor,
  workspaceId: string,
  includeArchived = false,
): Promise<Account[]> {
  const now = today();
  const rows = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.workspaceId, workspaceId), includeArchived ? undefined : eq(accounts.archived, false)))
    .orderBy(asc(accounts.archived), asc(accounts.createdAt));
  const sums = await accountMovements(db, workspaceId, now, endOfMonth(now));
  return rows.map((r) => toAccount(r, sums.get(r.id)));
}

export async function listAccounts(db: DbExecutor, workspaceId: string, includeArchived = false) {
  await ensureMaterialized(db, workspaceId);
  return listAccountsWithBalances(db, workspaceId, includeArchived);
}

export async function getAccountWithBalance(db: DbExecutor, workspaceId: string, id: string): Promise<Account> {
  const row = await getAccountOrThrow(db, workspaceId, id);
  const now = today();
  const sums = await accountMovements(db, workspaceId, now, endOfMonth(now));
  return toAccount(row, sums.get(row.id));
}

export async function createAccount(db: DbExecutor, workspaceId: string, input: AccountInput): Promise<Account> {
  const [row] = await db.insert(accounts).values({ workspaceId, ...input }).returning();
  return toAccount(row!);
}

export async function updateAccount(
  db: DbExecutor,
  workspaceId: string,
  id: string,
  input: AccountInput,
): Promise<Account> {
  await getAccountOrThrow(db, workspaceId, id);
  await db.update(accounts).set(input).where(eq(accounts.id, id));
  return getAccountWithBalance(db, workspaceId, id);
}

export async function deleteAccount(db: DbExecutor, workspaceId: string, id: string): Promise<void> {
  await getAccountOrThrow(db, workspaceId, id);
  const [used] = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(or(eq(transactions.accountId, id), eq(transactions.toAccountId, id)))
    .limit(1);
  if (used) {
    throw new ConflictError('Esta conta possui lançamentos. Arquive-a em vez de excluir.');
  }
  await db.delete(accounts).where(eq(accounts.id, id));
}
