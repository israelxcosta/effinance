import type { ReactNode } from 'react';
import { ArrowRight, Info, TrendingDown, TrendingUp } from 'lucide-react';
import { Link } from 'react-router';
import { formatPercent } from '@effinance/shared';
import { cn } from '@/lib/utils';
import { Tooltip } from './tooltip';

interface KpiCardProps {
  label: string;
  value: ReactNode;
  info?: string;
  /** Relative change vs. previous period (0.1 = +10%). */
  change?: number | null;
  /** When true, an increase is bad (e.g. expenses) and is painted red. */
  invert?: boolean;
  footerLabel?: string;
  href?: string;
  className?: string;
  valueClassName?: string;
  /** Replaces the default trend footer content. */
  footerContent?: ReactNode;
  /** `danger`: solid red card for alerts (e.g. overdue bills). */
  tone?: 'default' | 'danger';
}

export function KpiCard({
  label,
  value,
  info,
  change,
  invert,
  footerLabel = 'vs mês anterior',
  href,
  className,
  valueClassName,
  footerContent,
  tone = 'default',
}: KpiCardProps) {
  const danger = tone === 'danger';
  const hasChange = change !== undefined;
  const up = (change ?? 0) >= 0;
  const good = invert ? !up : up;
  const Icon = up ? TrendingUp : TrendingDown;
  const footer = (
    <div
      className={cn(
        'flex items-center justify-between gap-2 border-t px-4 py-2.5 text-xs',
        danger ? 'border-on-semantic/15 bg-black/10 text-on-semantic/90' : 'border-border bg-surface-muted text-muted',
      )}
    >
      <span className="flex items-center gap-1.5">
        {footerContent ? (
          footerContent
        ) : hasChange && change !== null ? (
          <>
            <Icon className={cn('size-3.5', good ? 'text-success' : 'text-danger')} aria-hidden />
            <span className={cn('font-semibold', good ? 'text-success' : 'text-danger')}>
              {up ? '+' : ''}
              {formatPercent(change)}
            </span>
            {footerLabel}
          </>
        ) : (
          <span>Sem base de comparação</span>
        )}
      </span>
      {href ? (
        <ArrowRight className={cn('size-3.5 transition-transform group-hover:translate-x-0.5', danger ? 'text-on-semantic/80' : 'text-subtle')} aria-hidden />
      ) : null}
    </div>
  );
  const body = (
    <>
      <div className="p-4">
        <div className={cn('flex items-center gap-1.5 text-label font-medium', danger ? 'text-on-semantic/90' : 'text-muted')}>
          {label}
          {info ? (
            <Tooltip content={info}>
              <span className={danger ? 'text-on-semantic/75' : 'text-subtle'} aria-label={info}>
                <Info className="size-3.5" />
              </span>
            </Tooltip>
          ) : null}
        </div>
        {/* Totals sit on the right edge, like the amounts in every list. */}
        <div className={cn('tabular mt-2 text-right text-display font-semibold tracking-tight', danger ? 'text-on-semantic' : 'text-fg', valueClassName)}>
          {value}
        </div>
      </div>
      {footer}
    </>
  );
  const classes = cn(
    'group flex flex-col justify-between overflow-hidden rounded-xl border shadow-xs transition-shadow',
    danger ? 'border-danger bg-danger' : 'border-border bg-surface',
    href && (danger ? 'hover:shadow-md hover:brightness-[1.03]' : 'hover:shadow-sm'),
    className,
  );
  return href ? (
    <Link to={href} className={classes}>
      {body}
    </Link>
  ) : (
    <div className={classes}>{body}</div>
  );
}
