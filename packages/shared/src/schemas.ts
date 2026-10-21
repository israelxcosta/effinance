// Zod schemas for every API input (bodies and query strings).
// The API validates with them and the web reuses them in react-hook-form.

import { z } from 'zod';
import {
  ACCOUNT_TYPES,
  BANK_CODES,
  CARD_BRANDS,
  CATEGORY_TYPES,
  FREQUENCIES,
  GRANULARITIES,
  ICON_NAMES,
  PAYMENT_METHODS,
  RECURRENCE_KINDS,
  SERIES_SCOPES,
  TRANSACTION_STATUSES,
} from './constants';
import { isISODate } from './utils/dates';
import { isValidDocument, isValidPhone, onlyDigits } from './utils/documents';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const idSchema = z.uuid({ message: 'ID inválido' });

/**
 * Calendar years accepted from clients. Postgres has no year 0 and reports reach back a year before
 * `from` (opening balances, history), so far-off years would surface as database errors (500).
 */
export const MIN_YEAR = 1900;
export const MAX_YEAR = 2199;

const inYearRange = (value: string) => {
  const year = Number(value.slice(0, 4));
  return year >= MIN_YEAR && year <= MAX_YEAR;
};

export const isoDateSchema = z
  .string()
  .refine(isISODate, { message: 'Data inválida (use AAAA-MM-DD)' })
  .refine(inYearRange, { message: `Use uma data entre ${MIN_YEAR} e ${MAX_YEAR}` });

export const monthKeySchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'Mês inválido (use AAAA-MM)' })
  .refine(inYearRange, { message: `Use um mês entre ${MIN_YEAR} e ${MAX_YEAR}` });

/** Positive amount in cents. */
export const amountSchema = z
  .int({ message: 'Valor inválido' })
  .positive({ message: 'Informe um valor maior que zero' })
  .max(100_000_000_000, { message: 'Valor muito alto' });

/** Any amount in cents (balances may be negative). */
export const signedAmountSchema = z
  .int({ message: 'Valor inválido' })
  .min(-100_000_000_000)
  .max(100_000_000_000);

export const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, { message: 'Cor inválida' });
export const iconSchema = z.enum(ICON_NAMES);
export const bankCodeSchema = z.enum(BANK_CODES);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

const requiredName = (max = 80) =>
  z.string().trim().min(1, { message: 'Informe o nome' }).max(max, { message: `Máximo de ${max} caracteres` });

const dayOfMonth = z.int().min(1, { message: 'Dia inválido' }).max(31, { message: 'Dia inválido' });

