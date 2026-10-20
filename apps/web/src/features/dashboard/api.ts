import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { DashboardResponse } from '@effinance/shared';
import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';

export function useDashboard(month: string) {
  return useQuery({
    queryKey: qk.dashboard(month),
    queryFn: () => api<DashboardResponse>('/dashboard', { query: { month } }),
    placeholderData: keepPreviousData,
  });
}
