// Data import contract: bank statements / card invoices from files (OFX, CSV) and read-only bank
// connections through Open Finance Brasil (via a licensed aggregator — Pluggy in production, a
// simulated provider in development, tests and the browser demo).
//
// Imported rows become ordinary transactions tagged with their origin and batch, so they show up
// in statements, invoices and reports, can be edited like any other row, and a whole batch can be
// undone. Every import is idempotent per target: `externalId` (OFX FITID, provider transaction id
// or a content hash) never creates the same transaction twice.

import { z } from 'zod';
import { idSchema, isoDateSchema, monthKeySchema, signedAmountSchema } from './schemas';
import type { ISODate, MonthKey } from './utils/dates';

// ---------------------------------------------------------------------------
// Catalogs
// ---------------------------------------------------------------------------

/** Where a transaction came from. */
export const TRANSACTION_ORIGINS = ['manual', 'file', 'open_finance'] as const;
export type TransactionOrigin = (typeof TRANSACTION_ORIGINS)[number];

export const TRANSACTION_ORIGIN_LABELS: Record<TransactionOrigin, string> = {
  manual: 'Manual',
  file: 'Importado',
  open_finance: 'Open Finance',
};

export const IMPORT_FORMATS = ['ofx', 'csv'] as const;
export type ImportFormat = (typeof IMPORT_FORMATS)[number];

export const IMPORT_FORMAT_LABELS: Record<ImportFormat, string> = {
  ofx: 'OFX (extrato bancário)',
  csv: 'CSV (planilha)',
};

/** Decoded text sent to the API (the browser decodes the file using the OFX/CSV charset). */
export const MAX_IMPORT_CONTENT_CHARS = 3_000_000;
export const MAX_IMPORT_ROWS = 3000;

export const CSV_DATE_FORMATS = ['DD/MM/YYYY', 'DD/MM/YY', 'YYYY-MM-DD', 'MM/DD/YYYY'] as const;
export type CsvDateFormat = (typeof CSV_DATE_FORMATS)[number];

export const OPEN_FINANCE_PROVIDERS = ['pluggy', 'fake'] as const;
export type OpenFinanceProvider = (typeof OPEN_FINANCE_PROVIDERS)[number];

/** Connection health, mapped from the aggregator's item status. */
export const BANK_CONNECTION_STATUSES = [
  'syncing',
  'active',
  'login_error',
  'waiting_user_input',
  'outdated',
  'error',
] as const;
export type BankConnectionStatus = (typeof BANK_CONNECTION_STATUSES)[number];

export const BANK_CONNECTION_STATUS_LABELS: Record<BankConnectionStatus, string> = {
  syncing: 'Sincronizando',
  active: 'Conectado',
  login_error: 'Consentimento recusado',
  waiting_user_input: 'Aguardando confirmação',
  outdated: 'Consentimento expirado',
  error: 'Erro na sincronização',
};

export const BANK_ACCOUNT_KINDS = ['bank', 'credit_card'] as const;
export type BankAccountKind = (typeof BANK_ACCOUNT_KINDS)[number];

/** How far back the first sync of a newly linked account goes (days). */
export const OPEN_FINANCE_DEFAULT_HISTORY_DAYS = 90;
export const OPEN_FINANCE_MAX_HISTORY_DAYS = 365;

// ---------------------------------------------------------------------------
// File import
// ---------------------------------------------------------------------------