/** Query-string pagination. */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const dateRangeQuerySchema = z
  .object({ from: isoDateSchema, to: isoDateSchema })
  .refine((v) => v.from <= v.to, { message: 'Data inicial maior que a final', path: ['to'] });

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const registerSchema = z.object({
  name: requiredName(80),
  email: z.email({ message: 'E-mail inválido' }).trim().toLowerCase(),
  password: z
    .string()
    .min(10, { message: 'A senha deve ter ao menos 10 caracteres' })
    .max(128, { message: 'Senha muito longa' })
    .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), { message: 'Use letras e números' }),
  /** LGPD: explicit acceptance of the terms of use and privacy policy. */
  acceptTerms: z.literal(true, { message: 'Aceite os termos de uso e a política de privacidade' }),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.email({ message: 'E-mail inválido' }).trim().toLowerCase(),
  password: z.string().min(1, { message: 'Informe a senha' }),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const updateProfileSchema = z.object({
  name: requiredName(80),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

// ---------------------------------------------------------------------------
// Categories (a subcategory is a category with parentId; it inherits the parent's type)
// ---------------------------------------------------------------------------

export const categoryInputSchema = z.object({
  name: requiredName(60),
  type: z.enum(CATEGORY_TYPES),
  icon: iconSchema.default('tag'),
  color: colorSchema.default('#152B61'),
  parentId: idSchema.nullish().transform((v) => v ?? null),
});
export type CategoryInput = z.input<typeof categoryInputSchema>;

export const categoryQuerySchema = z.object({
  type: z.enum(CATEGORY_TYPES).optional(),
  includeArchived: z.stringbool().optional(),
});

export const categoryUpdateSchema = categoryInputSchema
  .omit({ type: true, parentId: true })
  .extend({ archived: z.boolean().optional() });
export type CategoryUpdateInput = z.input<typeof categoryUpdateSchema>;

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export const accountInputSchema = z.object({
  name: requiredName(60),
  type: z.enum(ACCOUNT_TYPES),
  bank: bankCodeSchema.nullish().transform((v) => v ?? null),
  color: colorSchema.default('#152B61'),
  icon: iconSchema.default('wallet'),
  initialBalance: signedAmountSchema.default(0),
  /** Whether the account counts toward the "saldo em contas" total. */
  includeInTotal: z.boolean().default(true),
  archived: z.boolean().default(false),
});
export type AccountInput = z.input<typeof accountInputSchema>;

export const accountQuerySchema = z.object({
  includeArchived: z.stringbool().optional(),
});

// ---------------------------------------------------------------------------
// Credit cards
// ---------------------------------------------------------------------------

export const creditCardInputSchema = z.object({
  name: requiredName(60),
  bank: bankCodeSchema,
  brand: z.enum(CARD_BRANDS),
  limit: amountSchema,
  closingDay: dayOfMonth,
  dueDay: dayOfMonth,
  color: colorSchema.default('#152B61'),
  /** Account suggested when paying the invoice. */
  defaultAccountId: idSchema.nullish().transform((v) => v ?? null),
  archived: z.boolean().default(false),
});
export type CreditCardInput = z.input<typeof creditCardInputSchema>;

export const payInvoiceSchema = z.object({
  accountId: idSchema,
  date: isoDateSchema,
  /** Defaults to the unpaid total of the invoice. Only full payment is supported. */
  amount: amountSchema.optional(),
});
export type PayInvoiceInput = z.infer<typeof payInvoiceSchema>;

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

export const goalInputSchema = z.object({
  name: requiredName(60),
  targetAmount: amountSchema,
  deadline: isoDateSchema.nullish().transform((v) => v ?? null),
  icon: iconSchema.default('target'),
  color: colorSchema.default('#152B61'),
  accountId: idSchema.nullish().transform((v) => v ?? null),
  notes: optionalText(500),
  archived: z.boolean().default(false),
});
export type GoalInput = z.input<typeof goalInputSchema>;

export const goalContributionInputSchema = z.object({
  /** Negative values register a withdrawal from the goal. */
  amount: signedAmountSchema.refine((v) => v !== 0, { message: 'Informe um valor' }),
  date: isoDateSchema,
  note: optionalText(200),
});
export type GoalContributionInput = z.input<typeof goalContributionInputSchema>;

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

export const contactInputSchema = z.object({
  name: requiredName(120),
  document: z
    .string()
    .nullish()
    .transform((v) => (v ? onlyDigits(v) : null))
    .refine((v) => v === null || isValidDocument(v), { message: 'CPF/CNPJ inválido' }),
  email: z
    .union([z.email({ message: 'E-mail inválido' }), z.literal('')])
    .nullish()
    .transform((v) => (v ? v.toLowerCase() : null)),
  phone: z
    .string()
    .nullish()
    .transform((v) => (v ? onlyDigits(v) : null))
    .refine((v) => v === null || isValidPhone(v), { message: 'Telefone inválido' }),
  zipCode: z
    .string()
    .nullish()
    .transform((v) => (v ? onlyDigits(v) : null))
    .refine((v) => v === null || v.length === 8, { message: 'CEP inválido' }),
  street: optionalText(120),
  number: optionalText(20),
  complement: optionalText(60),
  district: optionalText(80),
  city: optionalText(80),
  state: z
    .string()
    .trim()
    .toUpperCase()
    .length(2, { message: 'UF inválida' })
    .nullish()
    .or(z.literal(''))
    .transform((v) => (v ? v : null)),
  notes: optionalText(500),
});
export type ContactInput = z.input<typeof contactInputSchema>;

export const contactQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(80).optional(),
});

// ---------------------------------------------------------------------------
// Transactions (contas a pagar / a receber / lançamentos)
// ---------------------------------------------------------------------------

