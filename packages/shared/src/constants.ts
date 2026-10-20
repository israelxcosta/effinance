// Domain enums, labels (pt-BR) and catalogs shared by API and web.

export const CATEGORY_TYPES = ['income', 'expense'] as const;
export type CategoryType = (typeof CATEGORY_TYPES)[number];

export const TRANSACTION_TYPES = ['income', 'expense', 'transfer'] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

/** How a transfer row should be read. Derived by the API from the accounts involved. */
export const TRANSFER_KINDS = ['transfer', 'investment', 'redemption', 'card_payment'] as const;
export type TransferKind = (typeof TRANSFER_KINDS)[number];

export const TRANSFER_KIND_LABELS: Record<TransferKind, string> = {
  transfer: 'Transferência',
  investment: 'Aplicação',
  redemption: 'Resgate',
  card_payment: 'Pagamento de fatura',
};

export const ACCOUNT_TYPES = [
  'checking',
  'savings',
  'wallet',
  'benefit',
  'investment',
  'other',
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  checking: 'Conta corrente',
  savings: 'Poupança',
  wallet: 'Carteira',
  benefit: 'Benefício (VR/VA)',
  investment: 'Investimento',
  other: 'Outra',
};

export const PAYMENT_METHODS = [
  'pix',
  'cash',
  'debit_card',
  'credit_card',
  'bank_slip',
  'transfer',
  'auto_debit',
  'other',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  pix: 'Pix',
  cash: 'Dinheiro',
  debit_card: 'Cartão de débito',
  credit_card: 'Cartão de crédito',
  bank_slip: 'Boleto',
  transfer: 'TED/DOC',
  auto_debit: 'Débito automático',
  other: 'Outro',
};

/**
 * single      → lançamento único
 * installment → parcelado (N parcelas geradas na criação)
 * recurring   → recorrente na frequência escolhida (com ou sem quantidade definida)
 * fixed       → fixa mensal, sem fim; gerada mês a mês (aparece em relatórios/projeções)
 */
export const RECURRENCE_KINDS = ['single', 'installment', 'recurring', 'fixed'] as const;
export type RecurrenceKind = (typeof RECURRENCE_KINDS)[number];

export const RECURRENCE_KIND_LABELS: Record<RecurrenceKind, string> = {
  single: 'Única',
  installment: 'Parcelada',
  recurring: 'Recorrente',
  fixed: 'Fixa mensal',
};

export const FREQUENCIES = ['weekly', 'monthly', 'semiannual', 'annual'] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export const FREQUENCY_LABELS: Record<Frequency, string> = {
  weekly: 'Semanal',
  monthly: 'Mensal',
  semiannual: 'Semestral',
  annual: 'Anual',
};

/** Scope used when editing/deleting an occurrence that belongs to a series. */
export const SERIES_SCOPES = ['one', 'future', 'all'] as const;
export type SeriesScope = (typeof SERIES_SCOPES)[number];

export const SERIES_SCOPE_LABELS: Record<SeriesScope, string> = {
  one: 'Somente este',
  future: 'Este e os próximos',
  all: 'Todos da série',
};

export const TRANSACTION_STATUSES = ['all', 'paid', 'pending', 'overdue'] as const;
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

export const GRANULARITIES = ['day', 'week', 'month', 'year'] as const;
export type Granularity = (typeof GRANULARITIES)[number];

export const CARD_BRANDS = [
  'visa',
  'mastercard',
  'elo',
  'amex',
  'hipercard',
  'diners',
  'other',
] as const;
export type CardBrand = (typeof CARD_BRANDS)[number];

export const CARD_BRAND_LABELS: Record<CardBrand, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  elo: 'Elo',
  amex: 'American Express',
  hipercard: 'Hipercard',
  diners: 'Diners Club',
  other: 'Outra',
};

export type InvoiceStatus = 'open' | 'closed' | 'paid' | 'overdue';

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  open: 'Aberta',
  closed: 'Fechada',
  paid: 'Paga',
  overdue: 'Vencida',
};

export interface BankInfo {
  code: string;
  name: string;
  /** 1–3 chars shown inside the round badge. */
  short: string;
  color: string;
  textColor: string;
}