/** Column indexes are 0-based. Either `amountColumn` or `debitColumn`/`creditColumn`. */
export const csvMappingSchema = z
  .object({
    delimiter: z.enum([',', ';', '\t', '|']),
    hasHeader: z.boolean(),
    dateColumn: z.int().min(0).max(200),
    descriptionColumn: z.int().min(0).max(200),
    amountColumn: z.int().min(0).max(200).nullable(),
    debitColumn: z.int().min(0).max(200).nullable(),
    creditColumn: z.int().min(0).max(200).nullable(),
    /**
     * Column with the bank's own transaction id (e.g. Nubank "Identificador"): used as externalId.
     * Optional (additive); detected from the header when omitted.
     */
    idColumn: z.int().min(0).max(200).nullable().optional(),
    dateFormat: z.enum(CSV_DATE_FORMATS),
    decimalSeparator: z.enum([',', '.']),
    /** Card exports usually list purchases as positive numbers: invert so purchases are outflows. */
    invertSign: z.boolean(),
  })
  .refine((m) => m.amountColumn !== null || (m.debitColumn !== null && m.creditColumn !== null), {
    message: 'Escolha a coluna de valor (ou as colunas de débito e crédito)',
  });
export type CsvMapping = z.infer<typeof csvMappingSchema>;

export const importTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('account'), accountId: idSchema }),
  z.object({
    kind: z.literal('credit_card'),
    creditCardId: idSchema,
    /** Invoice the file belongs to; when omitted each purchase goes to the invoice of its date. */
    invoiceMonth: monthKeySchema.optional(),
  }),
]);
export type ImportTarget = z.infer<typeof importTargetSchema>;

export const importPreviewSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  content: z
    .string()
    .min(1, { message: 'Arquivo vazio' })
    .max(MAX_IMPORT_CONTENT_CHARS, { message: 'Arquivo muito grande' }),
  /** Detected from the content when omitted. */
  format: z.enum(IMPORT_FORMATS).optional(),
  target: importTargetSchema,
  /** CSV only; detected (common Brazilian bank exports) when omitted. */
  csv: csvMappingSchema.optional(),
});
export type ImportPreviewInput = z.input<typeof importPreviewSchema>;

export interface ImportPreviewRow {
  /** Position in the file (stable key for the UI). */
  index: number;
  date: ISODate;
  description: string;
  /** Positive cents. */
  amount: number;
  /** Money in (income / card refund) or out (expense / card purchase). */
  type: 'income' | 'expense';
  externalId: string;
  /** Already imported (same externalId) or a likely manual duplicate (same date, amount, description). */
  duplicate: boolean;
  duplicateTransactionId: string | null;
  /** Suggested (sub)category from the workspace history; null when unknown. */
  categoryId: string | null;
  /** "Parcela 2/10"-style hints found in the description. */
  installment: { number: number; total: number } | null;
  /** Suggested to leave out (duplicate, card bill payment, zero amount). */
  skip: boolean;
  /** Why the row is flagged, e.g. "Pagamento de fatura". */
  note: string | null;
}

export interface ImportPreview {
  format: ImportFormat;
  fileName: string;
  target: ImportTarget;
  /** From the OFX header (bank name / id) when available. */
  institution: string | null;
  /** Last digits of the account in the file, to help confirm the target. */
  accountHint: string | null;
  period: { from: ISODate; to: ISODate } | null;
  /** CSV header cells (or "Coluna 1…") for the mapping UI. */
  csvColumns: string[] | null;
  /** Mapping used to read the CSV (detected or the one sent). */
  csvMapping: CsvMapping | null;
  rows: ImportPreviewRow[];
  totals: { count: number; income: number; expense: number; duplicates: number };
}

export const importRowSchema = z.object({
  date: isoDateSchema,
  description: z.string().trim().min(1).max(200),
  amount: signedAmountSchema.refine((v) => v > 0, { message: 'Valor inválido' }),
  type: z.enum(['income', 'expense']),
  externalId: z.string().min(1).max(200),
  categoryId: idSchema.nullable(),
});

export const importCommitSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  format: z.enum(IMPORT_FORMATS),
  target: importTargetSchema,
  rows: z
    .array(importRowSchema)
    .min(1, { message: 'Selecione ao menos um lançamento' })
    .max(MAX_IMPORT_ROWS),
});
export type ImportCommitInput = z.input<typeof importCommitSchema>;

