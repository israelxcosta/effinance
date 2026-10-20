import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Paginated, Transaction, TransferInput, TransferKind } from '@effinance/shared';
import { api } from '@/lib/api';
import { invalidateFinancialData, qk } from '@/lib/query-keys';

export interface TransferParams {
  from?: string;
  to?: string;
  accountId?: string;
  kind?: TransferKind;
  page?: number;
  pageSize?: number;
}

export function useTransfers(params: TransferParams) {
  return useQuery({
    queryKey: qk.transfers(params as Record<string, unknown>),
    queryFn: () => api<Paginated<Transaction>>('/transfers', { query: params as Record<string, string | number | undefined> }),
    placeholderData: keepPreviousData,
  });
}

export function useSaveTransfer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: TransferInput }) =>
      id
        ? api<Transaction>(`/transfers/${id}`, { method: 'PUT', body: input })
        : api<Transaction>('/transfers', { method: 'POST', body: input }),
    onSuccess: () => invalidateFinancialData(qc),
  });
}

export function useDeleteTransfer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/transfers/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidateFinancialData(qc),
  });
}