/** Main Brazilian banks/fintechs. Colors approximate each brand; no trademarked artwork is used. */
export const BANKS = [
  { code: 'nubank', name: 'Nubank', short: 'nu', color: '#820AD1', textColor: '#FFFFFF' },
  { code: 'itau', name: 'Itaú', short: 'itaú', color: '#EC7000', textColor: '#FFFFFF' },
  { code: 'bradesco', name: 'Bradesco', short: 'B', color: '#CC092F', textColor: '#FFFFFF' },
  { code: 'bb', name: 'Banco do Brasil', short: 'BB', color: '#FCF000', textColor: '#0038A8' },
  { code: 'caixa', name: 'Caixa', short: 'CX', color: '#005CA9', textColor: '#FFFFFF' },
  { code: 'santander', name: 'Santander', short: 'S', color: '#EC0000', textColor: '#FFFFFF' },
  { code: 'inter', name: 'Banco Inter', short: 'in', color: '#FF7A00', textColor: '#FFFFFF' },
  { code: 'c6', name: 'C6 Bank', short: 'C6', color: '#1F1F1F', textColor: '#FFFFFF' },
  { code: 'btg', name: 'BTG Pactual', short: 'btg', color: '#0B2A5B', textColor: '#FFFFFF' },
  { code: 'xp', name: 'XP Investimentos', short: 'XP', color: '#111111', textColor: '#F5D400' },
  { code: 'sicoob', name: 'Sicoob', short: 'sc', color: '#00A091', textColor: '#FFFFFF' },
  { code: 'sicredi', name: 'Sicredi', short: 'sr', color: '#3FA110', textColor: '#FFFFFF' },
  { code: 'picpay', name: 'PicPay', short: 'pp', color: '#21C25E', textColor: '#FFFFFF' },
  { code: 'mercadopago', name: 'Mercado Pago', short: 'mp', color: '#00B1EA', textColor: '#FFFFFF' },
  { code: 'pagbank', name: 'PagBank', short: 'pb', color: '#00A868', textColor: '#FFFFFF' },
  { code: 'neon', name: 'Neon', short: 'ne', color: '#0FD3F0', textColor: '#06243A' },
  { code: 'safra', name: 'Safra', short: 'sf', color: '#00205B', textColor: '#D4B46A' },
  { code: 'banrisul', name: 'Banrisul', short: 'br', color: '#004B8D', textColor: '#FFFFFF' },
  { code: 'original', name: 'Banco Original', short: 'og', color: '#00A857', textColor: '#FFFFFF' },
  { code: 'next', name: 'Next', short: 'nx', color: '#00E35F', textColor: '#0B0B0B' },
  { code: 'will', name: 'Will Bank', short: 'wb', color: '#FFD500', textColor: '#1A1A1A' },
  { code: 'stone', name: 'Stone', short: 'st', color: '#00A868', textColor: '#FFFFFF' },
  { code: 'other', name: 'Outro banco', short: '$', color: '#6B6F76', textColor: '#FFFFFF' },
] as const satisfies readonly BankInfo[];

export type BankCode = (typeof BANKS)[number]['code'];
export const BANK_CODES = BANKS.map((b) => b.code) as unknown as readonly [BankCode, ...BankCode[]];

export function getBank(code: string | null | undefined): BankInfo | undefined {
  return BANKS.find((b) => b.code === code);
}

/** Curated lucide icon names (kebab-case) offered in pickers. The web maps them to components. */
export const ICON_NAMES = [
  'wallet',
  'banknote',
  'coins',
  'hand-coins',
  'piggy-bank',
  'landmark',
  'credit-card',
  'receipt',
  'trending-up',
  'briefcase',
  'laptop',
  'building-2',
  'shopping-cart',
  'shopping-bag',
  'store',
  'utensils',
  'coffee',
  'pizza',
  'beer',
  'car',
  'fuel',
  'bus',
  'bike',
  'plane',
  'house',
  'lightbulb',
  'droplet',
  'wifi',
  'smartphone',
  'tv',
  'heart-pulse',
  'pill',
  'stethoscope',
  'dumbbell',
  'graduation-cap',
  'book-open',
  'gift',
  'party-popper',
  'music',
  'gamepad-2',
  'film',
  'ticket',
  'shirt',
  'scissors',
  'baby',
  'paw-print',
  'wrench',
  'shield',
  'umbrella',
  'sparkles',
  'tag',
  'target',
  'flag',
  'star',
] as const;
export type IconName = (typeof ICON_NAMES)[number];

/** Swatches offered in color pickers (categories, accounts, cards, goals). */
export const COLOR_SWATCHES = [
  '#152B61',
  '#3F64BE',
  '#0EA5E9',
  '#14B8A6',
  '#12A150',
  '#84CC16',
  '#EAB308',
  '#F59E0B',
  '#F97316',
  '#E5484D',
  '#EC4899',
  '#A855F7',
  '#7C3AED',
  '#64748B',
  '#78716C',
  '#0F766E',
] as const;

export const DEFAULT_COLOR = '#152B61';
