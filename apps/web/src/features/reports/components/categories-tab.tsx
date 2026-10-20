import { useMemo, useState } from 'react';
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChevronRight, Layers } from 'lucide-react';
import { formatBRL, formatPercent, type CategoryType, type Granularity } from '@effinance/shared';
import { Card, CardHeader } from '@/components/ui/card';
import { CategoryIcon } from '@/components/ui/category-icon';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState, MiniStat } from '@/components/ui/misc';
import { ProgressBar } from '@/components/ui/progress-bar';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { axisProps, moneyAxisFormatter, MoneyTooltip, SERIES_PALETTE } from '@/components/charts/chart-utils';
import { useCategoryReport } from '../api';
import { useTone } from '@/lib/theme';

export const GRANULARITY_OPTIONS: { value: Granularity; label: string }[] = [
  { value: 'day', label: 'Dia' },
  { value: 'week', label: 'Semana' },
  { value: 'month', label: 'Mês' },
  { value: 'year', label: 'Ano' },
];

const MAX_SERIES = 8;

/** Evolution and projection by category (stacked bars + total line, projected periods shaded). */
export function CategoriesTab({ from, to }: { from: string; to: string }) {
  const [type, setType] = useState<CategoryType>('expense');
  const [granularity, setGranularity] = useState<Granularity>('month');
  const [status, setStatus] = useState<'all' | 'paid'>('all');
  const [drill, setDrill] = useState<{ id: string; name: string } | null>(null);
  const report = useCategoryReport({ from, to, type, granularity, status, categoryId: drill?.id });
  const r = report.data;
  const tone = useTone();

  const { chartData, series } = useMemo(() => {
    if (!r) return { chartData: [], series: [] as { key: string; name: string; color: string }[] };
    const sorted = [...r.series].sort((a, b) => b.total - a.total);
    const head = sorted.slice(0, MAX_SERIES);
    const rest = sorted.slice(MAX_SERIES);
    const series = head.map((s, i) => ({ key: `s${i}`, name: s.name, color: tone(s.color || SERIES_PALETTE[i % SERIES_PALETTE.length]!) }));
    if (rest.length) series.push({ key: 'others', name: 'Outros', color: '#9A9EA5' });
    const chartData = r.periods.map((p, pi) => {
      const row: Record<string, number | string | boolean> = { label: p.label, projected: p.projected, total: r.totals[pi] ?? 0 };
      head.forEach((s, i) => (row[`s${i}`] = s.values[pi] ?? 0));
      if (rest.length) row.others = rest.reduce((acc, s) => acc + (s.values[pi] ?? 0), 0);
      return row;
    });
    return { chartData, series };
  }, [r, tone]);

  const projected = r?.periods.filter((p) => p.projected) ?? [];
  const names = Object.fromEntries([...series.map((s) => [s.key, s.name]), ['total', 'Total']]);
  const periodsWithData = r ? r.totals.filter((t) => t > 0).length : 0;

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl
            ariaLabel="Tipo"
            value={type}
            onChange={(t) => {
              setType(t);
              setDrill(null);
            }}
            options={[
              { value: 'expense', label: 'Despesas' },
              { value: 'income', label: 'Receitas' },
            ]}
          />
          <SegmentedControl ariaLabel="Agrupar por" value={granularity} onChange={setGranularity} options={GRANULARITY_OPTIONS} />
        </div>
        <SegmentedControl
          ariaLabel="Status"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'all', label: 'Realizado + previsto' },
            { value: 'paid', label: 'Somente realizado' },
          ]}
        />
      </Card>

      {drill ? (
        <nav aria-label="Navegação" className="flex items-center gap-1.5 text-sm">
          <button type="button" className="font-semibold text-brand-text hover:underline" onClick={() => setDrill(null)}>
            Todas as categorias
          </button>
          <ChevronRight className="size-4 text-subtle" />
          <span className="font-semibold">{drill.name}</span>
          <Badge tone="brand" className="ml-1">Subcategorias</Badge>
        </nav>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniStat label={`Total ${type === 'expense' ? 'de despesas' : 'de receitas'}`} value={r ? formatBRL(r.total) : '—'} tone={type === 'expense' ? 'danger' : 'success'} />
        <MiniStat label="Média por período" value={r && periodsWithData ? formatBRL(Math.round(r.total / periodsWithData)) : '—'} />
        <MiniStat label="Maior categoria" value={r && r.series[0] ? [...r.series].sort((a, b) => b.total - a.total)[0]!.name : '—'} />
        <MiniStat label="Períodos projetados" value={String(projected.length)} hint="Gerados por fixas, recorrentes e parcelas" />
      </div>

      {report.isError ? (
        <ErrorState error={report.error} onRetry={() => report.refetch()} />
      ) : (
        <Card className="p-5">
          <CardHeader
            title={drill ? `Evolução — ${drill.name}` : 'Evolução por categoria'}
            subtitle="Barras empilhadas por período · linha = total · área sombreada = projeção"
            icon={<Layers />}
          />
          <div className="mt-4 h-80">
            {report.isPending ? (
              <Skeleton className="h-full" />
            ) : !r || r.total === 0 ? (
              <EmptyState className="h-full" title="Sem lançamentos no período" description="Ajuste o período ou registre lançamentos para ver a evolução." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ left: -4, right: 8, top: 8 }}>
                  <CartesianGrid vertical={false} stroke="var(--app-chart-grid)" strokeDasharray="4 4" />
                  <XAxis dataKey="label" {...axisProps} />
                  <YAxis {...axisProps} tickFormatter={moneyAxisFormatter} width={56} />
                  {projected.length ? (
                    <ReferenceArea
                      x1={projected[0]!.label}
                      x2={projected[projected.length - 1]!.label}
                      fill="var(--app-chart-accent)"
                      fillOpacity={0.06}
                      stroke="var(--app-chart-accent)"
                      strokeOpacity={0.2}
                      strokeDasharray="4 4"
                      label={{ value: 'Projeção', position: 'insideTop', fill: 'var(--app-muted)', fontSize: 11 }}
                    />
                  ) : null}
                  <Tooltip cursor={{ fill: 'var(--app-bg-subtle)' }} content={<MoneyTooltip names={names} hideZero />} />
                  {series.map((s, i) => (
                    <Bar
                      key={s.key}
                      dataKey={s.key}
                      name={s.key}
                      stackId="a"
                      fill={s.color}
                      maxBarSize={44}
                      radius={i === series.length - 1 ? [6, 6, 0, 0] : [0, 0, 0, 0]}
                    />
                  ))}
                  <Line type="monotone" dataKey="total" name="total" stroke="var(--app-fg)" strokeWidth={2} dot={{ r: 3 }} strokeDasharray="0" />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
          {series.length ? (
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
              {series.map((s) => (
                <span key={s.key} className="flex items-center gap-1.5 text-xs text-muted">
                  <span className="size-2.5 rounded-full" style={{ backgroundColor: s.color }} /> {s.name}
                </span>
              ))}
            </div>
          ) : null}
        </Card>
      )}

      {r && r.series.length ? (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-muted text-left text-[11px] font-semibold tracking-wide text-muted uppercase">
                  <th className="px-4 py-2.5">{drill ? 'Subcategoria' : 'Categoria'}</th>
                  <th className="px-4 py-2.5 text-right">Total</th>
                  <th className="px-4 py-2.5 text-right">Média</th>
                  <th className="w-48 px-4 py-2.5">Participação</th>
                  <th className="w-10 px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {[...r.series]
                  .sort((a, b) => b.total - a.total)
                  .map((s) => {
                    const canDrill = !drill && s.categoryId;
                    return (
                      <tr
                        key={s.categoryId ?? s.name}
                        className={canDrill ? 'cursor-pointer border-b border-border last:border-0 hover:bg-surface-muted' : 'border-b border-border last:border-0'}
                        onClick={() => canDrill && setDrill({ id: s.categoryId!, name: s.name })}
                      >
                        <td className="px-4 py-3">
                          <span className="flex items-center gap-3">
                            <CategoryIcon icon={s.icon} color={s.color} size="sm" />
                            <span className="font-semibold">{s.name}</span>
                          </span>
                        </td>
                        <td className="tabular px-4 py-3 text-right font-semibold">{formatBRL(s.total)}</td>
                        <td className="tabular px-4 py-3 text-right text-muted">{formatBRL(s.average)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <ProgressBar value={s.share} color={s.color} size="sm" />
                            <span className="w-10 text-right text-xs text-muted">{formatPercent(s.share, 0)}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-subtle">{canDrill ? <ChevronRight className="size-4" /> : null}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
