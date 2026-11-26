// API response types. Amounts are integer cents; dates are 'YYYY-MM-DD'; timestamps ISO 8601.

import type {
  AccountType,
  AssetType,
  BankCode,
  CardBrand,
  CategoryType,
  Frequency,
  IconName,
  InvestmentIncomeKind,
  InvoiceStatus,
  PaymentMethod,
  RecurrenceKind,
  TransactionType,
  TransferKind,
} from './constants';
import type { TransactionOrigin } from './integrations';
import type { ISODate, MonthKey } from './utils/dates';

export interface ApiError {
  /** Machine-readable code: 'validation_error' | 'not_found' | 'unauthorized' | 'conflict' | ... */
  error: string;
  /** Human-readable message in pt-BR. */
  message: string;
  details?: unknown;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export interface User {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

/** Session cookie (httpOnly) is also set; `token` allows Bearer usage by non-browser clients. */
export interface AuthResponse {
  user: User;
  token: string;
}

// ---------------------------------------------------------------------------
// Catalog entities
// ---------------------------------------------------------------------------

export interface Category {
  id: string;
  name: string;
  type: CategoryType;
  icon: IconName;
  color: string;
  parentId: string | null;
  archived: boolean;
  createdAt: string;
}

/** GET /categories returns top-level categories with their subcategories nested. */
export interface CategoryWithChildren extends Category {
  subcategories: Category[];
}

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  bank: BankCode | null;
  color: string;
  icon: IconName;
  initialBalance: number;
  includeInTotal: boolean;
  archived: boolean;
  createdAt: string;
  /** initialBalance + paid movements up to today. */
  balance: number;
  /** balance + pending movements due until the end of the current month. */
  projectedBalance: number;
}

export interface InvoiceSummary {
  cardId: string;
  month: MonthKey;
  closingDate: ISODate;
  dueDate: ISODate;
  total: number;
  unpaidTotal: number;
  status: InvoiceStatus;
}

export interface CreditCard {
  id: string;
  name: string;
  bank: BankCode;
  brand: CardBrand;
  limit: number;
  closingDay: number;
  dueDay: number;
  color: string;
  defaultAccountId: string | null;
  archived: boolean;
  createdAt: string;
  /** Sum of every unpaid purchase/installment on the card. */
  usedLimit: number;
  availableLimit: number;
  /** Invoice that receives purchases made today. */
  currentInvoice: InvoiceSummary;
}

export interface Invoice extends InvoiceSummary {
  card: Pick<CreditCard, 'id' | 'name' | 'bank' | 'brand' | 'color'>;
  transactions: Transaction[];
  /** Payment transfer(s) registered for this invoice. */
  payments: Transaction[];
}

export interface Goal {
  id: string;
  name: string;
  targetAmount: number;
  deadline: ISODate | null;
  icon: IconName;
  color: string;
  accountId: string | null;
  /** Fixed-income title the money is applied to (contributions appear in Investimentos). */
  assetName: string | null;
  notes: string | null;
  archived: boolean;
  createdAt: string;
  /** Sum of contributions (withdrawals are negative). */
  currentAmount: number;
  /** 0..1 (capped). */
  progress: number;
  /** Amount needed per month to reach the target by the deadline (null without deadline). */
  monthlyNeeded: number | null;
  completed: boolean;
}

export interface GoalContribution {
  id: string;
  goalId: string;
  amount: number;
  date: ISODate;
  note: string | null;
  /** Transfer booked with it (Aplicação or Resgate) and the current account on the other side. */
  transferId: string | null;
  /** Investment purchase booked with it (goals with a title). */
  purchaseId: string | null;
  /** Investment sale booked with a withdrawal (goals with a title). */
  saleId: string | null;
  account: { id: string; name: string } | null;
  createdAt: string;
}

export interface Contact {
  id: string;
  name: string;
  /** Digits only (CPF or CNPJ). */
  document: string | null;
  email: string | null;
  /** Digits only. */
  phone: string | null;
  zipCode: string | null;
  street: string | null;
  number: string | null;
  complement: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  notes: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

export interface RefCategory {
  id: string;
  name: string;
  icon: IconName;
  color: string;
}

export interface RefAccount {
  id: string;
  name: string;
  type: AccountType;
  bank: BankCode | null;
  color: string;
}

export interface RefCard {
  id: string;
  name: string;
  bank: BankCode;
  brand: CardBrand;
  color: string;
}

export interface Transaction {
  id: string;
  /**
   * Set on the read-only statement line of an investment sale result (not a real transaction: no
   * edit, delete or pay). The id is the sale's.
   */
  investmentSaleId?: string;
  type: TransactionType;
  description: string;
  amount: number;
  /** Due date / competence date (purchase date for card purchases). */
  date: ISODate;
  paid: boolean;
  paidAt: ISODate | null;
  /** paid && paidAt ? paidAt : date — used by the statement and cash flow. */
  effectiveDate: ISODate;
  /** !paid && date < today */
  overdue: boolean;

