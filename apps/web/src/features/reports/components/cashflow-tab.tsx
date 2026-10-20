import { useState } from 'react';
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Waves } from 'lucide-react';
import { formatBRL, type Granularity } from '@effinance/shared';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState, MiniStat, Money } from '@/components/ui/misc';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { axisProps, CHART_COLORS, LegendDot, moneyAxisFormatter, MoneyTooltip, StripeDefs } from '@/components/charts/chart-utils';
import { useAccounts } from '@/features/accounts/api';
import { useCashflowReport } from '../api';
import { GRANULARITY_OPTIONS } from './categories-tab';

/** Cash flow: realized vs projected inflow/outflow with running balance. */
export function CashflowTab({ from, to }: { from: string; to: string }) {
  const [granularity, setGranularity] = useState<Granularity>('month');
  const [accountId, setAccountId] = useState('');
  const accounts = useAccounts();
  const report = useCashflowReport({ from, to, granularity, accountId: accountId || undefined });
  const r = report.data;

  const data = (r?.periods ?? []).map((p) => ({
    label: p.label,
    entradas: p.inflow,
    saidas: -p.outflow,
    saldo: p.balance,
    projected: p.projected,
  }));
  const projected = (r?.periods ?? []).filter((p) => p.projected);
  const totals = (r?.periods ?? []).reduce(
    (acc, p) => ({ in: acc.in + p.inflow, out: acc.out + p.outflow, pin: acc.pin + p.pendingInflow, pout: acc.pout + p.pendingOutflow }),
    { in: 0, out: 0, pin: 0, pout: 0 },
  );

  if (report.isError) return <ErrorState error={report.error} onRetry={() => report.refetch()} />;

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <SegmentedControl ariaLabel="Agrupar por" value={granularity} onChange={setGranularity} options={GRANULARITY_OPTIONS} />
        <Select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="h-10 min-w-[220px]" aria-label="Conta">
          <option value="">Todas as contas (saldo total)</option>
          {(accounts.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </Select>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniStat label="Saldo inicial" value={r ? formatBRL(r.openingBalance) : '—'} />
        <MiniStat label="Entradas" value={r ? formatBRL(totals.in) : '—'} tone="success" hint={totals.pin ? `${formatBRL(totals.pin)} previsto` : undefined} />
        <MiniStat label="Saídas" value={r ? formatBRL(totals.out) : '—'} tone="danger" hint={totals.pout ? `${formatBRL(totals.pout)} previsto` : undefined} />
        <MiniStat label="Saldo final projetado" value={r ? formatBRL(r.closingBalance) : '—'} tone={r && r.closingBalance < 0 ? 'danger' : 'brand'} />
      </div>

      <Card className="p-5">
        <CardHeader title="Fluxo de caixa" subtitle="Entradas e saídas por período com saldo acumulado" icon={<Waves />} />
        <div className="mt-3 flex flex-wrap gap-4">
          <LegendDot color={CHART_COLORS.success} label="Entradas" striped />
          <LegendDot color={CHART_COLORS.danger} label="Saídas" striped />
          <LegendDot color={CHART_COLORS.brand} label="Saldo acumulado" />
        </div>
        <div className="mt-2 h-80">
          {report.isPending ? (
            <Skeleton className="h-full" />
          ) : data.length === 0 ? (
            <EmptyState className="h-full" title="Sem dados no período" />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data} margin={{ left: -4, right: 8, top: 8 }} stackOffset="sign">
                <StripeDefs />
                <CartesianGrid vertical={false} stroke="var(--app-chart-grid)" strokeDasharray="4 4" />
                <XAxis dataKey="label" {...axisProps} />
                <YAxis {...axisProps} tickFormatter={moneyAxisFormatter} width={60} />
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
                <Tooltip cursor={{ fill: 'var(--app-bg-subtle)' }} content={<MoneyTooltip names={{ entradas: 'Entradas', saidas: 'Saídas', saldo: 'Saldo acumulado' }} />} />
                <Bar dataKey="entradas" name="entradas" stackId="flow" fill="url(#stripe-success)" radius={[6, 6, 0, 0]} maxBarSize={34} />
                <Bar dataKey="saidas" name="saidas" stackId="flow" fill="url(#stripe-danger)" radius={[6, 6, 0, 0]} maxBarSize={34} />
                <Line type="monotone" dataKey="saldo" name="saldo" stroke={CHART_COLORS.brand} strokeWidth={2.5} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>

      {r && r.periods.length ? (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-muted text-left text-[11px] font-semibold tracking-wide text-muted uppercase">
                  <th className="px-4 py-2.5">Período</th>
                  <th className="px-4 py-2.5 text-right">Entradas realizadas</th>
                  <th className="px-4 py-2.5 text-right">Saídas realizadas</th>
                  <th className="px-4 py-2.5 text-right">A receber</th>
                  <th className="px-4 py-2.5 text-right">A pagar</th>
                  <th className="px-4 py-2.5 text-right">Resultado</th>
                  <th className="px-4 py-2.5 text-right">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {r.periods.map((p) => (
                  <tr key={p.key} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 font-semibold">
                      {p.label} {p.projected ? <Badge tone="brand" className="ml-1">Projeção</Badge> : null}
                    </td>
                    <td className="tabular px-4 py-3 text-right text-success">{formatBRL(p.realizedInflow)}</td>
                    <td className="tabular px-4 py-3 text-right text-danger">{formatBRL(p.realizedOutflow)}</td>
                    <td className="tabular px-4 py-3 text-right text-muted">{formatBRL(p.pendingInflow)}</td>
                    <td className="tabular px-4 py-3 text-right text-muted">{formatBRL(p.pendingOutflow)}</td>
                    <td className="px-4 py-3 text-right"><Money value={p.net} signed /></td>
                    <td className="px-4 py-3 text-right"><Money value={p.balance} signed={p.balance < 0} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
