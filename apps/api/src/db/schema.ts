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
  primaryKey,
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
  MemberRole,
  PaymentMethod,
  PlanCode,
  RecurrenceKind,
  SubscriptionStatus,
  TransactionType,
  TransferKind,
  WorkspaceKind,
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
const timestamptz = () => timestamp({ withTimezone: true });
const userRef = () =>
  uuid()
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' });
/** Tenant column of every financial table (protected by Row Level Security). */
const workspaceRef = () => uuid().references(() => workspaces.id, { onDelete: 'cascade' });

// ---------------------------------------------------------------------------
// Identity, tenancy and billing (not tenant-scoped: never touched inside a tenant transaction)
// ---------------------------------------------------------------------------

export const users = pgTable('users', {
  id: id(),
  name: text().notNull(),
  email: text().notNull().unique(),
  passwordHash: text().notNull(),
  /** TOTP secret encrypted with the master key (`KeyProvider.encryptSecret`). Set on setup. */
  mfaSecretEnc: text(),
  mfaEnabled: boolean().notNull().default(false),
  /** SHA-256 hashes of the unused recovery codes. */
  mfaRecoveryCodes: jsonb().$type<string[]>(),
  /** Last accepted TOTP time step (a code is never accepted twice). */
  mfaLastStep: integer(),
  lastWorkspaceId: uuid().references((): AnyPgColumn => workspaces.id, { onDelete: 'set null' }),
  acceptedTermsAt: timestamptz(),
  passwordChangedAt: timestamptz(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const workspaces = pgTable(
  'workspaces',
  {
    id: id(),
    name: text().notNull(),
    kind: text().$type<WorkspaceKind>().notNull(),
    /** Data key (AES-256) wrapped by the key provider; deleting it crypto-shreds the workspace. */
    wrappedKey: text(),
    keyId: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check('workspaces_kind_chk', sql`${t.kind} in ('personal', 'family', 'business')`)],
);

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: userRef(),
    role: text().$type<MemberRole>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.userId] }),
    index('workspace_members_user_idx').on(t.userId),
    check('workspace_members_role_chk', sql`${t.role} in ('owner', 'editor', 'viewer')`),
  ],
);

