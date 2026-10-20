import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  SeriesScope,
  SetPaidInput,
  Transaction,
  TransactionInput,
  TransactionListResponse,
  TransactionQuery,
  TransactionUpdateInput,
} from '@effinance/shared';
import { api } from '@/lib/api';
import { invalidateFinancialData, qk } from '@/lib/query-keys';

export function useTransactions(params: TransactionQuery, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: qk.transactions(params as Record<string, unknown>),
    queryFn: () => api<TransactionListResponse>('/transactions', { query: params as Record<string, string | number | undefined> }),
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });
}

export function useCreateTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TransactionInput) => api<Transaction[]>('/transactions', { method: 'POST', body: input }),
    onSuccess: () => invalidateFinancialData(qc),
  });
}

export function useUpdateTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input, scope }: { id: string; input: TransactionUpdateInput; scope: SeriesScope }) =>
      api<Transaction>(`/transactions/${id}`, { method: 'PUT', body: input, query: { scope } }),
    onSuccess: () => invalidateFinancialData(qc),
  });
}

export function useDeleteTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, scope }: { id: string; scope: SeriesScope }) =>
      api<void>(`/transactions/${id}`, { method: 'DELETE', query: { scope } }),
    onSuccess: () => invalidateFinancialData(qc),
  });
}

export function useSetPaid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: SetPaidInput }) =>
      api<Transaction>(`/transactions/${id}/paid`, { method: 'PATCH', body: input }),
    onSuccess: () => invalidateFinancialData(qc),
  });
}
