import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Contact, ContactInput, Paginated } from '@effinance/shared';
import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';

export function useContacts(params: { search?: string; page?: number; pageSize?: number } = {}) {
  return useQuery({
    queryKey: qk.contacts(params),
    queryFn: () => api<Paginated<Contact>>('/contacts', { query: params }),
    placeholderData: keepPreviousData,
  });
}

/** Up to 200 contacts for selects. */
export function useContactOptions() {
  return useContacts({ pageSize: 200 });
}

export function useSaveContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: ContactInput }) =>
      id
        ? api<Contact>(`/contacts/${id}`, { method: 'PUT', body: input })
        : api<Contact>('/contacts', { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['contacts'] }),
  });
}

export function useDeleteContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/contacts/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['contacts'] });
      await qc.invalidateQueries({ queryKey: ['transactions'] });
    },
  });
}
