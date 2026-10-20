import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { Check, CreditCard, Lock, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import {
  formatBRL,
  formatDateBR,
  getPlan,
  PLAN_CODES,
  SUBSCRIPTION_STATUS_LABELS,
  type Plan,
  type PlanCode,
  type Subscription,
  type SubscriptionStatus,
} from '@effinance/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { ErrorState } from '@/components/ui/misc';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { toastError } from '@/lib/notify';
import { resolveCheckoutUrl } from '@/lib/safe-url';
import { useAuth } from '@/features/auth/auth-context';
import { usePermissions } from '@/features/auth/permissions';
import { daysUntil } from '@/features/billing/subscription-banner';
import { useCancelSubscription, useCheckout, useDevActivate, usePlans, useSubscription } from '@/features/billing/api';
import { Cell, TabGrid } from './layout';

const STATUS_TONE: Record<SubscriptionStatus, 'brand' | 'success' | 'warning' | 'danger' | 'neutral'> = {
  trialing: 'brand',
  pending: 'neutral',
  active: 'success',
  past_due: 'warning',
  canceled: 'danger',
  expired: 'danger',
};

const OWNER_ONLY = 'Somente o proprietário do espaço gerencia a assinatura.';

const date = (iso: string | null) => (iso ? formatDateBR(iso.slice(0, 10)) : '—');

export function SubscriptionTab() {
  const subscription = useSubscription();
  const plans = usePlans();
  useSimulatedCheckout();

  if (subscription.isPending) return <Skeleton className="h-48 rounded-xl" />;
  if (subscription.isError) return <ErrorState error={subscription.error} onRetry={() => subscription.refetch()} />;

  return (
    <TabGrid>
      <Cell wide>
        <CurrentPlanCard sub={subscription.data} />
      </Cell>
      <Cell wide>
        {plans.isError ? (
          <ErrorState error={plans.error} onRetry={() => plans.refetch()} />
        ) : (
          <PlansCard sub={subscription.data} plans={plans.data} />
        )}
      </Cell>
      <Cell wide>
        <p className="flex items-center gap-2 text-xs text-muted">
          <Lock className="size-3.5 shrink-0" aria-hidden />
          Pagamento processado com segurança pelo Mercado Pago. O Effinance não armazena dados do seu cartão.
        </p>
      </Cell>
    </TabGrid>
  );
}

/**
 * Fake billing provider (development / demo): checkout returns to `?aba=assinatura&simular=<plan>`,
 * which stands in for the payment being approved.
 */
function useSimulatedCheckout() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const activate = useDevActivate();
  const handled = useRef<string | null>(null);
  const simulate = params.get('simular');
  // Set by `subscribe()` below when it routes here: a link someone sent (`?simular=`) carries no
  // router state, so it can't fire the activation by itself (CSRF through a crafted URL).
  const intended = (location.state as { simulatedCheckout?: unknown } | null)?.simulatedCheckout;
  const { mutate } = activate;

  useEffect(() => {
    if (!simulate || handled.current === simulate) return;
    handled.current = simulate;
    setParams({ aba: 'assinatura' }, { replace: true });
    if (intended !== simulate || !(PLAN_CODES as readonly string[]).includes(simulate)) return;
    mutate(simulate as PlanCode, {
      onSuccess: (sub) => toast.success(`Assinatura ${sub.plan?.name ?? ''} ativada. Obrigado!`),
      onError: toastError,
    });
  }, [simulate, intended, setParams, mutate]);
}

function CurrentPlanCard({ sub }: { sub: Subscription }) {
  const { isOwner } = usePermissions();
  const cancel = useCancelSubscription();
  const [confirming, setConfirming] = useState(false);
  const plan = sub.plan ?? getPlan(sub.planCode) ?? null;
  const trialDays = daysUntil(sub.trialEndsAt);
  const canCancel = isOwner && (sub.status === 'active' || sub.status === 'past_due') && !sub.cancelAtPeriodEnd;

  let detail: string;
  switch (sub.status) {
    case 'trialing':
      detail =
        trialDays === null
          ? 'Período de teste com todos os recursos.'
          : `Seu teste termina ${trialDays === 0 ? 'hoje' : `em ${trialDays} ${trialDays === 1 ? 'dia' : 'dias'}`} (${date(sub.trialEndsAt)}). Assine para não perder o acesso de edição.`;
      break;
    case 'active':
      detail = sub.cancelAtPeriodEnd
        ? `Cancelada: o acesso completo continua até ${date(sub.currentPeriodEnd)}.`
        : `Renovação automática em ${date(sub.currentPeriodEnd)}.`;
      break;
    case 'past_due':
      detail = 'Não conseguimos cobrar a última fatura. Atualize o pagamento no Mercado Pago para manter o acesso.';
      break;
    case 'pending':
      detail = 'Aguardando a confirmação do pagamento pelo Mercado Pago.';
      break;
    default:
      detail = 'Assinatura inativa: o espaço está em modo somente leitura. Consulta e exportação continuam disponíveis.';
  }

  return (
    <Card className="p-6">
      <CardHeader
        title="Plano atual"
        subtitle={sub.provider === 'fake' ? 'Cobrança simulada (ambiente de testes)' : sub.provider === 'mercadopago' ? 'Cobrança recorrente via Mercado Pago' : undefined}
        action={<Badge tone={STATUS_TONE[sub.status]} size="md">{SUBSCRIPTION_STATUS_LABELS[sub.status]}</Badge>}
      />
      <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-2xl font-semibold tracking-tight">{plan ? plan.name : 'Teste grátis'}</p>
          {plan ? (
            <p className="tabular text-sm text-muted">
              {formatBRL(plan.priceCents)} / {plan.interval === 'year' ? 'ano' : 'mês'}
            </p>
          ) : null}
          <p className="mt-2 max-w-xl text-[13px] text-muted">{detail}</p>
        </div>
        {canCancel ? (
          <Button variant="ghost" onClick={() => setConfirming(true)}>
            Cancelar assinatura
          </Button>
        ) : null}
      </div>
      {sub.maxMembers > 1 ? (
        <div className="mt-5 max-w-sm">
          <div className="mb-1.5 flex justify-between text-xs">
            <span className="font-medium text-muted">Membros</span>
            <span className="tabular font-semibold">
              {sub.memberCount} de {sub.maxMembers}
            </span>
          </div>
          <ProgressBar value={sub.memberCount / sub.maxMembers} tone={sub.memberCount >= sub.maxMembers ? 'warning' : 'brand'} label="Membros do plano" />
        </div>
      ) : null}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Cancelar assinatura?"
        description={`Não haverá novas cobranças. O acesso completo continua até ${date(sub.currentPeriodEnd)}; depois, o espaço fica somente para consulta e exportação.`}
        confirmLabel="Cancelar assinatura"
        loading={cancel.isPending}
        onConfirm={async () => {
          try {
            await cancel.mutateAsync();
            toast.success('Assinatura cancelada. Você não será cobrado novamente.');
            setConfirming(false);
          } catch (error) {
            toastError(error);
          }
        }}
      />
    </Card>
  );
}

