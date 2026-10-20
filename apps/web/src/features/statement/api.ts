import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { StatementResponse } from '@effinance/shared';
import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';

export function useStatement(params: { accountId?: string; from: string; to: string; includePending?: boolean }) {
  return useQuery({
    queryKey: qk.statement(params),
    queryFn: () => api<StatementResponse>('/statement', { query: params }),
    placeholderData: keepPreviousData,
  });
}
