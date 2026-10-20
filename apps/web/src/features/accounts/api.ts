import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Account, AccountInput } from '@effinance/shared';
import { api } from '@/lib/api';
import { invalidateFinancialData, qk } from '@/lib/query-keys';

export function useAccounts(params: { includeArchived?: boolean } = {}) {
  return useQuery({
    queryKey: qk.accounts(params),
    queryFn: () => api<Account[]>('/accounts', { query: { includeArchived: params.includeArchived } }),
    placeholderData: keepPreviousData,
  });
}

export function useSaveAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: AccountInput }) =>
      id
        ? api<Account>(`/accounts/${id}`, { method: 'PUT', body: input })
        : api<Account>('/accounts', { method: 'POST', body: input }),
    onSuccess: () => invalidateFinancialData(qc),
  });
}

export function useDeleteAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/accounts/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidateFinancialData(qc),
  });
}
