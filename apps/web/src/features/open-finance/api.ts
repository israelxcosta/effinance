import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BankConnection,
  ConnectTokenInput,
  ConnectTokenResponse,
  CreateConnectionInput,
  FakeConnectResponse,
  FakeInstitution,
  LinkAccountsInput,
  OpenFinanceStatus,
  SyncResult,
} from '@effinance/shared';
import { api, ApiRequestError } from '@/lib/api';
import { invalidateFinancialData, qk } from '@/lib/query-keys';

const path = (id: string, suffix = '') => `/open-finance/connections/${encodeURIComponent(id)}${suffix}`;

/** Whether the workspace can connect banks. Missing endpoint / errors → feature hidden. */
export function useOpenFinanceStatus(active = true) {
  const query = useQuery({
    queryKey: qk.openFinanceStatus,
    queryFn: () => api<OpenFinanceStatus>('/open-finance/status'),
    enabled: active,
    staleTime: 5 * 60_000,
    retry: (count, error) => !(error instanceof ApiRequestError && error.status < 500) && count < 2,
  });
  return { ...query, enabled: query.data?.enabled === true };
}

export function useBankConnections(enabled = true) {
  return useQuery({
    queryKey: qk.bankConnections,
    queryFn: () => api<BankConnection[]>('/open-finance/connections'),
    enabled,
    // The first sync runs in the background on the aggregator: poll while any connection is syncing.
    refetchInterval: (query) => (query.state.data?.some((c) => c.status === 'syncing') ? 5000 : false),
  });
}

export function useConnectToken() {
  return useMutation({
    mutationFn: (input: ConnectTokenInput) => api<ConnectTokenResponse>('/open-finance/connect-token', { method: 'POST', body: input }),
  });
}

/** Simulated provider (development, tests, demo): test institutions. */
export function useFakeInstitutions(enabled: boolean) {
  return useQuery({
    queryKey: qk.fakeInstitutions,
    queryFn: () => api<FakeInstitution[]>('/open-finance/dev/institutions'),
    enabled,
    staleTime: Infinity,
  });
}

export function useFakeConnect() {
  return useMutation({
    mutationFn: (institutionId: string) =>
      api<FakeConnectResponse>('/open-finance/dev/connect', { method: 'POST', body: { institutionId } }),
  });
}

export function useCreateConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateConnectionInput) => api<BankConnection>('/open-finance/connections', { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.bankConnections }),
  });
}

export function useLinkAccounts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: LinkAccountsInput }) =>
      api<BankConnection>(path(id, '/accounts'), { method: 'PUT', body: input }),
    // "Criar nova" creates local accounts/cards.
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: qk.bankConnections });
      await invalidateFinancialData(qc);
    },
  });
}

export function useSyncConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<SyncResult>(path(id, '/sync'), { method: 'POST' }),
    onSuccess: async (result) => {
      qc.setQueryData<BankConnection[]>(qk.bankConnections, (old) =>
        old?.map((c) => (c.id === result.connection.id ? result.connection : c)),
      );
      await qc.invalidateQueries({ queryKey: qk.bankConnections });
      await invalidateFinancialData(qc);
    },
  });
}

/** Revokes the consent with the aggregator; imported transactions stay. */
export function useDeleteConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(path(id), { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.bankConnections }),
  });
}
