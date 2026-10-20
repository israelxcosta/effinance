import { useState } from 'react';
import { Link } from 'react-router';
import { CircleAlert, Clock, Eye, Lock, X } from 'lucide-react';
import { formatDateBR } from '@effinance/shared';
import { cn } from '@/lib/utils';
import { useAuth } from '@/features/auth/auth-context';

const DAY = 24 * 60 * 60 * 1000;

/** Whole days until an ISO timestamp (0 on the last day). */
export function daysUntil(iso: string | null, now = Date.now()): number | null {
  if (!iso) return null;
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now) / DAY));
}

function readDismissed(key: string): boolean {
  try {
    return sessionStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

/** Subscription / role state of the active workspace, above every page. */
export function SubscriptionBanner() {
  const { workspace } = useAuth();
  const trialKey = `effinance:trial-banner:${workspace?.id ?? ''}`;
  const [dismissed, setDismissed] = useState(() => readDismissed(trialKey));
  if (!workspace) return null;

  const sub = workspace.subscription;
  const isOwner = workspace.role === 'owner';
  const subscribe = isOwner ? (
    <Link to="/configuracoes?aba=assinatura" className="font-semibold text-brand-text underline-offset-4 hover:underline">
      Assinar
    </Link>
  ) : null;
  const askOwner = <span className="text-muted">Peça ao proprietário do espaço para assinar.</span>;

  let tone: 'brand' | 'warning' | 'danger' | 'neutral';
  let icon = <Clock />;
  let content: React.ReactNode;
  let onDismiss: (() => void) | undefined;

  if (!sub.canWrite || sub.status === 'canceled' || sub.status === 'expired') {
    tone = 'danger';
    icon = <Lock />;
    content = (
      <>
        <span className="font-semibold">Modo somente leitura</span>
        <span className="text-muted">
          {sub.status === 'trialing' || sub.status === 'expired' ? 'O período de teste terminou.' : 'A assinatura está inativa.'} Seus dados
          continuam disponíveis para consulta e exportação.
        </span>
        {isOwner ? subscribe : askOwner}
      </>
    );
  } else if (workspace.role === 'viewer') {
    tone = 'neutral';
    icon = <Eye />;
    content = (
      <>
        <span className="font-semibold">Acesso somente leitura</span>
        <span className="text-muted">Você pode consultar os dados de {workspace.name}, mas não criar ou editar.</span>
      </>
    );
  } else if (sub.status === 'past_due') {
    tone = 'warning';
    icon = <CircleAlert />;
    content = (
      <>
        <span className="font-semibold">Pagamento pendente</span>
        <span className="text-muted">Não conseguimos cobrar a assinatura. Atualize o pagamento no Mercado Pago para não perder o acesso.</span>
        {isOwner ? (
          <Link to="/configuracoes?aba=assinatura" className="font-semibold text-brand-text underline-offset-4 hover:underline">
            Ver assinatura
          </Link>
        ) : null}
      </>
    );
  } else if (sub.status === 'pending') {
    tone = 'neutral';
    content = (
      <>
        <span className="font-semibold">Aguardando pagamento</span>
        <span className="text-muted">Assim que o Mercado Pago confirmar, a assinatura é ativada automaticamente.</span>
      </>
    );
  } else if (sub.status === 'trialing') {
    if (dismissed) return null;
    const days = daysUntil(sub.trialEndsAt);
    tone = 'brand';
    content = (
      <>
        <span className="font-semibold">Período de teste</span>
        <span className="text-muted">
          {days === null ? 'Aproveite todos os recursos.' : days === 0 ? 'Último dia de teste.' : `${days} ${days === 1 ? 'dia restante' : 'dias restantes'}.`}
        </span>
        {subscribe}
      </>
    );
    onDismiss = () => {
      try {
        sessionStorage.setItem(trialKey, '1');
      } catch {
        // Storage unavailable (private mode): dismiss for this render tree only.
      }
      setDismissed(true);
    };
  } else if (sub.cancelAtPeriodEnd && sub.currentPeriodEnd) {
    tone = 'neutral';
    content = (
      <>
        <span className="font-semibold">Assinatura cancelada</span>
        <span className="text-muted">O acesso completo continua até {formatDateBR(sub.currentPeriodEnd.slice(0, 10))}.</span>
        {subscribe}
      </>
    );
  } else {
    return null;
  }

  return (
    <div
      role="status"
      className={cn(
        'mb-5 flex items-start gap-3 rounded-xl border px-4 py-2.5 text-[13px] text-fg [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0',
        tone === 'brand' && 'border-brand-500/25 bg-primary-soft/60 [&>svg]:text-brand-text',
        tone === 'warning' && 'border-warning/30 bg-warning-soft [&>svg]:text-warning',
        tone === 'danger' && 'border-danger/25 bg-danger-soft [&>svg]:text-danger',
        tone === 'neutral' && 'border-border bg-surface-muted [&>svg]:text-muted',
      )}
    >
      {icon}
      <p className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">{content}</p>
      {onDismiss ? (
        <button type="button" onClick={onDismiss} aria-label="Dispensar aviso" className="-my-1 -mr-1.5 flex size-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-bg-subtle hover:text-fg">
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}
