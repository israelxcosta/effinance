import type { ReactNode } from 'react';
import { formatBRL } from '@effinance/shared';
import { cn } from '@/lib/utils';

export const CHART_COLORS = {
  income: 'var(--app-chart-income)',
  incomeStrong: 'var(--app-chart-income-strong)',
  expense: 'var(--app-chart-expense)',
  expenseStrong: 'var(--app-chart-expense-strong)',
  neutral: 'var(--app-chart-neutral)',
  grid: 'var(--app-chart-grid)',
  axis: 'var(--app-subtle)',
  brand: 'var(--app-primary)',
  success: 'var(--app-success)',
  danger: 'var(--app-danger)',
} as const;

/** Fallback palette for categories without a color / "Outros". */
export const SERIES_PALETTE = ['#152B61', '#3F64BE', '#0EA5E9', '#14B8A6', '#12A150', '#EAB308', '#F97316', '#E5484D', '#EC4899', '#A855F7', '#64748B'];

export const axisProps = {
  tickLine: false,
  axisLine: false,
  tick: { fill: CHART_COLORS.axis, fontSize: 11 },
} as const;

/** Short axis label from cents: 1_400_000 → "14k", 350_000 → "3,5k", 120_000_000 → "1,2M". */
export const moneyAxisFormatter = (cents: number) => {
  const v = cents / 100;
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ','));
  if (abs >= 1_000_000) return `${sign}${fmt(Math.round((abs / 1_000_000) * 10) / 10)}M`;
  if (abs >= 1_000) return `${sign}${fmt(Math.round((abs / 1_000) * 10) / 10)}k`;
  return `${sign}${Math.round(abs)}`;
};

/**
 * Diagonal stripe patterns (Graniq-style hatched bars). Render inside a chart's <defs>.
 * Use as `fill="url(#stripe-income)"`; ids and colors are listed in STRIPES.
 */
const STRIPES = {
  'stripe-income': CHART_COLORS.income,
  'stripe-expense': CHART_COLORS.expense,
  'stripe-neutral': CHART_COLORS.neutral,
  'stripe-brand': CHART_COLORS.incomeStrong,
  'stripe-success': CHART_COLORS.success,
  'stripe-danger': CHART_COLORS.danger,
} as const;

export function StripeDefs() {
  return (
    <defs>
      {Object.entries(STRIPES).map(([id, color]) => (
        <Stripe key={id} id={id} color={color} />
      ))}
    </defs>
  );
}

/** Solid color behind a series fill, resolving `url(#stripe-…)` patterns (for tooltips). */
function seriesColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const pattern = /^url\(#([\w-]+)\)$/.exec(value);
  if (!pattern) return value;
  return STRIPES[pattern[1] as keyof typeof STRIPES];
}

function Stripe({ id, color }: { id: string; color: string }) {
  return (
    <pattern id={id} patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
      <rect width="8" height="8" fill={color} opacity="0.55" />
      <rect width="4" height="8" fill={color} />
    </pattern>
  );
}

interface TooltipRow {
  name?: string | number;
  value?: number | string | (number | string)[];
  color?: string;
  fill?: string;
  dataKey?: string | number | ((obj: unknown) => unknown);
  payload?: Record<string, unknown>;
}

interface MoneyTooltipProps {
  active?: boolean;
  label?: string | number;
  payload?: readonly TooltipRow[] | TooltipRow[];
  /** Map a series name to a friendly label. */
  names?: Record<string, string>;
  footer?: (payload: readonly TooltipRow[]) => ReactNode;
  hideZero?: boolean;
}

/** Card-like tooltip with BRL formatting. Pass as `content={<MoneyTooltip />}`. */
export function MoneyTooltip({ active, label, payload, names, footer, hideZero }: MoneyTooltipProps) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p) => !hideZero || Number(p.value) !== 0);
  const projected = Boolean(payload[0]?.payload?.projected);
  return (
    <div className="min-w-[180px] rounded-lg border border-border bg-surface px-3 py-2.5 text-xs shadow-lg">
      <p className="mb-1.5 flex items-center gap-2 font-semibold text-fg">
        {label}
        {projected ? <span className="rounded-full bg-primary-soft px-1.5 py-0.5 text-[10px] text-primary-soft-fg">Projeção</span> : null}
      </p>
      <div className="flex flex-col gap-1">
        {rows.map((p, i) => {
          const key = String(p.name ?? p.dataKey ?? i);
          const color = seriesColor(p.fill) ?? seriesColor(p.color);
          return (
            <div key={key + i} className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5 text-muted">
                <span className={cn('size-2 rounded-full', !color && 'bg-brand-400')} style={color ? { backgroundColor: color } : undefined} />
                {names?.[key] ?? key}
              </span>
              <span className="tabular font-semibold whitespace-nowrap text-fg">{formatBRL(Number(p.value ?? 0))}</span>
            </div>
          );
        })}
      </div>
      {footer ? <div className="mt-1.5 border-t border-border pt-1.5">{footer(payload)}</div> : null}
    </div>
  );
}

export function LegendDot({ color, label, striped }: { color: string; label: string; striped?: boolean }) {
  return (
    <span className="flex items-center gap-1.5 text-xs font-medium text-muted">
      <span
        className="size-2.5 rounded-full"
        style={{
          background: striped ? `repeating-linear-gradient(45deg, ${color} 0 2px, color-mix(in oklab, ${color} 55%, transparent) 2px 4px)` : color,
        }}
      />
      {label}
    </span>
  );
}
