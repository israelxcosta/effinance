import type { QueryClient } from '@tanstack/react-query';

type Params = Record<string, unknown> | undefined;

/** Centralized query keys. The first segment is the "domain" used for invalidation. */
export const qk = {
  me: ['me'] as const,
  categories: (params?: Params) => ['categories', params ?? {}] as const,
  accounts: (params?: Params) => ['accounts', params ?? {}] as const,
  cards: (params?: Params) => ['credit-cards', params ?? {}] as const,
  invoices: (cardId: string, params?: Params) => ['credit-cards', cardId, 'invoices', params ?? {}] as const,
  invoice: (cardId: string, month: string) => ['credit-cards', cardId, 'invoice', month] as const,
  goals: () => ['goals'] as const,
  goalContributions: (goalId: string) => ['goals', goalId, 'contributions'] as const,
  contacts: (params?: Params) => ['contacts', params ?? {}] as const,
  contact: (id: string) => ['contacts', 'detail', id] as const,
  transactions: (params?: Params) => ['transactions', params ?? {}] as const,
  transaction: (id: string) => ['transactions', 'detail', id] as const,
  transfers: (params?: Params) => ['transfers', params ?? {}] as const,
  statement: (params?: Params) => ['statement', params ?? {}] as const,
  dashboard: (month: string) => ['dashboard', month] as const,
  report: (name: string, params?: Params) => ['reports', name, params ?? {}] as const,
  search: (q: string) => ['search', q] as const,
};

/** Everything derived from transactions/balances. Called after any money-moving mutation. */
export function invalidateFinancialData(qc: QueryClient): Promise<unknown> {
  const domains = [
    'transactions',
    'transfers',
    'statement',
    'dashboard',
    'reports',
    'accounts',
    'credit-cards',
    'goals',
    'search',
  ];
  return Promise.all(domains.map((d) => qc.invalidateQueries({ queryKey: [d] })));
}
