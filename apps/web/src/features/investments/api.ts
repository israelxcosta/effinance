import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  InvestmentIncome,
  InvestmentIncomeInput,
  InvestmentPortfolioResponse,
  InvestmentPurchase,
  InvestmentPurchaseInput,
  InvestmentSale,
  InvestmentSaleInput,
} from '@effinance/shared';
import { api } from '@/lib/api';

const KEY = ['investments'] as const;

export function usePortfolio() {
  return useQuery({ queryKey: KEY, queryFn: () => api<InvestmentPortfolioResponse>('/investments') });
}

export function useSavePurchase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: InvestmentPurchaseInput }) =>
      id
        ? api<InvestmentPurchase>(`/investments/purchases/${id}`, { method: 'PUT', body: input })
        : api<InvestmentPurchase>('/investments/purchases', { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeletePurchase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/investments/purchases/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** Sales and income change broker balances, the statement and reports: refresh everything. */
function useInvalidateAll() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries();
}

export function useCreateSale() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (input: InvestmentSaleInput) => api<InvestmentSale>('/investments/sales', { method: 'POST', body: input }),
    onSuccess: invalidate,
  });
}

export function useDeleteSale() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/investments/sales/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}

export function useCreateIncome() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (input: InvestmentIncomeInput) => api<InvestmentIncome>('/investments/incomes', { method: 'POST', body: input }),
    onSuccess: invalidate,
  });
}

export function useDeleteIncome() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/investments/incomes/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}

const qty = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 8 });
/** 1500 → "1.500"; 0.015 → "0,015". */
export const formatQuantity = (q: number) => qty.format(q);

/** "1.234,5" / "0,015" / "0.015" → number (NaN when invalid). */
export function parseQuantity(text: string): number {
  const t = text.trim().replace(/\s/g, '');
  if (!t) return Number.NaN;
  // With a comma, dots are thousands separators. Without one, "1.500" (dot + 3 digits, not starting
  // with 0) is read the Brazilian way (1500); "0.015" and "1.5" are decimals.
  const thousands = /^[1-9]\d{0,2}(\.\d{3})+$/.test(t);
  const normalized = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : thousands ? t.replace(/\./g, '') : t;
  return /^\d*\.?\d+$/.test(normalized) || /^\d+\.$/.test(normalized) ? Number(normalized) : Number.NaN;
}
