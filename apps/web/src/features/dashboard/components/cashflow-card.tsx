import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartColumn } from 'lucide-react';
import { addDays, addMonthKey, endOfMonth, periodKey, todayISO, type Granularity, type MonthSummary } from '@effinance/shared';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Skeleton } from '@/components/ui/skeleton';
import { axisProps, LegendDot, moneyAxisFormatter, MoneyTooltip, StripeDefs, CHART_COLORS } from '@/components/charts/chart-utils';
import { useCashflowReport, useEvolutionReport } from '@/features/reports/api';

type Mode = 'D' | 'S' | 'M' | 'A';

// Windows around the selected period: a few before it, the period itself, and the next ones (projected).
const RANGES: Record<Exclude<Mode, 'M'>, { granularity: Granularity; from: (t: string) => string; to: (t: string) => string }> = {
  D: { granularity: 'day', from: (t) => addDays(t, -6), to: (t) => addDays(t, 7) },
  S: { granularity: 'week', from: (t) => addDays(t, -7 * 3), to: (t) => addDays(t, 7 * 4) },
  A: { granularity: 'year', from: (t) => `${Number(t.slice(0, 4)) - 2}-01-01`, to: (t) => `${Number(t.slice(0, 4)) + 1}-12-31` },
};
const MONTHS_BEFORE = 2;
const MONTHS_AFTER = 3;

/** "Fluxo de Caixa — Receita vs Despesa" with striped bars (Graniq style). */
export function CashflowCard({ loading, anchorMonth }: { monthly?: MonthSummary[] | undefined; loading: boolean; anchorMonth: string }) {
  const [mode, setMode] = useState<Mode>('M');
  const today = todayISO();
  const anchor = anchorMonth === today.slice(0, 7) ? today : endOfMonth(`${anchorMonth}-01`);
  const cfg = mode === 'M' ? null : RANGES[mode];
  const cashflow = useCashflowReport(
    cfg ? { from: cfg.from(anchor), to: cfg.to(anchor), granularity: cfg.granularity } : { from: anchor, to: anchor, granularity: 'month' },
    mode !== 'M',
  );
  // Monthly bars: competence (due date) basis, the same numbers as the reports.
  const evolution = useEvolutionReport({ to: addMonthKey(anchorMonth, MONTHS_AFTER), months: MONTHS_BEFORE + 1 + MONTHS_AFTER, interval: 'month' });

  const currentKey = mode === 'M' ? anchorMonth : cfg ? periodKey(anchor, cfg.granularity) : '';
  const data = useMemo(() => {
    if (mode === 'M') {
      const e = evolution.data;
      return (e?.periods ?? []).map((p, i) => ({
        key: p.key,
        label: p.label.split('/')[0]!,
        receita: e!.income.values[i]!,
        despesa: e!.expense.values[i]!,
        projected: p.start > today,
      }));
    }
    return (cashflow.data?.periods ?? []).map((p) => ({ key: p.key, label: p.label.replace('Sem ', ''), receita: p.inflow, despesa: p.outflow, projected: p.projected }));
  }, [mode, evolution.data, cashflow.data, today]);

  const isLoading = mode === 'M' ? loading || evolution.isPending : cashflow.isPending;
  const empty = !isLoading && data.every((d) => d.receita === 0 && d.despesa === 0);

  return (
    <Card className="flex h-full flex-col p-5">
      <CardHeader
        title="Fluxo de caixa"
        subtitle={mode === 'M' ? 'Receita vs Despesa · meses anteriores e próximos' : 'Entradas vs saídas · antes e depois de hoje'}
        info="Mensal (M) usa o vencimento dos lançamentos. D, S e A mostram o dinheiro que entra e sai das contas. Barras mais claras são previstas (períodos futuros)."
        action={
          <SegmentedControl
            size="sm"
            ariaLabel="Período do gráfico"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'D', label: 'D', title: '6 dias antes e 7 depois' },
              { value: 'S', label: 'S', title: '3 semanas antes e 4 depois' },
              { value: 'M', label: 'M', title: '2 meses antes e 3 depois' },
              { value: 'A', label: 'A', title: '2 anos antes e 1 depois' },
            ]}
          />
        }
      />
      <div className="mt-3 flex gap-4">
        <LegendDot color={CHART_COLORS.income} label="Receita" striped />
        <LegendDot color={CHART_COLORS.expense} label="Despesa" striped />
        {data.some((d) => d.projected) ? <span className="text-xs text-muted">Mais claro = previsto</span> : null}
      </div>
      <div className="mt-2 min-h-[240px] flex-1">
        {isLoading ? (
          <Skeleton className="h-full min-h-[240px]" />
        ) : empty ? (
          <EmptyState className="h-full" icon={<ChartColumn />} title="Sem movimentações ainda" description="Adicione transações para ver seu fluxo de caixa aqui." />
        ) : (
          <ResponsiveContainer width="100%" height="100%" minHeight={240}>
            <BarChart data={data} barGap={6} margin={{ left: -8, right: 4, top: 8 }}>
              <StripeDefs />
              <CartesianGrid vertical={false} stroke="var(--app-chart-grid)" strokeDasharray="4 4" />
              <XAxis
                dataKey="label"
                {...axisProps}
                // The selected period's label is bold.
                tick={(props) => {
                  const { x, y, payload } = props as unknown as { x: number; y: number; payload: { value: string; index: number } };
                  const current = data[payload.index]?.key === currentKey;
                  return (
                    <text x={x} y={Number(y) + 12} textAnchor="middle" fontSize={12} fontWeight={current ? 700 : 400} fill={current ? 'var(--app-fg)' : 'var(--app-muted)'}>
                      {payload.value}
                    </text>
                  );
                }}
              />
              <YAxis {...axisProps} tickFormatter={moneyAxisFormatter} width={52} />
              <Tooltip cursor={{ fill: 'var(--app-bg-subtle)', radius: 8 }} content={<MoneyTooltip names={{ receita: 'Receita', despesa: 'Despesa' }} />} />
              <Bar dataKey="receita" name="receita" fill="url(#stripe-income)" radius={[8, 8, 8, 8]} maxBarSize={30}>
                {data.map((d) => (
                  <Cell key={d.key} fillOpacity={d.projected ? 0.45 : 1} />
                ))}
              </Bar>
              <Bar dataKey="despesa" name="despesa" fill="url(#stripe-expense)" radius={[8, 8, 8, 8]} maxBarSize={30}>
                {data.map((d) => (
                  <Cell key={d.key} fillOpacity={d.projected ? 0.45 : 1} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}