function PlansCard({ sub, plans }: { sub: Subscription; plans: Plan[] | undefined }) {
  const { workspace } = useAuth();
  const { isOwner } = usePermissions();
  const checkout = useCheckout();
  const navigate = useNavigate();
  const [pending, setPending] = useState<PlanCode | null>(null);
  const available = (plans ?? []).filter((p) => !workspace || p.workspaceKinds.includes(workspace.kind));
  const paying = sub.status === 'active' || sub.status === 'past_due' || sub.status === 'pending';

  async function subscribe(plan: Plan) {
    setPending(plan.code);
    try {
      const { checkoutUrl } = await checkout.mutateAsync(plan.code);
      // Only the payment provider (https allowlist) or a screen of this app — never `javascript:`
      // or another host, even if the API response is tampered with.
      const target = resolveCheckoutUrl(checkoutUrl, window.location.href);
      if (!target) toast.error('Link de pagamento inválido. Tente novamente em instantes.');
      // The fake provider returns to this screen; keep it inside the router (also in the hash-routed demo).
      else if (target.kind === 'internal') navigate(target.path, { state: { simulatedCheckout: plan.code } });
      else window.location.assign(target.href);
    } catch (error) {
      toastError(error);
    } finally {
      setPending(null);
    }
  }

  return (
    <Card className="p-6">
      <CardHeader
        title={paying ? 'Mudar de plano' : 'Escolha um plano'}
        subtitle="Cancele quando quiser. Os valores são cobrados em reais, com renovação automática."
        icon={<CreditCard />}
      />
      {!plans ? (
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <Skeleton className="h-56 rounded-xl" />
          <Skeleton className="h-56 rounded-xl" />
        </div>
      ) : available.length === 0 ? (
        <p className="mt-4 text-sm text-muted">Nenhum plano disponível para este tipo de espaço.</p>
      ) : (
        <div className={cn('mt-5 grid gap-4', available.length > 1 && 'md:grid-cols-2')}>
          {available.map((plan) => {
            const current = paying && sub.planCode === plan.code;
            const best = plan.interval === 'year';
            const button = (
              <Button
                className="w-full"
                variant={current ? 'outline' : best ? 'primary' : 'soft'}
                disabled={current || !isOwner || (pending !== null && pending !== plan.code)}
                loading={pending === plan.code}
                onClick={() => void subscribe(plan)}
              >
                {current ? 'Plano atual' : paying ? 'Mudar para este plano' : 'Assinar'}
              </Button>
            );
            return (
              <div
                key={plan.code}
                className={cn(
                  'relative flex flex-col rounded-xl border bg-surface p-5',
                  current ? 'border-brand-500 ring-2 ring-brand-500/20' : 'border-border',
                )}
              >
                {best ? (
                  <Badge tone="solid" className="absolute -top-2.5 right-4">
                    <Sparkles /> Mais econômico
                  </Badge>
                ) : null}
                <p className="font-semibold">{plan.name}</p>
                <p className="mt-0.5 text-xs text-muted">{plan.description}</p>
                <p className="mt-4">
                  <span className="tabular text-[26px] font-semibold tracking-tight">{formatBRL(plan.priceCents)}</span>
                  <span className="text-sm text-muted"> / {plan.interval === 'year' ? 'ano' : 'mês'}</span>
                </p>
                {plan.interval === 'year' ? (
                  <p className="tabular text-xs text-muted">equivale a {formatBRL(Math.round(plan.priceCents / 12))} por mês</p>
                ) : null}
                <ul className="mt-4 flex flex-1 flex-col gap-2 text-[13px]">
                  {plan.highlights.map((h) => (
                    <li key={h} className="flex items-start gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                      {h}
                    </li>
                  ))}
                  {plan.highlights.some((h) => /membro/i.test(h)) ? null : (
                    <li className="flex items-start gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                      {plan.maxMembers === 1 ? 'Uso individual' : `Até ${plan.maxMembers} membros`}
                    </li>
                  )}
                </ul>
                <div className="mt-5">
                  {!isOwner && !current ? (
                    <Tooltip content={OWNER_ONLY}>
                      <span tabIndex={0} className="block cursor-not-allowed">
                        {button}
                      </span>
                    </Tooltip>
                  ) : (
                    button
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {!isOwner ? <p className="mt-4 text-xs text-muted">{OWNER_ONLY}</p> : null}
    </Card>
  );
}
