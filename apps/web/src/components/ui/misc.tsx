import type { ReactNode } from 'react';
import { RefreshCw, TriangleAlert } from 'lucide-react';
import { formatBRL } from '@effinance/shared';
import { cn } from '@/lib/utils';
import { errorMessage } from '@/lib/api';
import { Button } from './button';

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  return (
    <div className={cn('flex flex-col items-start gap-2 rounded-lg border border-danger/20 bg-danger-soft/50 p-5', className)} role="alert">
      <div className="flex items-center gap-2 text-sm font-semibold text-danger">
        <TriangleAlert className="size-4" /> Não consegui carregar agora
      </div>
      <p className="text-sm text-muted">{errorMessage(error)}</p>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw /> Tentar novamente
        </Button>
      ) : null}
    </div>
  );
}

interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  overline?: string;
  className?: string;
}

export function PageHeader({ title, description, actions, overline, className }: PageHeaderProps) {
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-4', className)}>
      <div className="min-w-0">
        {overline ? <p className="eyebrow mb-1.5 text-brand-text">{overline}</p> : null}
        <h1 className="text-[22px] font-semibold tracking-tight text-fg">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

interface MoneyProps {
  value: number;
  /** Paint by sign: positive green, negative red. */
  signed?: boolean;
  /** Force a tone. */
  tone?: 'income' | 'expense' | 'neutral' | 'muted';
  showPlus?: boolean;
  className?: string;
}

export function Money({ value, signed, tone, showPlus, className }: MoneyProps) {
  const resolved = tone ?? (signed ? (value > 0 ? 'income' : value < 0 ? 'expense' : 'neutral') : 'neutral');
  return (
    <span
      className={cn(
        'tabular font-semibold whitespace-nowrap',
        resolved === 'income' && 'text-success',
        resolved === 'expense' && 'text-danger',
        resolved === 'muted' && 'text-muted',
        className,
      )}
    >
      {showPlus && value > 0 ? '+' : ''}
      {formatBRL(value)}
    </span>
  );
}

export function StatPill({ label, value, tone = 'neutral', className }: { label: ReactNode; value: ReactNode; tone?: 'success' | 'danger' | 'neutral' | 'brand' | 'warning'; className?: string }) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 rounded-md px-3 py-1.5 text-[13px]',
        tone === 'success' && 'bg-success-soft text-success',
        tone === 'danger' && 'bg-danger-soft text-danger',
        tone === 'neutral' && 'bg-bg-subtle text-muted',
        tone === 'brand' && 'bg-primary-soft text-primary-soft-fg',
        tone === 'warning' && 'bg-warning-soft text-warning',
        className,
      )}
    >
      <span className="font-medium">{label}</span>
      <span className="tabular font-semibold">{value}</span>
    </div>
  );
}

export function MiniStat({ label, value, tone, hint, className }: { label: string; value: ReactNode; tone?: 'success' | 'danger' | 'warning' | 'brand'; hint?: ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-lg border border-border bg-surface px-4 py-3 shadow-xs', className)}>
      <p className="text-xs font-medium text-muted">{label}</p>
      <p
        className={cn(
          'tabular mt-1 text-lg font-semibold tracking-tight',
          tone === 'success' && 'text-success',
          tone === 'danger' && 'text-danger',
          tone === 'warning' && 'text-warning',
          tone === 'brand' && 'text-brand-text',
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-[11px] text-subtle">{hint}</p> : null}
    </div>
  );
}
