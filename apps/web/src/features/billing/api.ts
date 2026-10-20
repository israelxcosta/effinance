import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CheckoutResponse, Plan, PlanCode, Subscription } from '@effinance/shared';
import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';

export function usePlans() {
  return useQuery({ queryKey: qk.plans, queryFn: () => api<Plan[]>('/billing/plans'), staleTime: 60 * 60_000 });
}

export function useSubscription() {
  return useQuery({ queryKey: qk.subscription, queryFn: () => api<Subscription>('/billing/subscription') });
}

/** Subscription changes also change `canWrite` in `GET /auth/me`. */
function useInvalidateBilling() {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: ['billing'] }), qc.invalidateQueries({ queryKey: qk.me })]);
}

export function useCheckout() {
  return useMutation({
    mutationFn: (planCode: PlanCode) => api<CheckoutResponse>('/billing/checkout', { method: 'POST', body: { planCode } }),
  });
}

export function useCancelSubscription() {
  const invalidate = useInvalidateBilling();
  return useMutation({
    mutationFn: () => api<Subscription>('/billing/cancel', { method: 'POST' }),
    onSuccess: invalidate,
  });
}

/** Fake billing provider only (development / demo): simulates the payment being approved. */
export function useDevActivate() {
  const invalidate = useInvalidateBilling();
  return useMutation({
    mutationFn: (planCode: PlanCode) => api<Subscription>('/billing/dev/activate', { method: 'POST', body: { planCode } }),
    onSuccess: invalidate,
  });
}
