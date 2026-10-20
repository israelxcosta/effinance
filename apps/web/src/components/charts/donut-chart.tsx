import { useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import { formatBRL, formatPercent, type CategoryAmount } from '@effinance/shared';
import { cn } from '@/lib/utils';
import { SERIES_PALETTE } from './chart-utils';
import { useTone } from '@/lib/theme';

interface DonutChartProps {
  data: CategoryAmount[];
  total: number;
  centerLabel?: string;
  height?: number;
  maxItems?: number;
  showLegend?: boolean;
  /** Makes slices and legend rows clickable (not called for the grouped "Outros" slice). */
  onSelect?: (item: CategoryAmount) => void;
}

const OTHERS_ID = 'others';

/**
 * Category distribution donut. Hovering a slice or legend row highlights it and shows its name and
 * amount in the center (instead of a floating tooltip that would cover the total).
 */
export function DonutChart({ data, total, centerLabel = 'Total', height = 200, maxItems = 6, showLegend = true, onSelect }: DonutChartProps) {
  const tone = useTone();
  const [active, setActive] = useState<number | null>(null);
  const sorted = [...data].sort((a, b) => b.amount - a.amount);
  const head = sorted.slice(0, maxItems);
  const rest = sorted.slice(maxItems);
  const items: CategoryAmount[] = rest.length
    ? [...head, { categoryId: OTHERS_ID, name: 'Outros', icon: 'tag', color: '#9A9EA5', amount: rest.reduce((s, r) => s + r.amount, 0), share: rest.reduce((s, r) => s + r.share, 0) }]
    : head;
  const chartData = items.map((d, i) => ({ ...d, fill: tone(d.color || SERIES_PALETTE[i % SERIES_PALETTE.length]!) }));
  const focused = active === null ? null : chartData[active];
  const selectable = (d: CategoryAmount) => Boolean(onSelect) && d.categoryId !== OTHERS_ID;
  const small = height < 170;

  return (
    <div className="@container">
      <div className="flex flex-col items-center gap-4 @md:flex-row @md:items-center" onMouseLeave={() => setActive(null)}>
        <div className="donut relative shrink-0" style={{ width: height, height }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart accessibilityLayer={false}>
              <Pie
                data={chartData}
                dataKey="amount"
                nameKey="name"
                innerRadius="74%"
                outerRadius="100%"
                paddingAngle={2}
                cornerRadius={6}
                stroke="none"
                animationDuration={700}
                rootTabIndex={-1}
                onMouseEnter={(_, index) => setActive(index)}
                onMouseLeave={() => setActive(null)}
                onClick={(_, index) => {
                  const item = items[index];
                  if (item && selectable(item)) onSelect?.(item);
                }}
              >
                {chartData.map((d, i) => (
                  <Cell
                    key={d.categoryId ?? d.name}
                    fill={d.fill}
                    opacity={active === null || active === i ? 1 : 0.35}
                    className={cn('outline-none transition-opacity duration-150', selectable(d) && 'cursor-pointer')}
                  />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-[18%] text-center">
            <span className="w-full truncate text-[11px] leading-tight font-medium text-muted">{focused ? focused.name : centerLabel}</span>
            <span className={cn('tabular mt-0.5 font-semibold tracking-tight whitespace-nowrap text-fg', small ? 'text-[13px]' : 'text-[15px]')}>
              {formatBRL(focused ? focused.amount : total)}
            </span>
            {focused ? <span className="text-[11px] leading-tight text-muted">{formatPercent(focused.share, 0)}</span> : null}
          </div>
        </div>
        {showLegend ? (
          <ul className="grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-0.5">
            {chartData.map((d, i) => {
              const clickable = selectable(d);
              const row = (
                <>
                  <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: d.fill }} />
                  <span className="truncate text-left text-fg">{d.name}</span>
                  <span className="tabular text-right text-xs text-muted">{formatPercent(d.share, 0)}</span>
                  <span className="tabular text-right font-semibold whitespace-nowrap text-fg">{formatBRL(d.amount)}</span>
                </>
              );
              const rowClass = cn(
                'col-span-4 grid grid-cols-subgrid items-center rounded-md px-1.5 py-1.5 text-[13px] transition-colors',
                active === i && 'bg-bg-subtle',
              );
              return (
                <li key={d.categoryId ?? d.name} className="col-span-4 grid grid-cols-subgrid" onMouseEnter={() => setActive(i)}>
                  {clickable ? (
                    <button type="button" className={cn(rowClass, 'cursor-pointer')} onClick={() => onSelect?.(d)} onFocus={() => setActive(i)} onBlur={() => setActive(null)}>
                      {row}
                    </button>
                  ) : (
                    <div className={rowClass}>{row}</div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
