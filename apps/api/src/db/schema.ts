import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import type {
  AccountType,
  BankAccountKind,
  BankCode,
  BankConnectionStatus,
  CardBrand,
  CategoryType,
  Frequency,
  IconName,
  ImportFormat,
  MemberRole,
  OpenFinanceProvider,
  PaymentMethod,
  PlanCode,
  RecurrenceKind,
  SubscriptionStatus,
  TransactionOrigin,
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

// Tenant integrity (migration 0004): references between financial tables are composite foreign keys
// `(workspace_id, x_id) → parent(workspace_id, id)`, so a row can only point to a row of its own
// workspace. Foreign-key checks bypass RLS; a plain `x_id → parent(id)` would accept (and reveal) ids
// of other tenants. Every parent therefore has `unique (workspace_id, id)`.
// `onDelete('set null')` below is `ON DELETE SET NULL (x_id)` in the SQL (PostgreSQL 15+): only the
// reference is cleared, never `workspace_id`. drizzle-kit cannot express the column list — do not
// recreate these constraints with `drizzle-kit push`.
const tenantUnique = (table: string, t: { workspaceId: AnyPgColumn; id: AnyPgColumn }) =>
  unique(`${table}_workspace_id_id_uq`).on(t.workspaceId, t.id);

// ---------------------------------------------------------------------------
// Identity, tenancy and billing (not tenant-scoped: never touched inside a tenant transaction)
// ---------------------------------------------------------------------------

export const users = pgTable(
  'users',
  {
    id: id(),
    name: text().notNull(),
    email: text().notNull().unique(),
    passwordHash: text().notNull(),
    /** TOTP secret encrypted with the master key (`KeyProvider.encryptSecret`). Set on setup. */
    mfaSecretEnc: text(),
    mfaEnabled: boolean().notNull().default(false),
    /** Salted PBKDF2 hashes of the unused recovery codes (`modules/auth/mfa.ts`; legacy rows: SHA-256). */
    mfaRecoveryCodes: jsonb().$type<string[]>(),
    /** Last accepted TOTP time step (a code is never accepted twice). */
    mfaLastStep: integer(),
    lastWorkspaceId: uuid().references((): AnyPgColumn => workspaces.id, { onDelete: 'set null' }),
    acceptedTermsAt: timestamptz(),
    passwordChangedAt: timestamptz(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  // Deleting a workspace clears this reference: without the index that is a scan of every user.
  (t) => [index('users_last_workspace_idx').on(t.lastWorkspaceId)],
);

export const workspaces = pgTable(
  'workspaces',
  {
    id: id(),
    name: text().notNull(),
    kind: text().$type<WorkspaceKind>().notNull(),
    /** Data key (AES-256) wrapped by the key provider; deleting it crypto-shreds the workspace. */
    wrappedKey: text(),
    keyId: text(),
    /**
     * When the encryption backfill last confirmed that no sensitive field of this workspace is in
     * plain text. New workspaces are born encrypted (default now()); rows that existed before
     * migration 0004 start null, so `db:migrate` re-checks them even if their key already exists.
     */
    encryptionBackfilledAt: timestamptz().defaultNow(),
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
    // Exactly one owner: owner-only actions (billing, deletion, members) and account deletion
    // ("workspaces where I am the owner") rely on it.
    uniqueIndex('workspace_members_single_owner_uq').on(t.workspaceId).where(sql`${t.role} = 'owner'`),
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
  (t) => [
    index('workspace_invites_workspace_idx').on(t.workspaceId),
    // Account deletion removes the invites addressed to the user's e-mail (LGPD).
    index('workspace_invites_email_idx').on(sql`lower(${t.email})`),
    index('workspace_invites_invited_by_idx').on(t.invitedBy),
    // At most one pending invite per e-mail and workspace ("a new invite replaces the pending one").
    uniqueIndex('workspace_invites_pending_email_uq')
      .on(t.workspaceId, sql`lower(${t.email})`)
      .where(sql`${t.acceptedAt} is null`),
    check('workspace_invites_role_chk', sql`${t.role} in ('editor', 'viewer')`),
  ],
);

export const subscriptions = pgTable(
  'subscriptions',
  {
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
  },
  (t) => [
    check(
      'subscriptions_status_chk',
      sql`${t.status} in ('trialing', 'pending', 'active', 'past_due', 'canceled', 'expired')`,
    ),
    check(
      'subscriptions_plan_code_chk',
      sql`${t.planCode} in ('individual_monthly', 'individual_yearly', 'family_monthly', 'business_monthly')`,
    ),
    check('subscriptions_provider_chk', sql`${t.provider} in ('mercadopago', 'fake')`),
  ],
);

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
  (t) => [
    index('sessions_user_idx').on(t.userId),
    index('sessions_family_idx').on(t.familyId),
    // Deleting a workspace clears `workspace_id` here; one row per refresh makes this table big.
    index('sessions_workspace_idx').on(t.workspaceId),
    // Retention purge (`db/retention.ts`).
    index('sessions_expires_idx').on(t.expiresAt),
  ],
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
    parentId: uuid(),
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
    tenantUnique('categories', t),
    foreignKey({
      name: 'categories_parent_fk',
      columns: [t.workspaceId, t.parentId],
      foreignColumns: [t.workspaceId, t.id],
    }).onDelete('cascade'),
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
  (t) => [
    index('accounts_workspace_idx').on(t.workspaceId),
    tenantUnique('accounts', t),
    check(
      'accounts_type_chk',
      sql`${t.type} in ('checking', 'savings', 'wallet', 'benefit', 'investment', 'other')`,
    ),
  ],
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
    defaultAccountId: uuid(),
    archived: boolean().notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index('credit_cards_workspace_idx').on(t.workspaceId),
    check('credit_cards_days_chk', sql`${t.closingDay} between 1 and 31 and ${t.dueDay} between 1 and 31`),
    check('credit_cards_limit_chk', sql`${t.limit} >= 0`),
    check(
      'credit_cards_brand_chk',
      sql`${t.brand} in ('visa', 'mastercard', 'elo', 'amex', 'hipercard', 'diners', 'other')`,
    ),
    tenantUnique('credit_cards', t),
    foreignKey({
      name: 'credit_cards_default_account_fk',
      columns: [t.workspaceId, t.defaultAccountId],
      foreignColumns: [accounts.workspaceId, accounts.id],
    }).onDelete('set null'),
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
    accountId: uuid(),
    notes: text(),
    archived: boolean().notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index('goals_workspace_idx').on(t.workspaceId),
    check('goals_target_amount_chk', sql`${t.targetAmount} > 0`),
    tenantUnique('goals', t),
    foreignKey({
      name: 'goals_account_fk',
      columns: [t.workspaceId, t.accountId],
      foreignColumns: [accounts.workspaceId, accounts.id],
    }).onDelete('set null'),
  ],
);

export const goalContributions = pgTable(
  'goal_contributions',
  {
    id: id(),
    workspaceId: workspaceRef().notNull(),
    goalId: uuid().notNull(),
    /** Negative = withdrawal; never zero. */
    amount: money().notNull(),
    date: calendarDate().notNull(),
    note: text(),
    createdAt: createdAt(),
  },
  (t) => [
    index('goal_contributions_goal_idx').on(t.goalId),
    index('goal_contributions_workspace_idx').on(t.workspaceId),
    check('goal_contributions_amount_chk', sql`${t.amount} <> 0`),
    foreignKey({
      name: 'goal_contributions_goal_fk',
      columns: [t.workspaceId, t.goalId],
      foreignColumns: [goals.workspaceId, goals.id],
    }).onDelete('cascade'),
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
    tenantUnique('contacts', t),
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
    tenantUnique('recurrences', t),
    check('recurrences_kind_chk', sql`${t.kind} in ('installment', 'recurring', 'fixed')`),
    check('recurrences_frequency_chk', sql`${t.frequency} in ('weekly', 'monthly', 'semiannual', 'annual')`),
    check(
      'recurrences_counters_chk',
      sql`${t.nextIndex} >= 0 and (${t.totalOccurrences} is null or ${t.totalOccurrences} > 0)`,
    ),
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
    accountId: uuid(),
    toAccountId: uuid(),
    creditCardId: uuid(),
    invoiceMonth: text(),
    categoryId: uuid(),
    subcategoryId: uuid(),
    contactId: uuid(),
    paymentMethod: text().$type<PaymentMethod>(),
    notes: text(),
    transferKind: text().$type<TransferKind>(),
    recurrenceId: uuid(),
    recurrenceKind: text().$type<RecurrenceKind>().notNull().default('single'),
    frequency: text().$type<Frequency>(),
    installmentNumber: integer(),
    installmentTotal: integer(),
    /** 0-based position inside the series. */
    occurrenceIndex: integer(),
    /** Parts of an amount divided across categories share this id. */
    splitGroupId: uuid(),
    /** manual | file (OFX/CSV import) | open_finance (bank connection sync). */
    origin: text().$type<TransactionOrigin>().notNull().default('manual'),
    /** Import batch that created the row (undo removes what is left of it). */
    importBatchId: uuid(),
    /**
     * Identity of an imported row in its source: OFX FITID, provider transaction id or a content
     * hash. Unique per account/card, so re-importing never duplicates a transaction.
     */
    externalId: text(),
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
    // Deleting a category checks this reference: without the index, a scan of every tenant's rows.
    index('transactions_subcategory_idx').on(t.subcategoryId).where(sql`${t.subcategoryId} is not null`),
    check('transactions_type_chk', sql`${t.type} in ('income', 'expense', 'transfer')`),
    check('transactions_amount_chk', sql`${t.amount} > 0`),
    check(
      'transactions_recurrence_kind_chk',
      sql`${t.recurrenceKind} in ('single', 'installment', 'recurring', 'fixed')`,
    ),
    check('transactions_frequency_chk', sql`${t.frequency} in ('weekly', 'monthly', 'semiannual', 'annual')`),
    check(
      'transactions_payment_method_chk',
      sql`${t.paymentMethod} in ('pix', 'cash', 'debit_card', 'credit_card', 'bank_slip', 'transfer', 'auto_debit', 'other')`,
    ),
    check(
      'transactions_transfer_kind_chk',
      sql`${t.transferKind} in ('transfer', 'investment', 'redemption', 'card_payment')`,
    ),
    check('transactions_invoice_month_chk', sql`${t.invoiceMonth} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    check(
      'transactions_installments_chk',
      sql`(${t.installmentNumber} is null or ${t.installmentNumber} > 0) and (${t.installmentTotal} is null or ${t.installmentTotal} > 0) and (${t.occurrenceIndex} is null or ${t.occurrenceIndex} >= 0)`,
    ),
    foreignKey({
      name: 'transactions_account_fk',
      columns: [t.workspaceId, t.accountId],
      foreignColumns: [accounts.workspaceId, accounts.id],
    }),
    foreignKey({
      name: 'transactions_to_account_fk',
      columns: [t.workspaceId, t.toAccountId],
      foreignColumns: [accounts.workspaceId, accounts.id],
    }),
    foreignKey({
      name: 'transactions_credit_card_fk',
      columns: [t.workspaceId, t.creditCardId],
      foreignColumns: [creditCards.workspaceId, creditCards.id],
    }),
    foreignKey({
      name: 'transactions_category_fk',
      columns: [t.workspaceId, t.categoryId],
      foreignColumns: [categories.workspaceId, categories.id],
    }),
    foreignKey({
      name: 'transactions_subcategory_fk',
      columns: [t.workspaceId, t.subcategoryId],
      foreignColumns: [categories.workspaceId, categories.id],
    }),
    foreignKey({
      name: 'transactions_contact_fk',
      columns: [t.workspaceId, t.contactId],
      foreignColumns: [contacts.workspaceId, contacts.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'transactions_recurrence_fk',
      columns: [t.workspaceId, t.recurrenceId],
      foreignColumns: [recurrences.workspaceId, recurrences.id],
    }).onDelete('set null'),
    // Migration 0005: imports.
    check('transactions_origin_chk', sql`${t.origin} in ('manual', 'file', 'open_finance')`),
    check('transactions_external_id_chk', sql`${t.externalId} is null or length(${t.externalId}) between 1 and 200`),
    // Batch and external id only exist on imported rows.
    check(
      'transactions_import_chk',
      sql`${t.origin} <> 'manual' or (${t.importBatchId} is null and ${t.externalId} is null)`,
    ),
    foreignKey({
      name: 'transactions_import_batch_fk',
      columns: [t.workspaceId, t.importBatchId],
      foreignColumns: [importBatches.workspaceId, importBatches.id],
    }).onDelete('set null'),
    index('transactions_import_batch_idx').on(t.importBatchId).where(sql`${t.importBatchId} is not null`),
    uniqueIndex('transactions_account_external_uq')
      .on(t.workspaceId, t.accountId, t.externalId)
      .where(sql`${t.externalId} is not null`),
    uniqueIndex('transactions_card_external_uq')
      .on(t.workspaceId, t.creditCardId, t.externalId)
      .where(sql`${t.externalId} is not null`),
  ],
);

// ---------------------------------------------------------------------------
// Imports and Open Finance (migration 0005)
// ---------------------------------------------------------------------------

/** One import: a file (OFX/CSV) or one Open Finance sync of one linked account. */
export const importBatches = pgTable(
  'import_batches',
  {
    id: id(),
    workspaceId: workspaceRef().notNull(),
    origin: text().$type<Exclude<TransactionOrigin, 'manual'>>().notNull(),
    format: text().$type<ImportFormat>(),
    fileName: text(),
    connectionId: uuid(),
    accountId: uuid(),
    creditCardId: uuid(),
    invoiceMonth: text(),
    createdCount: integer().notNull().default(0),
    skippedCount: integer().notNull().default(0),
    /** Member who imported (null for webhook-driven syncs and deleted users). */
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('import_batches_workspace_idx').on(t.workspaceId, t.createdAt),
    index('import_batches_created_by_idx').on(t.createdBy).where(sql`${t.createdBy} is not null`),
    tenantUnique('import_batches', t),
    check('import_batches_origin_chk', sql`${t.origin} in ('file', 'open_finance')`),
    check('import_batches_format_chk', sql`${t.format} in ('ofx', 'csv')`),
    check('import_batches_file_chk', sql`${t.origin} <> 'file' or (${t.format} is not null and ${t.fileName} is not null)`),
    check('import_batches_counts_chk', sql`${t.createdCount} >= 0 and ${t.skippedCount} >= 0`),
    check('import_batches_target_chk', sql`${t.accountId} is null or ${t.creditCardId} is null`),
    check('import_batches_invoice_month_chk', sql`${t.invoiceMonth} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    foreignKey({
      name: 'import_batches_connection_fk',
      columns: [t.workspaceId, t.connectionId],
      foreignColumns: [bankConnections.workspaceId, bankConnections.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'import_batches_account_fk',
      columns: [t.workspaceId, t.accountId],
      foreignColumns: [accounts.workspaceId, accounts.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'import_batches_credit_card_fk',
      columns: [t.workspaceId, t.creditCardId],
      foreignColumns: [creditCards.workspaceId, creditCards.id],
    }).onDelete('set null'),
  ],
);

/**
 * A read-only bank connection (aggregator "item"). The provider's item id is a bearer reference
 * to the user's bank data at the aggregator: stored encrypted with the workspace key, plus a
 * blind index for lookups.
 */
export const bankConnections = pgTable(
  'bank_connections',
  {
    id: id(),
    workspaceId: workspaceRef().notNull(),
    provider: text().$type<OpenFinanceProvider>().notNull(),
    /** FieldCipher (`bank_connections.provider_item_id`). */
    providerItemId: text().notNull(),
    /** Blind index (HMAC, workspace key) of the provider item id. */
    providerItemHash: text().notNull(),
    institutionName: text().notNull(),
    /** https only (rendered by the web as an image). */
    institutionImageUrl: text(),
    institutionBank: text().$type<BankCode>(),
    status: text().$type<BankConnectionStatus>().notNull(),
    statusDetail: text(),
    consentExpiresAt: timestamptz(),
    lastSyncAt: timestamptz(),
    createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    tenantUnique('bank_connections', t),
    uniqueIndex('bank_connections_item_uq').on(t.workspaceId, t.provider, t.providerItemHash),
    index('bank_connections_created_by_idx').on(t.createdBy).where(sql`${t.createdBy} is not null`),
    check('bank_connections_provider_chk', sql`${t.provider} in ('pluggy', 'fake')`),
    check(
      'bank_connections_status_chk',
      sql`${t.status} in ('syncing', 'active', 'login_error', 'waiting_user_input', 'outdated', 'error')`,
    ),
    check('bank_connections_image_url_chk', sql`${t.institutionImageUrl} is null or ${t.institutionImageUrl} ~ '^https://'`),
  ],
);

/** Accounts/cards of a connection, and the local account/card each one feeds. */
export const bankConnectionAccounts = pgTable(
  'bank_connection_accounts',
  {
    id: id(),
    workspaceId: workspaceRef().notNull(),
    connectionId: uuid().notNull(),
    /** FieldCipher (`bank_connection_accounts.provider_account_id`). */
    providerAccountId: text().notNull(),
    providerAccountHash: text().notNull(),
    kind: text().$type<BankAccountKind>().notNull(),
    /** Local account type suggested for 'new' links (bank accounts). */
    accountType: text().$type<'checking' | 'savings'>(),
    name: text().notNull(),
    /** Masked (last digits only). */
    number: text(),
    balance: money(),
    creditLimit: money(),
    cardBrand: text().$type<CardBrand>(),
    closingDay: integer(),
    dueDay: integer(),
    linkedAccountId: uuid(),
    linkedCreditCardId: uuid(),
    syncFrom: calendarDate(),
    lastSyncAt: timestamptz(),
    /** Latest posted transaction date seen (the next sync re-reads a week before it). */
    cursor: text(),
    /** Created by a 'new' link: the first sync sets the initial balance to match the bank. */
    adjustInitialBalance: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    tenantUnique('bank_connection_accounts', t),
    index('bank_connection_accounts_connection_idx').on(t.connectionId),
    uniqueIndex('bank_connection_accounts_provider_uq').on(t.workspaceId, t.connectionId, t.providerAccountHash),
    // One feed per local account/card (two feeds would import the same movements twice).
    uniqueIndex('bank_connection_accounts_linked_account_uq')
      .on(t.workspaceId, t.linkedAccountId)
      .where(sql`${t.linkedAccountId} is not null`),
    uniqueIndex('bank_connection_accounts_linked_card_uq')
      .on(t.workspaceId, t.linkedCreditCardId)
      .where(sql`${t.linkedCreditCardId} is not null`),
    check('bank_connection_accounts_kind_chk', sql`${t.kind} in ('bank', 'credit_card')`),
    check('bank_connection_accounts_account_type_chk', sql`${t.accountType} in ('checking', 'savings')`),
    check(
      'bank_connection_accounts_card_brand_chk',
      sql`${t.cardBrand} in ('visa', 'mastercard', 'elo', 'amex', 'hipercard', 'diners', 'other')`,
    ),
    check(
      'bank_connection_accounts_days_chk',
      sql`(${t.closingDay} is null or ${t.closingDay} between 1 and 31) and (${t.dueDay} is null or ${t.dueDay} between 1 and 31)`,
    ),
    check(
      'bank_connection_accounts_link_chk',
      sql`(${t.kind} = 'bank' or ${t.linkedAccountId} is null) and (${t.kind} = 'credit_card' or ${t.linkedCreditCardId} is null)`,
    ),
    foreignKey({
      name: 'bank_connection_accounts_connection_fk',
      columns: [t.workspaceId, t.connectionId],
      foreignColumns: [bankConnections.workspaceId, bankConnections.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'bank_connection_accounts_account_fk',
      columns: [t.workspaceId, t.linkedAccountId],
      foreignColumns: [accounts.workspaceId, accounts.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'bank_connection_accounts_credit_card_fk',
      columns: [t.workspaceId, t.linkedCreditCardId],
      foreignColumns: [creditCards.workspaceId, creditCards.id],
    }).onDelete('set null'),
  ],
);

// Global (no RLS) tables used without a workspace context: Open Finance webhooks arrive with only
// the provider's item id. They hold no personal data.

/** Platform-wide secrets (random keys wrapped by the key provider: KMS in production). */
export const platformKeys = pgTable(
  'platform_keys',
  {
    name: text().primaryKey(),
    /** `KeyProvider.encryptSecret` output. */
    wrappedKey: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [check('platform_keys_name_chk', sql`${t.name} ~ '^[a-z0-9_.:-]{1,64}$'`)],
);

/**
 * Webhook routing: HMAC (platform key) of `provider:itemId` → workspace and connection. Rows go away
 * with the connection (FK cascade), so revoking a connection stops its webhooks.
 */
export const openFinanceItems = pgTable(
  'open_finance_items',
  {
    itemHash: text().primaryKey(),
    workspaceId: uuid()
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    connectionId: uuid().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('open_finance_items_connection_uq').on(t.workspaceId, t.connectionId),
    foreignKey({
      name: 'open_finance_items_connection_fk',
      columns: [t.workspaceId, t.connectionId],
      foreignColumns: [bankConnections.workspaceId, bankConnections.id],
    }).onDelete('cascade'),
  ],
);

/** Webhook deliveries already received (idempotency by the provider's event id). */
export const openFinanceEvents = pgTable(
  'open_finance_events',
  {
    id: id(),
    provider: text().$type<OpenFinanceProvider>().notNull(),
    eventId: text().notNull(),
    eventType: text().notNull(),
    processedAt: timestamptz(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('open_finance_events_provider_event_uq').on(t.provider, t.eventId),
    index('open_finance_events_created_idx').on(t.createdAt),
    check('open_finance_events_provider_chk', sql`${t.provider} in ('pluggy', 'fake')`),
    check(
      'open_finance_events_size_chk',
      sql`length(${t.eventId}) between 1 and 200 and length(${t.eventType}) between 1 and 100`,
    ),
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
export type ImportBatchRow = typeof importBatches.$inferSelect;
export type BankConnectionRow = typeof bankConnections.$inferSelect;
export type BankConnectionAccountRow = typeof bankConnectionAccounts.$inferSelect;
