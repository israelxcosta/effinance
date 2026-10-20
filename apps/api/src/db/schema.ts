import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import type {
  AccountType,
  BankCode,
  CardBrand,
  CategoryType,
  Frequency,
  IconName,
  PaymentMethod,
  RecurrenceKind,
  TransactionType,
  TransferKind,
} from '@effinance/shared';

const id = () => uuid().primaryKey().defaultRandom();
const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const money = () => bigint({ mode: 'number' });
const calendarDate = () => date({ mode: 'string' });
const userRef = () =>
  uuid()
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' });

export const users = pgTable('users', {
  id: id(),
  name: text().notNull(),
  email: text().notNull().unique(),
  passwordHash: text().notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const categories = pgTable(
  'categories',
  {
    id: id(),
    userId: userRef(),
    parentId: uuid().references((): AnyPgColumn => categories.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    type: text().$type<CategoryType>().notNull(),
    icon: text().$type<IconName>().notNull(),
    color: text().notNull(),
    archived: boolean().notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index('categories_user_idx').on(t.userId, t.type),
    check('categories_type_chk', sql`${t.type} in ('income', 'expense')`),
  ],
);

export const accounts = pgTable(
  'accounts',
  {
    id: id(),
    userId: userRef(),
    name: text().notNull(),
    type: text().$type<AccountType>().notNull(),
    bank: text().$type<BankCode>(),
    color: text().notNull(),
    icon: text().$type<IconName>().notNull(),
    initialBalance: money().notNull().default(0),
    includeInTotal: boolean().notNull().default(true),
    archived: boolean().notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index('accounts_user_idx').on(t.userId)],
);

export const creditCards = pgTable(
  'credit_cards',
  {
    id: id(),
    userId: userRef(),
    name: text().notNull(),
    bank: text().$type<BankCode>().notNull(),
    brand: text().$type<CardBrand>().notNull(),
    limit: money().notNull(),
    closingDay: integer().notNull(),
    dueDay: integer().notNull(),
    color: text().notNull(),
    defaultAccountId: uuid().references(() => accounts.id, { onDelete: 'set null' }),
    archived: boolean().notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index('credit_cards_user_idx').on(t.userId),
    check('credit_cards_days_chk', sql`${t.closingDay} between 1 and 31 and ${t.dueDay} between 1 and 31`),
  ],
);

export const goals = pgTable(
  'goals',
  {
    id: id(),
    userId: userRef(),
    name: text().notNull(),
    targetAmount: money().notNull(),
    deadline: calendarDate(),
    icon: text().$type<IconName>().notNull(),
    color: text().notNull(),
    accountId: uuid().references(() => accounts.id, { onDelete: 'set null' }),
    notes: text(),
    archived: boolean().notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index('goals_user_idx').on(t.userId)],
);

export const goalContributions = pgTable(
  'goal_contributions',
  {
    id: id(),
    userId: userRef(),
    goalId: uuid()
      .notNull()
      .references(() => goals.id, { onDelete: 'cascade' }),
    amount: money().notNull(),
    date: calendarDate().notNull(),
    note: text(),
    createdAt: createdAt(),
  },
  (t) => [index('goal_contributions_goal_idx').on(t.goalId)],
);

export const contacts = pgTable(
  'contacts',
  {
    id: id(),
    userId: userRef(),
    name: text().notNull(),
    document: text(),
    email: text(),
    phone: text(),
    zipCode: text(),
    street: text(),
    number: text(),
    complement: text(),
    district: text(),
    city: text(),
    state: text(),
    notes: text(),
    createdAt: createdAt(),
  },
  (t) => [index('contacts_user_idx').on(t.userId, t.name)],
);

/** Values copied into every occurrence generated from a series. */
export interface RecurrenceTemplate {
  type: 'income' | 'expense';
  description: string;
  amount: number;
  accountId: string | null;
  creditCardId: string | null;
  categoryId: string | null;
  subcategoryId: string | null;
  contactId: string | null;
  paymentMethod: PaymentMethod | null;
  notes: string | null;
  /** Set when the series was created as one part of a category split. */
  splitGroupId?: string | null;
}

/**
 * A series of transactions. Finite series (installments, recurring with a count) are fully
 * generated on creation. Open-ended series (fixed, recurring without count) keep `nextIndex` /
 * `nextDate` and are materialized on demand up to the period being read.
 */
export const recurrences = pgTable(
  'recurrences',
  {
    id: id(),
    userId: userRef(),
    kind: text().$type<Exclude<RecurrenceKind, 'single'>>().notNull(),
    frequency: text().$type<Frequency>().notNull(),
    startDate: calendarDate().notNull(),
    /** null = open-ended. */
    totalOccurrences: integer(),
    /** Index (0-based) of the next occurrence to materialize. */
    nextIndex: integer().notNull().default(0),
    /** Date of the next occurrence to materialize; null when the series is complete/ended. */
    nextDate: calendarDate(),
    template: jsonb().$type<RecurrenceTemplate>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('recurrences_pending_idx').on(t.userId, t.nextDate)],
);

export const transactions = pgTable(
  'transactions',
  {
    id: id(),
    userId: userRef(),
    type: text().$type<TransactionType>().notNull(),
    description: text().notNull(),
    amount: money().notNull(),
    date: calendarDate().notNull(),
    paid: boolean().notNull().default(false),
    paidAt: calendarDate(),
    accountId: uuid().references(() => accounts.id, { onDelete: 'restrict' }),
    toAccountId: uuid().references(() => accounts.id, { onDelete: 'restrict' }),
    creditCardId: uuid().references(() => creditCards.id, { onDelete: 'restrict' }),
    invoiceMonth: text(),
    categoryId: uuid().references(() => categories.id, { onDelete: 'restrict' }),
    subcategoryId: uuid().references(() => categories.id, { onDelete: 'restrict' }),
    contactId: uuid().references(() => contacts.id, { onDelete: 'set null' }),
    paymentMethod: text().$type<PaymentMethod>(),
    notes: text(),
    transferKind: text().$type<TransferKind>(),
    recurrenceId: uuid().references(() => recurrences.id, { onDelete: 'set null' }),
    recurrenceKind: text().$type<RecurrenceKind>().notNull().default('single'),
    frequency: text().$type<Frequency>(),
    installmentNumber: integer(),
    installmentTotal: integer(),
    /** 0-based position inside the series. */
    occurrenceIndex: integer(),
    /** Parts of an amount divided across categories share this id. */
    splitGroupId: uuid(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('transactions_user_date_idx').on(t.userId, t.date),
    index('transactions_account_idx').on(t.accountId),
    index('transactions_to_account_idx').on(t.toAccountId),
    index('transactions_card_invoice_idx').on(t.creditCardId, t.invoiceMonth),
    index('transactions_contact_idx').on(t.contactId),
    index('transactions_category_idx').on(t.categoryId),
    index('transactions_split_group_idx').on(t.splitGroupId),
    uniqueIndex('transactions_series_occurrence_uq').on(t.recurrenceId, t.occurrenceIndex),
    check('transactions_type_chk', sql`${t.type} in ('income', 'expense', 'transfer')`),
    check('transactions_amount_chk', sql`${t.amount} > 0`),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type CategoryRow = typeof categories.$inferSelect;
export type AccountRow = typeof accounts.$inferSelect;
export type CreditCardRow = typeof creditCards.$inferSelect;
export type GoalRow = typeof goals.$inferSelect;
export type GoalContributionRow = typeof goalContributions.$inferSelect;
export type ContactRow = typeof contacts.$inferSelect;
export type RecurrenceRow = typeof recurrences.$inferSelect;
export type TransactionRow = typeof transactions.$inferSelect;
export type NewTransactionRow = typeof transactions.$inferInsert;
