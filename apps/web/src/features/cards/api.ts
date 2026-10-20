import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreditCard, CreditCardInput, Invoice, InvoiceSummary, PayInvoiceInput } from '@effinance/shared';
import { api } from '@/lib/api';
import { invalidateFinancialData, qk } from '@/lib/query-keys';

export function useCards(params: { includeArchived?: boolean } = {}) {
  return useQuery({
    queryKey: qk.cards(params),
    queryFn: () => api<CreditCard[]>('/credit-cards', { query: { includeArchived: params.includeArchived } }),
  });
}

export function useInvoices(cardId: string | undefined, range: { from: string; to: string }) {
  return useQuery({
    queryKey: qk.invoices(cardId ?? '', range),
    queryFn: () => api<InvoiceSummary[]>(`/credit-cards/${cardId}/invoices`, { query: range }),
    enabled: Boolean(cardId),
    placeholderData: keepPreviousData,
  });
}

export function useInvoice(cardId: string | undefined, month: string) {
  return useQuery({
    queryKey: qk.invoice(cardId ?? '', month),
    queryFn: () => api<Invoice>(`/credit-cards/${cardId}/invoices/${month}`),
    enabled: Boolean(cardId),
    placeholderData: keepPreviousData,
  });
}

export function useSaveCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: CreditCardInput }) =>
      id
        ? api<CreditCard>(`/credit-cards/${id}`, { method: 'PUT', body: input })
        : api<CreditCard>('/credit-cards', { method: 'POST', body: input }),
    onSuccess: () => invalidateFinancialData(qc),
  });
}

export function useDeleteCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/credit-cards/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidateFinancialData(qc),
  });
}

export function usePayInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ cardId, month, input }: { cardId: string; month: string; input: PayInvoiceInput }) =>
      api<Invoice>(`/credit-cards/${cardId}/invoices/${month}/pay`, { method: 'POST', body: input }),
    onSuccess: () => invalidateFinancialData(qc),
  });
}
