import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowRight, GitCompareArrows } from 'lucide-react';
import {
  addMonths,
  endOfMonth,
  formatBRL,
  formatDateBR,
  formatPercent,
  percentChange,
  startOfMonth,
  type CategoryType,
  type PeriodTotals,
} from '@effinance/shared';
import { Card, CardHeader } from '@/components/ui/card';
import { CategoryIcon } from '@/components/ui/category-icon';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/misc';
import { Input } from '@/components/ui/input';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { axisProps, CHART_COLORS, LegendDot, moneyAxisFormatter, MoneyTooltip, StripeDefs } from '@/components/charts/chart-utils';
import { useActiveMonth } from '@/lib/active-month';
import { cn } from '@/lib/utils';
import { useComparisonReport } from '../api';

type Range = { from: string; to: string };

const QUICK = {
  'prev-month': 'Mês anterior × mês selecionado',
  'last-year': 'Mesmo mês do ano anterior × mês selecionado',
  'prev-quarter': 'Trimestre anterior × 3 meses até o selecionado',
  'prev-semester': 'Semestre anterior × 6 meses até o selecionado',
  custom: 'Personalizado',
} as const;
type Quick = keyof typeof QUICK;

/** Anchored on the active month (dashboard), so "selecionado" is the month the user is looking at. */
function quickRanges(q: Exclude<Quick, 'custom'>, month: string): { a: Range; b: Range } {
  const t = `${month}-01`;
  const cur = { from: startOfMonth(t), to: endOfMonth(t) };
  switch (q) {
    case 'prev-month':
      return { a: { from: startOfMonth(addMonths(t, -1)), to: endOfMonth(addMonths(t, -1)) }, b: cur };
    case 'last-year':
      return { a: { from: startOfMonth(addMonths(t, -12)), to: endOfMonth(addMonths(t, -12)) }, b: cur };
    case 'prev-quarter':
      return { a: { from: startOfMonth(addMonths(t, -5)), to: endOfMonth(addMonths(t, -3)) }, b: { from: startOfMonth(addMonths(t, -2)), to: endOfMonth(t) } };
    case 'prev-semester':
      return { a: { from: startOfMonth(addMonths(t, -11)), to: endOfMonth(addMonths(t, -6)) }, b: { from: startOfMonth(addMonths(t, -5)), to: endOfMonth(t) } };
  }
}