const transactionBaseSchema = z.object({
  type: z.enum(['income', 'expense']),
  description: z
    .string()
    .trim()
    .min(1, { message: 'Informe a descrição' })
    .max(120, { message: 'Máximo de 120 caracteres' }),
  /** For installments with installmentAmountMode = 'total' this is the TOTAL purchase amount. */
  amount: amountSchema,
  /** Due date (vencimento) / competence date. For card purchases: purchase date. */
  date: isoDateSchema,
  paid: z.boolean().default(false),
  /** Defaults to `date` when paid. */
  paidAt: isoDateSchema.nullish().transform((v) => v ?? null),
  accountId: idSchema.nullish().transform((v) => v ?? null),
  creditCardId: idSchema.nullish().transform((v) => v ?? null),
  categoryId: idSchema.nullish().transform((v) => v ?? null),
  subcategoryId: idSchema.nullish().transform((v) => v ?? null),
  contactId: idSchema.nullish().transform((v) => v ?? null),
  paymentMethod: z
    .enum(PAYMENT_METHODS)
    .nullish()
    .transform((v) => v ?? null),
  notes: optionalText(1000),
});

export const transactionSplitSchema = z.object({
  categoryId: idSchema,
  subcategoryId: idSchema.nullish().transform((v) => v ?? null),
  amount: amountSchema,
});
export type TransactionSplitInput = z.input<typeof transactionSplitSchema>;

export const transactionInputSchema = transactionBaseSchema
  .extend({
    /**
     * Divides `amount` across categories (2–10 parts). One linked transaction is created per part
     * (same date, account, status and repetition), sharing a `splitGroupId`; the parts' categories
     * replace `categoryId`/`subcategoryId` and their amounts must add up to `amount`.
     */
    splits: z
      .array(transactionSplitSchema)
      .min(2, { message: 'Divida em pelo menos 2 categorias' })
      .max(10, { message: 'Máximo de 10 categorias' })
      .nullish()
      .transform((v) => v ?? null),
    recurrenceKind: z.enum(RECURRENCE_KINDS).default('single'),
    frequency: z.enum(FREQUENCIES).default('monthly'),
    /** installment: number of installments (2–360). */
    installments: z.int().min(2, { message: 'Mínimo de 2 parcelas' }).max(360).nullish(),
    installmentAmountMode: z.enum(['total', 'per_installment']).default('total'),
    /** recurring: number of occurrences (2–360); null/undefined = no end. */
    occurrences: z.int().min(2).max(360).nullish(),
  })
  .superRefine((v, ctx) => {
    if (v.accountId && v.creditCardId) {
      ctx.addIssue({
        code: 'custom',
        message: 'Escolha uma conta OU um cartão',
        path: ['creditCardId'],
      });
    }
    if (v.creditCardId && v.type !== 'expense') {
      ctx.addIssue({
        code: 'custom',
        message: 'Cartão de crédito só pode ser usado em despesas',
        path: ['creditCardId'],
      });
    }
    if (v.recurrenceKind === 'installment' && !v.installments) {
      ctx.addIssue({ code: 'custom', message: 'Informe a quantidade de parcelas', path: ['installments'] });
    }
    if (v.subcategoryId && !v.categoryId) {
      ctx.addIssue({ code: 'custom', message: 'Selecione a categoria', path: ['categoryId'] });
    }
    if (v.splits) {
      const sum = v.splits.reduce((acc, s) => acc + s.amount, 0);
      if (sum !== v.amount) {
        ctx.addIssue({
          code: 'custom',
          message: 'A soma das categorias deve ser igual ao valor total',
          path: ['splits'],
        });
      }
    }
  });
export type TransactionInput = z.input<typeof transactionInputSchema>;
export type TransactionInputParsed = z.output<typeof transactionInputSchema>;

/**
 * Anticipates installments of an installment purchase: the LAST `count` unpaid installments after
 * this one (all of them by default) move to `date` (default: today). On a credit card they land in
 * the invoice that receives purchases made on that date (the current open invoice).
 */
export const anticipateInstallmentsSchema = z.object({
  count: z.int().min(1, { message: 'Antecipe ao menos 1 parcela' }).max(360).optional(),
  date: isoDateSchema.optional(),
});
export type AnticipateInstallmentsInput = z.input<typeof anticipateInstallmentsSchema>;

export const seriesScopeQuerySchema = z.object({
  scope: z.enum(SERIES_SCOPES).default('one'),
});

/**
 * Partial update. With scope 'future'/'all' every field except date/paid/paidAt is applied to
 * the unpaid occurrences of the series (paid ones are history and stay untouched).
 */
export const transactionUpdateSchema = transactionBaseSchema
  .omit({ type: true })
  // No default here: an omitted `paid` must keep the current value.
  .extend({ paid: z.boolean() })
  .partial()
  .superRefine((v, ctx) => {
    if (v.accountId && v.creditCardId) {
      ctx.addIssue({ code: 'custom', message: 'Escolha uma conta OU um cartão', path: ['creditCardId'] });
    }
  });
