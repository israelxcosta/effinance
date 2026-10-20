import { and, desc, eq, ilike, or } from 'drizzle-orm';
import { onlyDigits, type SearchResponse } from '@effinance/shared';
import type { Database } from '../../db/client';
import { accounts, categories, contacts, transactions } from '../../db/schema';
import { likePattern } from '../../lib/sql';
import { listAccountsWithBalances } from '../accounts/service';
import { toCategory } from '../categories/service';
import { toContact } from '../contacts/service';
import { toTransactions } from '../transactions/mapper';

export async function search(db: Database, userId: string, q: string): Promise<SearchResponse> {
  const pattern = likePattern(q);
  const digits = onlyDigits(q);
  const [txRows, accountRows, categoryRows, contactRows] = await Promise.all([
    db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.userId, userId),
          or(ilike(transactions.description, pattern), ilike(transactions.notes, pattern)),
        ),
      )
      .orderBy(desc(transactions.date))
      .limit(8),
    db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.userId, userId), ilike(accounts.name, pattern)))
      .limit(5),
    db
      .select()
      .from(categories)
      .where(and(eq(categories.userId, userId), ilike(categories.name, pattern)))
      .limit(5),
    db
      .select()
      .from(contacts)
      .where(
        and(
          eq(contacts.userId, userId),
          or(
            ilike(contacts.name, pattern),
            ilike(contacts.email, pattern),
            digits.length >= 3 ? ilike(contacts.document, likePattern(digits)) : undefined,
          ),
        ),
      )
      .limit(5),
  ]);

  const matchedAccounts = new Set(accountRows.map((a) => a.id));
  const allAccounts = matchedAccounts.size ? await listAccountsWithBalances(db, userId, true) : [];

  return {
    transactions: await toTransactions(db, txRows),
    accounts: allAccounts.filter((a) => matchedAccounts.has(a.id)),
    categories: categoryRows.map(toCategory),
    contacts: contactRows.map(toContact),
  };
}
