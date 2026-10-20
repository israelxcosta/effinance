import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Users } from 'lucide-react';
import { formatBRL, type Granularity } from '@effinance/shared';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState, Money } from '@/components/ui/misc';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Skeleton } from '@/components/ui/skeleton';
import { axisProps, CHART_COLORS, moneyAxisFormatter, MoneyTooltip, StripeDefs } from '@/components/charts/chart-utils';
import { cn, initials } from '@/lib/utils';
import { useContactReport } from '../api';
import { GRANULARITY_OPTIONS } from './categories-tab';

/** Totals and evolution by contact. */
export function ContactsTab({ from, to }: { from: string; to: string }) {
  const [granularity, setGranularity] = useState<Granularity>('month');
  const [status, setStatus] = useState<'all' | 'paid'>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const report = useContactReport({ from, to, granularity, status });
  const r = report.data;

  const items = useMemo(() => [...(r?.items ?? [])].sort((a, b) => b.income + b.expense - (a.income + a.expense)), [r]);
  const current = items.find((i) => (i.contactId ?? 'none') === selected) ?? items[0];
  const top = items.slice(0, 10).map((i) => ({ name: i.name.length > 18 ? `${i.name.slice(0, 17)}…` : i.name, receita: i.income, despesa: i.expense }));
  const evolution = r && current ? r.periods.map((p, pi) => ({ label: p.label, receita: current.incomeValues[pi] ?? 0, despesa: current.expenseValues[pi] ?? 0 })) : [];

  if (report.isError) return <ErrorState error={report.error} onRetry={() => report.refetch()} />;

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <SegmentedControl ariaLabel="Agrupar por" value={granularity} onChange={setGranularity} options={GRANULARITY_OPTIONS} />
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

      {report.isPending ? (
        <Skeleton className="h-80 rounded-xl" />
      ) : items.length === 0 ? (
        <Card className="p-5">
          <EmptyState icon={<Users />} title="Nenhum lançamento com contato no período" description="Vincule contatos às contas a pagar e a receber para ver totais e evolução por pessoa ou empresa." />
        </Card>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-5">
              <CardHeader title="Totais por contato" subtitle="Top 10 por movimentação" />
              <div className="mt-4" style={{ height: Math.max(220, top.length * 38) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={top} layout="vertical" margin={{ left: 8, right: 12 }} barGap={2}>
                    <StripeDefs />
                    <CartesianGrid horizontal={false} stroke="var(--app-chart-grid)" strokeDasharray="4 4" />
                    <XAxis type="number" {...axisProps} tickFormatter={moneyAxisFormatter} />
                    <YAxis type="category" dataKey="name" {...axisProps} width={120} />
                    <Tooltip cursor={{ fill: 'var(--app-bg-subtle)' }} content={<MoneyTooltip names={{ receita: 'Receitas', despesa: 'Despesas' }} hideZero />} />
                    <Bar dataKey="receita" name="receita" fill={CHART_COLORS.success} radius={[0, 6, 6, 0]} maxBarSize={14} />
                    <Bar dataKey="despesa" name="despesa" fill={CHART_COLORS.danger} radius={[0, 6, 6, 0]} maxBarSize={14} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card className="p-5">
              <CardHeader title={`Evolução — ${current?.name ?? ''}`} subtitle="Selecione um contato na tabela abaixo" />
              <div className="mt-4 h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={evolution} margin={{ left: -4, right: 8, top: 8 }}>
                    <CartesianGrid vertical={false} stroke="var(--app-chart-grid)" strokeDasharray="4 4" />
                    <XAxis dataKey="label" {...axisProps} />
                    <YAxis {...axisProps} tickFormatter={moneyAxisFormatter} width={56} />
                    <Tooltip content={<MoneyTooltip names={{ receita: 'Receitas', despesa: 'Despesas' }} />} />
                    <Legend formatter={(v) => (v === 'receita' ? 'Receitas' : 'Despesas')} iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="receita" stroke={CHART_COLORS.success} strokeWidth={2.5} dot={{ r: 3 }} />
                    <Line type="monotone" dataKey="despesa" stroke={CHART_COLORS.danger} strokeWidth={2.5} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-muted text-left text-[11px] font-semibold tracking-wide text-muted uppercase">
                    <th className="px-4 py-2.5">Contato</th>
                    <th className="px-4 py-2.5 text-right">Lançamentos</th>
                    <th className="px-4 py-2.5 text-right">Receitas</th>
                    <th className="px-4 py-2.5 text-right">Despesas</th>
                    <th className="px-4 py-2.5 text-right">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => {
                    const key = i.contactId ?? 'none';
                    const active = (current?.contactId ?? 'none') === key;
                    return (
                      <tr
                        key={key}
                        onClick={() => setSelected(key)}
                        className={cn('cursor-pointer border-b border-border last:border-0 hover:bg-surface-muted', active && 'bg-primary-soft/40')}
                        aria-selected={active}
                      >
                        <td className="px-4 py-3">
                          <span className="flex items-center gap-3">
                            <span className="flex size-8 items-center justify-center rounded-full bg-primary-soft text-[11px] font-bold text-primary-soft-fg">{initials(i.name)}</span>
                            <span className="font-semibold">{i.name}</span>
                          </span>
                        </td>
                        <td className="tabular px-4 py-3 text-right text-muted">{i.count}</td>
                        <td className="tabular px-4 py-3 text-right text-success">{formatBRL(i.income)}</td>
                        <td className="tabular px-4 py-3 text-right text-danger">{formatBRL(i.expense)}</td>
                        <td className="px-4 py-3 text-right">
                          <Money value={i.net} signed />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