  accountId: string | null;
  /** Transfers only: destination account. */
  toAccountId: string | null;
  creditCardId: string | null;
  /** Card purchases and card payments: invoice month 'YYYY-MM'. */
  invoiceMonth: MonthKey | null;
  categoryId: string | null;
  subcategoryId: string | null;
  contactId: string | null;
  paymentMethod: PaymentMethod | null;
  notes: string | null;
  transferKind: TransferKind | null;

  recurrenceId: string | null;
  recurrenceKind: RecurrenceKind;
  frequency: Frequency | null;
  installmentNumber: number | null;
  installmentTotal: number | null;
  /** Position of this occurrence in a recurring/fixed series (1-based). */
  occurrenceNumber: number | null;
  /** Shared by the parts of an amount divided across categories at creation. */
  splitGroupId: string | null;
  /** How the row was created: by hand, from an imported file or synced through Open Finance. */
  origin: TransactionOrigin;
  /** Import batch (file or Open Finance sync) that created the row; undoing the batch removes it. */
  importBatchId: string | null;

  createdAt: string;
  updatedAt: string;

  category: RefCategory | null;
  subcategory: RefCategory | null;
  account: RefAccount | null;
  toAccount: RefAccount | null;
  creditCard: RefCard | null;
  contact: { id: string; name: string } | null;
}

export interface TransactionTotals {
  count: number;
  total: number;
  paid: number;
  pending: number;
  overdue: number;
  overdueCount: number;
}

export interface TransactionListResponse extends Paginated<Transaction> {
  /** Totals of the whole filtered set (not just the page). */
  summary: TransactionTotals & {
    income: number;
    expense: number;
  };
}

// ---------------------------------------------------------------------------
// Statement
// ---------------------------------------------------------------------------

export interface StatementEntry {
  transaction: Transaction;
  /** Signed effect on the selected account(s): + inflow, − outflow, 0 for internal transfers. */
  amount: number;
  /** Running balance after this entry. For pending entries it is the projected running balance. */
  balanceAfter: number;
  pending: boolean;
}

export interface StatementResponse {
  account: Account | null;
  from: ISODate;
  to: ISODate;
  /** Paid balance at the end of the day before `from`. */
  openingBalance: number;
  /** Opening + paid entries in the period. */
  closingBalance: number;
  /** Opening + paid + pending entries in the period. */
  projectedClosingBalance: number;
  totalIn: number;
  totalOut: number;
  pendingIn: number;
  pendingOut: number;
  entries: StatementEntry[];
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export type InsightKind = 'opportunity' | 'warning' | 'achievement' | 'info';

export interface Insight {
  kind: InsightKind;
  title: string;
  description: string;
  /** Optional deep link inside the web app, e.g. '/relatorios?tab=categorias'. */
  href?: string;
}

export interface CategoryAmount {
  categoryId: string | null;
  name: string;
  icon: IconName;
  color: string;
  amount: number;
  /** 0..1 share of the total. */
  share: number;
}

export interface MonthSummary {
  month: MonthKey;
  income: number;
  expense: number;
  net: number;
  /** net / income (0..1, may be negative); null without income. */
  savingsRate: number | null;
  paidIncome: number;
  paidExpense: number;
  pendingIncome: number;
  pendingExpense: number;
}

export interface HealthScore {
  /** 0..1000 */
  score: number;
  label: 'Crítica' | 'Atenção' | 'Saudável' | 'Excelente';
  factors: { label: string; score: number; max: number; hint: string }[];
}

export interface DashboardResponse {
  month: MonthKey;
  balances: {
    /** Non-investment accounts with includeInTotal. */
    accounts: number;
    investments: number;
    /** Unpaid card purchases. */
    cardDebt: number;
    /** accounts + investments − cardDebt */
    netWorth: number;
  };
  summary: MonthSummary;
  previous: MonthSummary;
  /** Last 6 months (competence), oldest first. */
  monthly: MonthSummary[];
  expensesByCategory: CategoryAmount[];
  incomeByCategory: CategoryAmount[];
  /** Pending transactions overdue or due in the next 15 days. */
  upcoming: Transaction[];
  overdue: { count: number; amount: number };
  fixedExpenses: Transaction[];
  fixedIncome: Transaction[];
  goals: Goal[];
  cards: CreditCard[];
  accounts: Account[];
  health: HealthScore;
  insights: Insight[];
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export interface ReportPeriod {
  key: string;
  label: string;
  start: ISODate;
  end: ISODate;
  /** Period starts after today (values come from scheduled/pending items). */
  projected: boolean;
}

export interface CategorySeries {
  categoryId: string | null;
  name: string;
  icon: IconName;
  color: string;
  total: number;
  share: number;
  /** One value per period (same order as `periods`). */
  values: number[];
  /** Monthly average across the periods with data. */
  average: number;
}

export interface CategoryReportResponse {
  type: CategoryType;
  periods: ReportPeriod[];
  series: CategorySeries[];
  totals: number[];
  total: number;
}

export interface EvolutionPeriod {
  key: string;
  /** "Nov/26", "4º tri/26", "2026". */
  label: string;
  start: ISODate;
  end: ISODate;
  /** Today falls inside the period: values are still coming in. */
  current: boolean;
}

export interface EvolutionRow {
  /** null = "Sem categoria" (or "Sem subcategoria" inside a category). */
  categoryId: string | null;
  name: string;
  icon: IconName;
  color: string;
  /** One value per period (same order as `periods`), in cents. */
  values: number[];
  total: number;
  /** total / `activePeriods` of the report. */
  average: number;
  /** Subcategories, only when the category has amounts in at least one of them. */
  children: EvolutionRow[];
}

export interface EvolutionGroup {
  rows: EvolutionRow[];
  values: number[];
  total: number;
  average: number;
}

export interface EvolutionReportResponse {
  periods: EvolutionPeriod[];
  /** Periods with any income or expense; averages divide by it (min. 1). */
  activePeriods: number;
  income: EvolutionGroup;
  expense: EvolutionGroup;
  /** income − expense per period. */
  result: number[];
}

export interface ContactSeries {
  contactId: string | null;
  name: string;
  income: number;
  expense: number;
  net: number;
  count: number;
  incomeValues: number[];
  expenseValues: number[];
}

export interface ContactReportResponse {
  periods: ReportPeriod[];
  items: ContactSeries[];
}

export interface PeriodTotals {
  from: ISODate;
  to: ISODate;
  income: number;
  expense: number;
  net: number;
  count: number;
}

export interface ComparisonRow {
  categoryId: string | null;
  name: string;
  icon: IconName;
  color: string;
  a: number;
  b: number;
  diff: number;
  /** (b − a) / a; null when a = 0. */
  diffPercent: number | null;
}

export interface ComparisonReportResponse {
  type: CategoryType;
  a: PeriodTotals;
  b: PeriodTotals;
  rows: ComparisonRow[];
}

export interface CashflowPeriod extends ReportPeriod {
  inflow: number;
  outflow: number;
  net: number;
  /** Running balance at the end of the period (realized + projected). */
  balance: number;
  realizedInflow: number;
  realizedOutflow: number;
  pendingInflow: number;
  pendingOutflow: number;
}

export interface CashflowReportResponse {
  openingBalance: number;
  closingBalance: number;
  periods: CashflowPeriod[];
}

export interface OverviewReportResponse {
  from: ISODate;
  to: ISODate;
  income: number;
  expense: number;
  net: number;
  savingsRate: number | null;
  /** expense / days in range */
  averageDailyExpense: number;
  fixedExpense: number;
  variableExpense: number;
  installmentExpense: number;
  byPaymentMethod: { method: PaymentMethod | null; label: string; amount: number; share: number }[];
  topExpenses: Transaction[];
  topCategories: CategoryAmount[];
  insights: Insight[];
}

export interface SearchResponse {
  transactions: Transaction[];
  accounts: Account[];
  categories: Category[];
  contacts: Contact[];
}

// ---------------------------------------------------------------------------
// Investments
// ---------------------------------------------------------------------------

export interface InvestmentPurchase {
  id: string;
  assetType: AssetType;
  ticker: string;
  name: string | null;
  accountId: string | null;
  account: { id: string; name: string; bank: BankCode | null; color: string } | null;
  /** Account the money came from (the linked Aplicação), when there is one. */
  paidFrom: { id: string; name: string; bank: BankCode | null; color: string } | null;
  /** The linked Aplicação (transfer); null when the money was already at the broker. */
  transferId: string | null;
  date: ISODate;
  quantity: number;
  /** Cents per unit. */
  unitPrice: number;
  /** Cents. */
  fees: number;
  /** quantity × unitPrice + fees, in cents. */
  total: number;
  createdAt: string;
}

export interface InvestmentSale {
  id: string;
  ticker: string;
  accountId: string | null;
  account: { id: string; name: string; bank: BankCode | null; color: string } | null;
  date: ISODate;
  quantity: number;
  /** Sale price per unit, in cents. */
  unitPrice: number;
  fees: number;
  /** What the units sold had cost (average price × quantity), in cents. */
  cost: number;
  /** quantity × unitPrice − fees: what stayed at the broker. */
  proceeds: number;
  /** proceeds − cost: profit (+) or loss (−). Changes the broker balance, not income/expenses. */
  result: number;
  createdAt: string;
}

export interface InvestmentIncome {
  id: string;
  kind: InvestmentIncomeKind;
  ticker: string | null;
  accountId: string | null;
  account: { id: string; name: string; bank: BankCode | null; color: string } | null;
  date: ISODate;
  amount: number;
  /** Income transaction ("Rendimentos") at the broker account. */
  transactionId: string | null;
  createdAt: string;
}

/** Everything bought of one asset (same ticker). */
export interface InvestmentPosition {
  ticker: string;
  name: string | null;
  assetType: AssetType;
  quantity: number;
  /** Total paid (fees included), in cents. */
  totalInvested: number;
  /** totalInvested / quantity, in cents. */
  averagePrice: number;
  purchases: number;
  firstDate: ISODate;
  lastDate: ISODate;
  /** Share of the portfolio's total invested (0–1). */
  share: number;
  /** Profit/loss of the sales of this asset (cents). */
  realizedResult: number;
  /** Income received from this asset (cents). */
  incomes: number;
}

export interface InvestmentBroker {
  id: string;
  name: string;
  bank: BankCode | null;
  color: string;
  /** Total paid for the purchases at this broker (cents). */
  invested: number;
  /** Distinct assets bought at this broker. */
  assets: number;
  /** Money at the broker not in assets: account balance − cost of the assets held there. */
  available: number;
}

export interface InvestmentPortfolioResponse {
  positions: InvestmentPosition[];
  /** Investment accounts (brokers), the default "Carteira" included once it exists. */
  brokers: InvestmentBroker[];
  /** Newest first. */
  purchases: InvestmentPurchase[];
  /** Newest first. */
  sales: InvestmentSale[];
  /** Newest first. */
  incomes: InvestmentIncome[];
  totalInvested: number;
  /** Sum of the brokers' available money. */
  available: number;
  /** Sales result of all time (cents). */
  realizedResult: number;
  /** Income received in the current year (cents). */
  incomesYear: number;
}
