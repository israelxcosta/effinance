import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Category, CategoryInput, CategoryType, CategoryUpdateInput, CategoryWithChildren } from '@effinance/shared';
import { api } from '@/lib/api';
import { invalidateFinancialData, qk } from '@/lib/query-keys';

export function useCategories(params: { type?: CategoryType; includeArchived?: boolean } = {}) {
  return useQuery({
    queryKey: qk.categories(params),
    queryFn: () => api<CategoryWithChildren[]>('/categories', { query: params }),
    staleTime: 60_000,
  });
}

export function useCreateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CategoryInput) => api<Category>('/categories', { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] }),
  });
}

export function useUpdateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: CategoryUpdateInput }) =>
      api<Category>(`/categories/${id}`, { method: 'PUT', body: input }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['categories'] });
      await invalidateFinancialData(qc);
    },
  });
}

export function useDeleteCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/categories/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] }),
  });
}