export interface ImportBatch {
  id: string;
  origin: Exclude<TransactionOrigin, 'manual'>;
  format: ImportFormat | null;
  fileName: string | null;
  /** Open Finance batches: the connection that produced them. */
  connectionId: string | null;
  accountId: string | null;
  creditCardId: string | null;
  invoiceMonth: MonthKey | null;
  createdCount: number;
  skippedCount: number;
  /** Transactions of the batch that still exist (undo removes them). */
  remainingCount: number;
  createdByName: string | null;
  createdAt: string;
}

export interface ImportCommitResponse {
  batch: ImportBatch;
  created: number;
  /** Rows not created because their externalId was already imported into the target. */
  skipped: number;
}

export const importListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// ---------------------------------------------------------------------------
// Open Finance (read-only bank connections)
// ---------------------------------------------------------------------------

export interface OpenFinanceStatus {
  /** False when the provider isn't configured (UI hides the feature). */
  enabled: boolean;
  provider: OpenFinanceProvider | null;
  /** Fake provider / aggregator sandbox: show test institutions. */
  sandbox: boolean;
}

export const connectTokenSchema = z.object({
  /** Re-consent / update an existing connection instead of creating a new one. */
  connectionId: idSchema.optional(),
});
export type ConnectTokenInput = z.infer<typeof connectTokenSchema>;

export interface ConnectTokenResponse {
  provider: OpenFinanceProvider;
  /** Short-lived token for the aggregator's consent widget (never an API key). */
  accessToken: string;
  /** Provider item id to update (re-consent), when `connectionId` was sent. */
  updateItemId: string | null;
  sandbox: boolean;
  expiresAt: string;
}

/** Fake provider only (development, tests, demo): institutions offered by the simulated widget. */
export interface FakeInstitution {
  id: string;
  name: string;
  /** Code from BANKS, for the logo badge. */
  bank: string;
}

export const fakeConnectSchema = z.object({ institutionId: z.string().min(1).max(50) });

export const createConnectionSchema = z.object({
  /** Item id returned by the consent widget. */
  itemId: z.string().trim().min(1).max(200),
});
export type CreateConnectionInput = z.infer<typeof createConnectionSchema>;

export interface BankConnectionAccount {
  id: string;
  kind: BankAccountKind;
  name: string;
  /** Masked number (last digits only). */
  number: string | null;
  /** Cents, as reported by the institution. */
  balance: number | null;
  creditLimit: number | null;
  /** Local account/card that receives this account's transactions; null = not linked (ignored). */
  linkedAccountId: string | null;
  linkedCreditCardId: string | null;
  /** First date synced into the linked account/card. */
  syncFrom: ISODate | null;
  lastSyncAt: string | null;
}

export interface BankConnection {
  id: string;
  provider: OpenFinanceProvider;
  institution: { name: string; imageUrl: string | null; bank: string | null };
  status: BankConnectionStatus;
  statusDetail: string | null;
  /** When the Open Finance consent expires (re-consent before it). */
  consentExpiresAt: string | null;
  lastSyncAt: string | null;
  createdAt: string;
  accounts: BankConnectionAccount[];
}

export const linkAccountTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('account'), accountId: idSchema }),
  z.object({ kind: z.literal('credit_card'), creditCardId: idSchema }),
  /** Create a local account/card from the institution data and link it. */
  z.object({ kind: z.literal('new') }),
  /** Stop syncing this account. */
  z.object({ kind: z.literal('ignore') }),
]);

export const linkAccountsSchema = z.object({
  links: z
    .array(
      z.object({
        connectionAccountId: idSchema,
        target: linkAccountTargetSchema,
        syncFrom: isoDateSchema.optional(),
      }),
    )
    .min(1)
    .max(50),
});
export type LinkAccountsInput = z.input<typeof linkAccountsSchema>;

export interface SyncResult {
  connection: BankConnection;
  created: number;
  updated: number;
  skipped: number;
}
