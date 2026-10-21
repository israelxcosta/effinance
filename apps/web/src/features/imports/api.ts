import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ImportBatch,
  ImportCommitInput,
  ImportCommitResponse,
  ImportPreview,
  ImportPreviewInput,
  Paginated,
} from '@effinance/shared';
import { api } from '@/lib/api';
import { invalidateFinancialData, qk } from '@/lib/query-keys';

/** Parses the decoded file (no writes): rows, duplicates, suggested categories, CSV mapping. */
export function previewImport(input: ImportPreviewInput, signal?: AbortSignal): Promise<ImportPreview> {
  return api<ImportPreview>('/imports/preview', { method: 'POST', body: input, signal });
}

export function useImportPreview() {
  return useMutation({ mutationFn: (input: ImportPreviewInput) => previewImport(input) });
}

export function useCommitImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ImportCommitInput) => api<ImportCommitResponse>('/imports', { method: 'POST', body: input }),
    // Statement, invoices, dashboard, reports, balances and the batch history.
    onSuccess: () => invalidateFinancialData(qc),
  });
}

/** Removes the transactions of a batch that still exist. */
export function useUndoImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<unknown>(`/imports/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: () => invalidateFinancialData(qc),
  });
}

export function useImportBatches(params: { page: number; pageSize: number }) {
  return useQuery({
    queryKey: qk.imports(params),
    queryFn: () => api<Paginated<ImportBatch>>('/imports', { query: params }),
    placeholderData: keepPreviousData,
  });
}