export type TransactionUpdateInput = z.input<typeof transactionUpdateSchema>;

/** Quick 👍/👎 toggle. */
export const setPaidSchema = z.object({
  paid: z.boolean(),
  paidAt: isoDateSchema.nullish(),
  /** Account used to pay/receive when the transaction had none. */
  accountId: idSchema.nullish(),
});
export type SetPaidInput = z.infer<typeof setPaidSchema>;

export const transactionQuerySchema = paginationQuerySchema.extend({
  type: z.enum(['income', 'expense', 'transfer']).optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  status: z.enum(TRANSACTION_STATUSES).default('all'),
  accountId: idSchema.optional(),
  creditCardId: idSchema.optional(),
  categoryId: idSchema.optional(),
  contactId: idSchema.optional(),
  recurrenceKind: z.enum(RECURRENCE_KINDS).optional(),
  search: z.string().trim().max(80).optional(),
  sort: z.enum(['date_asc', 'date_desc', 'amount_desc', 'amount_asc']).default('date_asc'),
});
export type TransactionQuery = z.input<typeof transactionQuerySchema>;

// ---------------------------------------------------------------------------
// Transfers & investments
// ---------------------------------------------------------------------------

export const transferInputSchema = z
  .object({
    fromAccountId: idSchema,
    toAccountId: idSchema,
    amount: amountSchema,
    date: isoDateSchema,
    description: optionalText(120),
    notes: optionalText(1000),
    /** Scheduled (future) transfers can be created as pending. */
    paid: z.boolean().default(true),
  })
  .refine((v) => v.fromAccountId !== v.toAccountId, {
    message: 'Escolha contas diferentes',
    path: ['toAccountId'],
  });
export type TransferInput = z.input<typeof transferInputSchema>;

export const transferQuerySchema = paginationQuerySchema.extend({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  accountId: idSchema.optional(),
  kind: z.enum(['transfer', 'investment', 'redemption', 'card_payment']).optional(),
});

// ---------------------------------------------------------------------------
// Statement (extrato)
// ---------------------------------------------------------------------------

export const statementQuerySchema = z
  .object({
    /** Omit for "todas as contas" (non-investment accounts included in total). */
    accountId: idSchema.optional(),
    from: isoDateSchema,
    to: isoDateSchema,
    includePending: z.stringbool().default(true),
  })
  .refine((v) => v.from <= v.to, { message: 'Data inicial maior que a final', path: ['to'] });
export type StatementQuery = z.input<typeof statementQuerySchema>;

// ---------------------------------------------------------------------------
// Dashboard & reports
// ---------------------------------------------------------------------------

export const dashboardQuerySchema = z.object({
  month: monthKeySchema,
});

const reportRange = {
  from: isoDateSchema,
  to: isoDateSchema,
};

export const categoryReportQuerySchema = z.object({
  ...reportRange,
  type: z.enum(CATEGORY_TYPES).default('expense'),
  granularity: z.enum(GRANULARITIES).default('month'),
  /** 'paid' = realizado; 'all' = realizado + previsto. */
  status: z.enum(['all', 'paid']).default('all'),
  /** Breaks a single category down into its subcategories. */
  categoryId: idSchema.optional(),
});
export type CategoryReportQuery = z.input<typeof categoryReportQuerySchema>;

export const contactReportQuerySchema = z.object({
  ...reportRange,
  granularity: z.enum(GRANULARITIES).default('month'),
  status: z.enum(['all', 'paid']).default('all'),
});
export type ContactReportQuery = z.input<typeof contactReportQuerySchema>;

export const comparisonReportQuerySchema = z.object({
  aFrom: isoDateSchema,
  aTo: isoDateSchema,
  bFrom: isoDateSchema,
  bTo: isoDateSchema,
  type: z.enum(CATEGORY_TYPES).default('expense'),
  status: z.enum(['all', 'paid']).default('all'),
});
export type ComparisonReportQuery = z.input<typeof comparisonReportQuerySchema>;

export const cashflowReportQuerySchema = z.object({
  ...reportRange,
  granularity: z.enum(GRANULARITIES).default('month'),
  accountId: idSchema.optional(),
});
export type CashflowReportQuery = z.input<typeof cashflowReportQuerySchema>;

export const overviewReportQuerySchema = z.object({
  ...reportRange,
});
export type OverviewReportQuery = z.input<typeof overviewReportQuerySchema>;

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(80),
});