export function ComparisonTab() {
  const [activeMonth] = useActiveMonth();
  const [quick, setQuick] = useState<Quick>('prev-month');
  const [custom, setCustom] = useState(() => quickRanges('prev-month', activeMonth));
  const [type, setType] = useState<CategoryType>('expense');
  const ranges = quick === 'custom' ? custom : quickRanges(quick, activeMonth);
  const report = useComparisonReport({ aFrom: ranges.a.from, aTo: ranges.a.to, bFrom: ranges.b.from, bTo: ranges.b.to, type });
  const r = report.data;

  const chartData = useMemo(
    () => (r?.rows ?? []).slice(0, 10).map((row) => ({ name: row.name.length > 14 ? `${row.name.slice(0, 13)}…` : row.name, a: row.a, b: row.b })),
    [r],
  );
  const label = (x: Range) => `${formatDateBR(x.from)} – ${formatDateBR(x.to)}`;

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Select value={quick} onChange={(e) => setQuick(e.target.value as Quick)} className="h-10 min-w-[290px] font-medium" aria-label="Comparação">
            {Object.entries(QUICK).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <SegmentedControl
            ariaLabel="Tipo"
            value={type}
            onChange={setType}
            options={[
              { value: 'expense', label: 'Despesas por categoria' },
              { value: 'income', label: 'Receitas por categoria' },
            ]}
          />
        </div>
        {quick === 'custom' ? (
          <div className="grid gap-3 md:grid-cols-2">
            <RangeInputs title="Período A" value={custom.a} onChange={(a) => setCustom((c) => ({ ...c, a }))} />
            <RangeInputs title="Período B" value={custom.b} onChange={(b) => setCustom((c) => ({ ...c, b }))} />
          </div>
        ) : (
          <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <span className="rounded-full bg-bg-subtle px-2 py-0.5 font-semibold">A</span> {label(ranges.a)}
            <ArrowRight className="size-3.5" />
            <span className="rounded-full bg-primary-soft px-2 py-0.5 font-semibold text-primary-soft-fg">B</span> {label(ranges.b)}
          </p>
        )}
      </Card>

      {report.isError ? (
        <ErrorState error={report.error} onRetry={() => report.refetch()} />
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            <CompareCard title="Receitas" a={r?.a} b={r?.b} pick={(p) => p.income} loading={report.isPending} />
            <CompareCard title="Despesas" a={r?.a} b={r?.b} pick={(p) => p.expense} loading={report.isPending} invert />
            <CompareCard title="Saldo" a={r?.a} b={r?.b} pick={(p) => p.net} loading={report.isPending} />
          </div>

          <Card className="p-5">
            <CardHeader title="Por categoria" subtitle="Período A × Período B" icon={<GitCompareArrows />} />
            <div className="mt-3 flex gap-4">
              <LegendDot color={CHART_COLORS.neutral} label="Período A" striped />
              <LegendDot color={CHART_COLORS.incomeStrong} label="Período B" />
            </div>
            <div className="mt-2 h-72">
              {report.isPending ? (
                <Skeleton className="h-full" />
              ) : chartData.length === 0 ? (
                <EmptyState className="h-full" title="Sem lançamentos nos períodos" />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ left: -4, right: 8, top: 8 }} barGap={4}>
                    <StripeDefs />
                    <CartesianGrid vertical={false} stroke="var(--app-chart-grid)" strokeDasharray="4 4" />
                    <XAxis dataKey="name" {...axisProps} interval={0} angle={chartData.length > 6 ? -20 : 0} textAnchor={chartData.length > 6 ? 'end' : 'middle'} height={chartData.length > 6 ? 56 : 30} />
                    <YAxis {...axisProps} tickFormatter={moneyAxisFormatter} width={56} />
                    <Tooltip cursor={{ fill: 'var(--app-bg-subtle)' }} content={<MoneyTooltip names={{ a: 'Período A', b: 'Período B' }} />} />
                    <Bar dataKey="a" name="a" fill="url(#stripe-neutral)" radius={[6, 6, 6, 6]} maxBarSize={26} />
                    <Bar dataKey="b" name="b" fill={CHART_COLORS.incomeStrong} radius={[6, 6, 6, 6]} maxBarSize={26} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </Card>

          {r && r.rows.length ? (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b border-border bg-surface-muted text-left text-[11px] font-semibold tracking-wide text-muted uppercase">
                      <th className="px-4 py-2.5">Categoria</th>
                      <th className="px-4 py-2.5 text-right">Período A</th>
                      <th className="px-4 py-2.5 text-right">Período B</th>
                      <th className="px-4 py-2.5 text-right">Diferença</th>
                      <th className="px-4 py-2.5 text-right">Variação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.rows.map((row) => {
                      const worse = type === 'expense' ? row.diff > 0 : row.diff < 0;
                      return (
                        <tr key={row.categoryId ?? row.name} className="border-b border-border last:border-0">
                          <td className="px-4 py-3">
                            <span className="flex items-center gap-3">
                              <CategoryIcon icon={row.icon} color={row.color} size="sm" />
                              <span className="font-semibold">{row.name}</span>
                            </span>
                          </td>
                          <td className="tabular px-4 py-3 text-right text-muted">{formatBRL(row.a)}</td>
                          <td className="tabular px-4 py-3 text-right font-semibold">{formatBRL(row.b)}</td>
                          <td className={cn('tabular px-4 py-3 text-right font-semibold', row.diff === 0 ? 'text-muted' : worse ? 'text-danger' : 'text-success')}>
                            {row.diff > 0 ? '+' : ''}
                            {formatBRL(row.diff)}
                          </td>
                          <td className={cn('tabular px-4 py-3 text-right text-xs font-semibold', row.diffPercent === null || row.diff === 0 ? 'text-muted' : worse ? 'text-danger' : 'text-success')}>
                            {row.diffPercent === null ? 'novo' : `${row.diffPercent > 0 ? '+' : ''}${formatPercent(row.diffPercent)}`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}

function RangeInputs({ title, value, onChange }: { title: string; value: Range; onChange: (r: Range) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3">
      <span className="w-20 text-xs font-semibold">{title}</span>
      <Input type="date" value={value.from} onChange={(e) => onChange({ ...value, from: e.target.value })} className="h-9 w-[150px]" aria-label={`${title} — de`} />
      <span className="text-xs text-muted">até</span>
      <Input type="date" value={value.to} onChange={(e) => onChange({ ...value, to: e.target.value })} className="h-9 w-[150px]" aria-label={`${title} — até`} />
    </div>
  );
}

function CompareCard({
  title,
  a,
  b,
  pick,
  loading,
  invert,
}: {
  title: string;
  a: PeriodTotals | undefined;
  b: PeriodTotals | undefined;
  pick: (p: PeriodTotals) => number;
  loading: boolean;
  invert?: boolean;
}) {
  if (loading || !a || !b) return <Skeleton className="h-32 rounded-xl" />;
  const va = pick(a);
  const vb = pick(b);
  const change = percentChange(vb, va);
  const up = vb - va >= 0;
  const good = invert ? !up : up;
  return (
    <Card className="p-5">
      <p className="text-[13px] font-medium text-muted">{title}</p>
      <div className="mt-2 flex items-end justify-between gap-2">
        <div>
          <p className="text-[11px] text-subtle">Período B</p>
          <p className="tabular text-[22px] font-bold tracking-tight">{formatBRL(vb)}</p>
        </div>
        <span className={cn('rounded-full px-2 py-1 text-xs font-semibold', va === vb ? 'bg-bg-subtle text-muted' : good ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger')}>
          {change === null ? 'novo' : `${change > 0 ? '+' : ''}${formatPercent(change)}`}
        </span>
      </div>
      <p className="mt-2 text-xs text-muted">
        Período A: <span className="tabular font-semibold text-fg">{formatBRL(va)}</span> · diferença{' '}
        <span className="tabular font-semibold text-fg">{formatBRL(vb - va)}</span>
      </p>
    </Card>
  );
}
