import { inArray } from 'drizzle-orm';
import {
  getInvoiceDates,
  type RefAccount,
  type RefCard,
  type RefCategory,
  type Transaction,
} from '@effinance/shared';
import type { DbExecutor } from '../../db/client';
import {
  accounts,
  categories,
  contacts,
  creditCards,
  type AccountRow,
  type CategoryRow,
  type CreditCardRow,
  type TransactionRow,
} from '../../db/schema';
import { today } from '../../lib/clock';
import { decryptNotes } from './notes';

export interface RefMaps {
  categories: Map<string, CategoryRow>;
  accounts: Map<string, AccountRow>;
  cards: Map<string, CreditCardRow>;
  contacts: Map<string, { id: string; name: string }>;
  /** Decrypted notes by transaction id. */
  notes: Map<string, string | null>;
}

function collect(rows: TransactionRow[], pick: (r: TransactionRow) => (string | null)[]): string[] {
  const set = new Set<string>();
  for (const r of rows) for (const v of pick(r)) if (v) set.add(v);
  return [...set];
}

/** Loads only the referenced entities (rows already belong to the workspace). */
export async function loadRefMaps(db: DbExecutor, rows: TransactionRow[]): Promise<RefMaps> {
  const categoryIds = collect(rows, (r) => [r.categoryId, r.subcategoryId]);
  const accountIds = collect(rows, (r) => [r.accountId, r.toAccountId]);
  const cardIds = collect(rows, (r) => [r.creditCardId]);
  const contactIds = collect(rows, (r) => [r.contactId]);

  const [cats, accs, cards, conts, notes] = await Promise.all([
    categoryIds.length ? db.select().from(categories).where(inArray(categories.id, categoryIds)) : [],
    accountIds.length ? db.select().from(accounts).where(inArray(accounts.id, accountIds)) : [],
    cardIds.length ? db.select().from(creditCards).where(inArray(creditCards.id, cardIds)) : [],
    contactIds.length
      ? db.select({ id: contacts.id, name: contacts.name }).from(contacts).where(inArray(contacts.id, contactIds))
      : [],
    Promise.all(rows.map(async (r) => [r.id, await decryptNotes(r.workspaceId, r.notes)] as const)),
  ]);

  return {
    categories: new Map(cats.map((c) => [c.id, c])),
    accounts: new Map(accs.map((a) => [a.id, a])),
    cards: new Map(cards.map((c) => [c.id, c])),
    contacts: new Map(conts.map((c) => [c.id, c])),
    notes: new Map(notes),
  };
}

function refCategory(row: CategoryRow | undefined): RefCategory | null {
  return row ? { id: row.id, name: row.name, icon: row.icon, color: row.color } : null;
}

function refAccount(row: AccountRow | undefined): RefAccount | null {
  return row ? { id: row.id, name: row.name, type: row.type, bank: row.bank, color: row.color } : null;
}

function refCard(row: CreditCardRow | undefined): RefCard | null {
  return row ? { id: row.id, name: row.name, bank: row.bank, brand: row.brand, color: row.color } : null;
}

export function effectiveDateOf(row: Pick<TransactionRow, 'paid' | 'paidAt' | 'date'>): string {
  return row.paid && row.paidAt ? row.paidAt : row.date;
}

/** Card purchases become overdue when their invoice is past due, not on the purchase date. */
function isOverdue(row: TransactionRow, refs: RefMaps, now: string): boolean {
  if (row.paid || row.type === 'transfer') return false;
  if (row.creditCardId) {
    const card = refs.cards.get(row.creditCardId);
    if (!card || !row.invoiceMonth) return false;
    return getInvoiceDates(row.invoiceMonth, card.closingDay, card.dueDay).dueDate < now;
  }
  return row.date < now;
}

export function toTransaction(row: TransactionRow, refs: RefMaps, now: string = today()): Transaction {
  const get = <T>(map: Map<string, T>, id: string | null) => (id ? map.get(id) : undefined);
  return {
    id: row.id,
    type: row.type,
    description: row.description,
    amount: row.amount,
    date: row.date,
    paid: row.paid,
    paidAt: row.paidAt,
    effectiveDate: effectiveDateOf(row),
    overdue: isOverdue(row, refs, now),
    accountId: row.accountId,
    toAccountId: row.toAccountId,
    creditCardId: row.creditCardId,
    invoiceMonth: row.invoiceMonth,
    categoryId: row.categoryId,
    subcategoryId: row.subcategoryId,
    contactId: row.contactId,
    paymentMethod: row.paymentMethod,
    notes: refs.notes.get(row.id) ?? null,
    transferKind: row.transferKind,
    recurrenceId: row.recurrenceId,
    recurrenceKind: row.recurrenceKind,
    frequency: row.frequency,
    installmentNumber: row.installmentNumber,
    installmentTotal: row.installmentTotal,
    occurrenceNumber: row.occurrenceIndex === null ? null : row.occurrenceIndex + 1,
    splitGroupId: row.splitGroupId,
    origin: row.origin,
    importBatchId: row.importBatchId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    category: refCategory(get(refs.categories, row.categoryId)),
    subcategory: refCategory(get(refs.categories, row.subcategoryId)),
    account: refAccount(get(refs.accounts, row.accountId)),
    toAccount: refAccount(get(refs.accounts, row.toAccountId)),
    creditCard: refCard(get(refs.cards, row.creditCardId)),
    contact: get(refs.contacts, row.contactId) ?? null,
  };
}

export async function toTransactions(db: DbExecutor, rows: TransactionRow[]): Promise<Transaction[]> {
  if (rows.length === 0) return [];
  const refs = await loadRefMaps(db, rows);
  const now = today();
  return rows.map((r) => toTransaction(r, refs, now));
}
