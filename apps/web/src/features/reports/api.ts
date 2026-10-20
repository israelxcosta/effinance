import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type {
  CashflowReportQuery,
  CashflowReportResponse,
  CategoryReportQuery,
  CategoryReportResponse,
  ComparisonReportQuery,
  ComparisonReportResponse,
  ContactReportQuery,
  ContactReportResponse,
  OverviewReportQuery,
  OverviewReportResponse,
} from '@effinance/shared';
import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';

type Q = Record<string, string | number | boolean | undefined>;

function useReport<T>(name: string, params: object, enabled = true) {
  return useQuery({
    queryKey: qk.report(name, params as Record<string, unknown>),
    queryFn: () => api<T>(`/reports/${name}`, { query: params as Q }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export const useOverviewReport = (p: OverviewReportQuery) => useReport<OverviewReportResponse>('overview', p);
export const useCategoryReport = (p: CategoryReportQuery) => useReport<CategoryReportResponse>('categories', p);
export const useContactReport = (p: ContactReportQuery) => useReport<ContactReportResponse>('contacts', p);
export const useComparisonReport = (p: ComparisonReportQuery) => useReport<ComparisonReportResponse>('comparison', p);
export const useCashflowReport = (p: CashflowReportQuery, enabled = true) =>
  useReport<CashflowReportResponse>('cashflow', p, enabled);
