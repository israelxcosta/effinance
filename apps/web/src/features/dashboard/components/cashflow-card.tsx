import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartColumn } from 'lucide-react';
import { addDays, addMonths, endOfMonth, startOfMonth, todayISO, type Granularity, type MonthSummary } from '@effinance/shared';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Skeleton } from '@/components/ui/skeleton';
import { axisProps, LegendDot, moneyAxisFormatter, MoneyTooltip, StripeDefs, CHART_COLORS } from '@/components/charts/chart-utils';
import { useCashflowReport } from '@/features/reports/api';
import { formatMonthKey } from '@effinance/shared';

type Mode = 'D' | 'S' | 'M' | 'A';

const RANGES: Record<Exclude<Mode, 'M'>, { granularity: Granularity; from: (t: string) => string; to: (t: string) => string }> = {
  D: { granularity: 'day', from: (t) => addDays(t, -13), to: (t) => t },
  S: { granularity: 'week', from: (t) => addDays(t, -7 * 7), to: (t) => t },
  A: { granularity: 'year', from: (t) => `${Number(t.slice(0, 4)) - 3}-01-01`, to: (t) => `${t.slice(0, 4)}-12-31` },
};

/** "Fluxo de Caixa — Receita vs Despesa" with striped bars (Graniq style). */
export function CashflowCard({ monthly, loading, anchorMonth }: { monthly: MonthSummary[] | undefined; loading: boolean; anchorMonth: string }) {
  const [mode, setMode] = useState<Mode>('M');
  const today = todayISO();
  const anchor = anchorMonth === today.slice(0, 7) ? today : endOfMonth(`${anchorMonth}-01`);
  const cfg = mode === 'M' ? null : RANGES[mode];
  const cashflow = useCashflowReport(
    cfg ? { from: cfg.from(anchor), to: cfg.to(anchor), granularity: cfg.granularity } : { from: startOfMonth(addMonths(anchor, -5)), to: anchor, granularity: 'month' },
    mode !== 'M',
  );

  const data = useMemo(() => {
    if (mode === 'M') {
      return (monthly ?? []).map((m) => ({ label: formatMonthKey(m.month, 'short').split('/')[0], receita: m.income, despesa: m.expense, projected: false }));
    }
    return (cashflow.data?.periods ?? []).map((p) => ({ label: p.label.replace('Sem ', ''), receita: p.inflow, despesa: p.outflow, projected: p.projected }));
  }, [mode, monthly, cashflow.data]);

  const isLoading = mode === 'M' ? loading : cashflow.isPending;
  const empty = !isLoading && data.every((d) => d.receita === 0 && d.despesa === 0);

  return (
    <Card className="flex h-full flex-col p-5">
      <CardHeader
        title="Fluxo de Caixa"
        subtitle={mode === 'M' ? 'Receita vs Despesa mensal' : 'Entradas vs saídas nas contas'}
        info="Mensal (M) usa a competência dos lançamentos. D, S e A mostram o dinheiro que entrou e saiu das contas."
        action={
          <SegmentedControl
            size="sm"
            ariaLabel="Período do gráfico"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'D', label: 'D', title: 'Últimos 14 dias' },
              { value: 'S', label: 'S', title: 'Últimas 8 semanas' },
              { value: 'M', label: 'M', title: 'Últimos 6 meses' },
              { value: 'A', label: 'A', title: 'Últimos anos' },
            ]}
          />
        }
      />
      <div className="mt-3 flex gap-4">
        <LegendDot color={CHART_COLORS.income} label="Receita" striped />
        <LegendDot color={CHART_COLORS.expense} label="Despesa" striped />
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
              <XAxis dataKey="label" {...axisProps} />
              <YAxis {...axisProps} tickFormatter={moneyAxisFormatter} width={52} />
              <Tooltip cursor={{ fill: 'var(--app-bg-subtle)', radius: 8 }} content={<MoneyTooltip names={{ receita: 'Receita', despesa: 'Despesa' }} />} />
              <Bar dataKey="receita" name="receita" fill="url(#stripe-income)" radius={[8, 8, 8, 8]} maxBarSize={30} />
              <Bar dataKey="despesa" name="despesa" fill="url(#stripe-expense)" radius={[8, 8, 8, 8]} maxBarSize={30} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}
