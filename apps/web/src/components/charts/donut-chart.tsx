import { Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { formatBRL, formatPercent, type CategoryAmount } from '@effinance/shared';
import { cn } from '@/lib/utils';
import { MoneyTooltip, SERIES_PALETTE } from './chart-utils';

interface DonutChartProps {
  data: CategoryAmount[];
  total: number;
  centerLabel?: string;
  height?: number;
  maxItems?: number;
  showLegend?: boolean;
}

/** Category distribution donut with total in the center and a compact legend. */
export function DonutChart({ data, total, centerLabel = 'Total', height = 200, maxItems = 6, showLegend = true }: DonutChartProps) {
  const sorted = [...data].sort((a, b) => b.amount - a.amount);
  const head = sorted.slice(0, maxItems);
  const rest = sorted.slice(maxItems);
  const items = rest.length
    ? [...head, { categoryId: 'others', name: 'Outros', icon: 'tag' as const, color: '#9A9EA5', amount: rest.reduce((s, r) => s + r.amount, 0), share: rest.reduce((s, r) => s + r.share, 0) }]
    : head;
  const chartData = items.map((d, i) => ({ ...d, fill: d.color || SERIES_PALETTE[i % SERIES_PALETTE.length] }));

  return (
    <div className="@container">
    <div className="flex flex-col items-center gap-4 @md:flex-row @md:items-center">
      <div className="relative shrink-0" style={{ width: height, height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
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
            />
            <Tooltip content={<MoneyTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-[11px] font-medium text-muted">{centerLabel}</span>
          <span className={cn('tabular font-semibold tracking-tight', height < 170 ? 'text-xs' : 'text-[15px]')}>{formatBRL(total)}</span>
        </div>
      </div>
      {showLegend ? (
        <ul className="flex w-full min-w-0 flex-col gap-2">
          {chartData.map((d) => (
            <li key={d.categoryId ?? d.name} className="flex items-center gap-2 text-[13px]">
              <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: d.fill }} />
              <span className="min-w-0 flex-1 truncate text-fg">{d.name}</span>
              <span className="text-xs text-muted">{formatPercent(d.share, 0)}</span>
              <span className="tabular w-24 text-right font-semibold">{formatBRL(d.amount)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
    </div>
  );
}
