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
}: KpiCardProps) {
  const hasChange = change !== undefined;
  const up = (change ?? 0) >= 0;
  const good = invert ? !up : up;
  const Icon = up ? TrendingUp : TrendingDown;
  const footer = (
    <div className="flex items-center justify-between gap-2 border-t border-border bg-surface-muted px-4 py-2.5 text-xs text-muted">
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
      {href ? <ArrowRight className="size-3.5 text-subtle transition-transform group-hover:translate-x-0.5" aria-hidden /> : null}
    </div>
  );
  const body = (
    <>
      <div className="px-4 pt-4 pb-3.5">
        <div className="flex items-center gap-1.5 text-[13px] font-medium text-muted">
          {label}
          {info ? (
            <Tooltip content={info}>
              <span className="text-subtle" aria-label={info}>
                <Info className="size-3.5" />
              </span>
            </Tooltip>
          ) : null}
        </div>
        <div className={cn('tabular mt-1.5 text-[26px] leading-tight font-semibold tracking-tight text-fg', valueClassName)}>
          {value}
        </div>
      </div>
      {footer}
    </>
  );
  const classes = cn(
    'group flex flex-col justify-between overflow-hidden rounded-xl border border-border bg-surface shadow-xs transition-shadow',
    href && 'hover:shadow-sm',
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
