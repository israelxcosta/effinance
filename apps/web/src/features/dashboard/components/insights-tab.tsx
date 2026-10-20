import { Link } from 'react-router';
import { ArrowUpRight, CircleAlert, Lightbulb, Sparkles, Trophy, TrendingUp } from 'lucide-react';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  formatBRL,
  formatPercent,
  monthRange,
  type DashboardResponse,
  type Insight,
  type InsightKind,
} from '@effinance/shared';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { KpiCard } from '@/components/ui/kpi-card';
import { Skeleton, SkeletonRows } from '@/components/ui/skeleton';
import { DonutChart } from '@/components/charts/donut-chart';
import { axisProps, MoneyTooltip } from '@/components/charts/chart-utils';
import { cn } from '@/lib/utils';
import { useOverviewReport } from '@/features/reports/api';
import { TransactionRow } from '@/features/transactions/components/transaction-row';
import { INSIGHT_LABELS } from './insight-card';
import { HealthCard } from './health-card';

const KIND_STYLE: Record<InsightKind, { icon: React.ReactNode; className: string }> = {
  opportunity: { icon: <TrendingUp />, className: 'bg-primary-soft text-primary-soft-fg' },
  warning: { icon: <CircleAlert />, className: 'bg-danger-soft text-danger' },
  achievement: { icon: <Trophy />, className: 'bg-success-soft text-success' },
  info: { icon: <Lightbulb />, className: 'bg-warning-soft text-warning' },
};

