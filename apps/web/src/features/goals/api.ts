import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Goal, GoalContribution, GoalContributionInput, GoalInput } from '@effinance/shared';
import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';

export function useGoals() {
  return useQuery({ queryKey: qk.goals(), queryFn: () => api<Goal[]>('/goals') });
}

export function useGoalContributions(goalId: string | undefined) {
  return useQuery({
    queryKey: qk.goalContributions(goalId ?? ''),
    queryFn: () => api<GoalContribution[]>(`/goals/${goalId}/contributions`),
    enabled: Boolean(goalId),
  });
}

function useInvalidateGoals() {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: ['goals'] }), qc.invalidateQueries({ queryKey: ['dashboard'] })]);
}

export function useSaveGoal() {
  const invalidate = useInvalidateGoals();
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: GoalInput }) =>
      id ? api<Goal>(`/goals/${id}`, { method: 'PUT', body: input }) : api<Goal>('/goals', { method: 'POST', body: input }),
    onSuccess: invalidate,
  });
}

export function useDeleteGoal() {
  const invalidate = useInvalidateGoals();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/goals/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}

export function useAddContribution() {
  const invalidate = useInvalidateGoals();
  return useMutation({
    mutationFn: ({ goalId, input }: { goalId: string; input: GoalContributionInput }) =>
      api<GoalContribution>(`/goals/${goalId}/contributions`, { method: 'POST', body: input }),
    onSuccess: invalidate,
  });
}

export function useDeleteContribution() {
  const invalidate = useInvalidateGoals();
  return useMutation({
    mutationFn: ({ goalId, contributionId }: { goalId: string; contributionId: string }) =>
      api<void>(`/goals/${goalId}/contributions/${contributionId}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}