export const workspaceInvites = pgTable(
  'workspace_invites',
  {
    id: id(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    email: text().notNull(),
    role: text().$type<Exclude<MemberRole, 'owner'>>().notNull(),
    /** SHA-256 of the token sent by e-mail (the token itself is never stored). */
    tokenHash: text().notNull().unique(),
    invitedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    expiresAt: timestamptz().notNull(),
    acceptedAt: timestamptz(),
  },
  (t) => [index('workspace_invites_workspace_idx').on(t.workspaceId)],
);

export const subscriptions = pgTable('subscriptions', {
  workspaceId: uuid()
    .primaryKey()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  planCode: text().$type<PlanCode>(),
  status: text().$type<SubscriptionStatus>().notNull(),
  provider: text().$type<'mercadopago' | 'fake'>(),
  providerSubscriptionId: text().unique(),
  trialEndsAt: timestamptz(),
  currentPeriodEnd: timestamptz(),
  pastDueSince: timestamptz(),
  cancelAtPeriodEnd: boolean().notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Webhook notifications already received (idempotency). */
export const billingEvents = pgTable(
  'billing_events',
  {
    id: id(),
    provider: text().notNull(),
    eventId: text().notNull(),
    type: text().notNull(),
    payload: jsonb().notNull(),
    processedAt: timestamptz(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('billing_events_provider_event_uq').on(t.provider, t.eventId)],
);

/**
 * One row per refresh token. Rotation marks the row `rotatedAt` and inserts the next one in the same
 * family; presenting a rotated token again revokes the whole family (reuse detection).
 */
export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    familyId: uuid().notNull(),
    userId: userRef(),
    /** Active workspace of this session (claim `wid` of the access tokens it issues). */
    workspaceId: uuid().references(() => workspaces.id, { onDelete: 'set null' }),
    tokenHash: text().notNull().unique(),
    userAgent: text(),
    /** Masked (last octet / last groups removed). */
    ip: text(),
    sessionStartedAt: timestamptz().notNull(),
    lastUsedAt: timestamptz().notNull().defaultNow(),
    expiresAt: timestamptz().notNull(),
    rotatedAt: timestamptz(),
    revokedAt: timestamptz(),
    createdAt: createdAt(),
  },
  (t) => [index('sessions_user_idx').on(t.userId), index('sessions_family_idx').on(t.familyId)],
);

export const passwordResets = pgTable(
  'password_resets',
  {
    id: id(),
    userId: userRef(),
    tokenHash: text().notNull().unique(),
    createdAt: createdAt(),
    expiresAt: timestamptz().notNull(),
    usedAt: timestamptz(),
  },
  (t) => [index('password_resets_user_idx').on(t.userId)],
);

/** Security/billing/membership events. No personal data beyond the masked IP. */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    workspaceId: uuid().references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid().references(() => users.id, { onDelete: 'set null' }),
    action: text().notNull(),
    entity: text(),
    entityId: text(),
    ip: text(),
    userAgent: text(),
    metadata: jsonb().$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_logs_workspace_idx').on(t.workspaceId, t.createdAt),
    index('audit_logs_user_idx').on(t.userId, t.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// Financial data — every table carries `workspace_id` and is protected by RLS
// ---------------------------------------------------------------------------

export const categories = pgTable(
  'categories',
  {
    id: id(),
    workspaceId: workspaceRef().notNull(),
    parentId: uuid().references((): AnyPgColumn => categories.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    type: text().$type<CategoryType>().notNull(),
    icon: text().$type<IconName>().notNull(),
    color: text().notNull(),
    archived: boolean().notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index('categories_workspace_idx').on(t.workspaceId, t.type),
    check('categories_type_chk', sql`${t.type} in ('income', 'expense')`),
  ],
);

export const accounts = pgTable(
  'accounts',
  {
    id: id(),
    workspaceId: workspaceRef().notNull(),
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
  (t) => [index('accounts_workspace_idx').on(t.workspaceId)],
);

export const creditCards = pgTable(
  'credit_cards',
  {
    id: id(),
    workspaceId: workspaceRef().notNull(),
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
    index('credit_cards_workspace_idx').on(t.workspaceId),
    check('credit_cards_days_chk', sql`${t.closingDay} between 1 and 31 and ${t.dueDay} between 1 and 31`),
  ],
);

export const goals = pgTable(
  'goals',
  {
    id: id(),
    workspaceId: workspaceRef().notNull(),
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
  (t) => [index('goals_workspace_idx').on(t.workspaceId)],
);

export const goalContributions = pgTable(
  'goal_contributions',
  {
    id: id(),
    workspaceId: workspaceRef().notNull(),
    goalId: uuid()
      .notNull()
      .references(() => goals.id, { onDelete: 'cascade' }),
    amount: money().notNull(),
    date: calendarDate().notNull(),
    note: text(),
    createdAt: createdAt(),
  },
  (t) => [
    index('goal_contributions_goal_idx').on(t.goalId),
    index('goal_contributions_workspace_idx').on(t.workspaceId),
  ],
);

export const contacts = pgTable(
  'contacts',
  {
    id: id(),
    workspaceId: workspaceRef().notNull(),
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
    /** HMAC (per-workspace key) of the CPF/CNPJ digits: exact search over the encrypted document. */
    documentHash: text(),
    createdAt: createdAt(),
  },
  (t) => [
    index('contacts_workspace_idx').on(t.workspaceId, t.name),
    index('contacts_document_hash_idx').on(t.workspaceId, t.documentHash),
  ],
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
    workspaceId: workspaceRef().notNull(),
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
  (t) => [
    index('recurrences_workspace_pending_idx').on(t.workspaceId, t.nextDate),
  ],
);

export const transactions = pgTable(
  'transactions',
  {
    id: id(),
    workspaceId: workspaceRef().notNull(),
    type: text().$type<TransactionType>().notNull(),
    description: text().notNull(),
    amount: money().notNull(),
    date: calendarDate().notNull(),
    paid: boolean().notNull().default(false),
    paidAt: calendarDate(),
    accountId: uuid().references(() => accounts.id, { onDelete: 'no action' }),
    toAccountId: uuid().references(() => accounts.id, { onDelete: 'no action' }),
    creditCardId: uuid().references(() => creditCards.id, { onDelete: 'no action' }),
    invoiceMonth: text(),
    categoryId: uuid().references(() => categories.id, { onDelete: 'no action' }),
    subcategoryId: uuid().references(() => categories.id, { onDelete: 'no action' }),
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
    index('transactions_workspace_date_idx').on(t.workspaceId, t.date),
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