export function InsightList({ insights }: { insights: Insight[] }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {insights.map((ins, i) => {
        const style = KIND_STYLE[ins.kind];
        return (
          <div key={i} className="flex gap-3 rounded-lg border border-border bg-surface p-4">
            <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-md [&_svg]:size-4', style.className)}>{style.icon}</span>
            <div className="min-w-0 flex-1">
              <p className="eyebrow text-subtle">{INSIGHT_LABELS[ins.kind]}</p>
              <p className="mt-0.5 text-sm font-semibold">{ins.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted">{ins.description}</p>
            </div>
            {ins.href ? (
              <Link to={ins.href} className="text-subtle hover:text-fg" aria-label="Abrir análise">
                <ArrowUpRight className="size-4" />
              </Link>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function InsightsTab({ month, dashboard, loading }: { month: string; dashboard: DashboardResponse | undefined; loading: boolean }) {
  const range = monthRange(month);
  const overview = useOverviewReport(range);
  const o = overview.data;
  const insights = [...(dashboard?.insights ?? []), ...(o?.insights ?? [])].filter(
    (ins, i, arr) => arr.findIndex((x) => x.title === ins.title) === i,
  );

  const split = o
    ? [
        { name: 'Fixas', value: o.fixedExpense, fill: 'var(--app-chart-1)' },
        { name: 'Parceladas', value: o.installmentExpense, fill: 'var(--app-chart-2)' },
        { name: 'Variáveis', value: o.variableExpense, fill: 'var(--app-chart-3)' },
      ]
    : [];

  return (
    <div className="flex flex-col gap-4">
      <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-brand-700 via-brand-800 to-brand-950 p-6 text-white">
        <div className="pointer-events-none absolute -top-24 -right-10 size-72 rounded-full bg-white/5" aria-hidden />
        <p className="eyebrow text-white/70">Dashboard inteligente</p>
        <h2 className="mt-2 max-w-2xl text-[22px] leading-snug font-semibold tracking-tight">
          {o ? (
            o.savingsRate !== null && o.savingsRate > 0 ? (
              <>Você economizou <span className="text-brand-200">{formatPercent(o.savingsRate, 0)}</span> da sua receita neste mês.</>
            ) : o.income === 0 && o.expense === 0 ? (
              <>Registre suas movimentações para receber análises personalizadas.</>
            ) : (
              <>Neste mês suas despesas superaram as receitas em <span className="text-brand-200">{formatBRL(Math.abs(o.net))}</span>.</>
            )
          ) : (
            'Analisando suas finanças…'
          )}
        </h2>
        <p className="mt-2 text-sm text-white/70">Insights automáticos com base nos seus lançamentos, metas e cartões.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Gasto médio diário" value={o ? formatBRL(o.averageDailyExpense) : <Skeleton className="h-8 w-28" />} footerContent={<span>Despesas ÷ dias do mês</span>} />
        <KpiCard label="Despesas fixas" value={o ? formatBRL(o.fixedExpense) : <Skeleton className="h-8 w-28" />} footerContent={<span>{o && o.expense ? `${formatPercent(o.fixedExpense / o.expense, 0)} das despesas` : '—'}</span>} />
        <KpiCard label="Parcelamentos" value={o ? formatBRL(o.installmentExpense) : <Skeleton className="h-8 w-28" />} footerContent={<span>Parcelas no mês</span>} />
        <KpiCard label="Resultado do mês" value={o ? formatBRL(o.net) : <Skeleton className="h-8 w-28" />} valueClassName={o && o.net < 0 ? 'text-danger' : undefined} footerContent={<span>Receitas − despesas</span>} />
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="p-5 lg:col-span-8">
          <CardHeader title="Insights do mês" subtitle="O que chamou atenção nos seus números" icon={<Sparkles />} />
          <div className="mt-4">
            {loading || overview.isPending ? (
              <SkeletonRows rows={3} />
            ) : insights.length ? (
              <InsightList insights={insights} />
            ) : (
              <EmptyState compact icon={<Sparkles />} title="Sem dados suficientes ainda" description="Assim que houver movimentações, trago análises e recomendações concretas." />
            )}
          </div>
        </Card>
        <div className="lg:col-span-4">
          <HealthCard health={dashboard?.health} loading={loading} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5">
          <CardHeader title="Fixas x variáveis" subtitle="Composição das despesas" />
          <div className="mt-4 h-48">
            {overview.isPending ? (
              <Skeleton className="h-full" />
            ) : o && o.expense > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={split} layout="vertical" margin={{ left: 8, right: 8 }}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" {...axisProps} width={80} />
                  <Tooltip cursor={{ fill: 'var(--app-bg-subtle)' }} content={<MoneyTooltip names={{ value: 'Valor' }} />} />
                  <Bar dataKey="value" name="value" radius={[6, 6, 6, 6]} barSize={22} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState compact className="h-full" title="Sem despesas no mês" />
            )}
          </div>
        </Card>
        <Card className="p-5">
          <CardHeader title="Formas de pagamento" subtitle="Como você pagou suas despesas" />
          <div className="mt-4">
            {overview.isPending ? (
              <Skeleton className="h-40" />
            ) : o && o.byPaymentMethod.length ? (
              <DonutChart
                height={140}
                total={o.expense}
                data={o.byPaymentMethod.map((m, i) => ({
                  categoryId: m.method ?? `none-${i}`,
                  name: m.label,
                  icon: 'credit-card',
                  color: ['#152B61', '#3F64BE', '#9AB2E6', '#14B8A6', '#F59E0B', '#E5484D', '#A855F7', '#64748B'][i % 8]!,
                  amount: m.amount,
                  share: m.share,
                }))}
              />
            ) : (
              <EmptyState compact title="Sem despesas no mês" />
            )}
          </div>
        </Card>
        <Card className="overflow-hidden">
          <div className="p-5 pb-2">
            <CardHeader title="Maiores despesas" subtitle="Top 5 do mês" />
          </div>
          <div className="p-1.5">
            {overview.isPending ? (
              <SkeletonRows rows={4} className="p-3" />
            ) : o && o.topExpenses.length ? (
              o.topExpenses.slice(0, 5).map((t) => <TransactionRow key={t.id} tx={t} showDue={false} />)
            ) : (
              <EmptyState compact className="m-3" title="Sem despesas no mês" />
            )}
          </div>
        </Card>
      </div>
      {o && o.topCategories.length ? (
        <Card className="p-5">
          <CardHeader title="Categorias que mais pesaram" subtitle="Distribuição das despesas do mês" />
          <div className="mt-4">
            <DonutChart data={o.topCategories} total={o.expense} height={170} maxItems={7} />
          </div>
        </Card>
      ) : null}
    </div>
  );
}
