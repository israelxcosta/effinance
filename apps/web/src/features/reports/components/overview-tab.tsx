import { ChartPie, Receipt, Sparkles } from 'lucide-react';
import { formatBRL, formatPercent } from '@effinance/shared';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState, MiniStat } from '@/components/ui/misc';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Skeleton, SkeletonRows } from '@/components/ui/skeleton';
import { DonutChart } from '@/components/charts/donut-chart';
import { TransactionRow } from '@/features/transactions/components/transaction-row';
import { InsightList } from '@/features/dashboard/components/insights-tab';
import { useOverviewReport } from '../api';

export function OverviewTab({ from, to }: { from: string; to: string }) {
  const report = useOverviewReport({ from, to });
  if (report.isError) return <ErrorState error={report.error} onRetry={() => report.refetch()} />;
  const o = report.data;
  const v = (n: number | undefined) => (n === undefined ? '—' : formatBRL(n));
  const totalSplit = o ? o.fixedExpense + o.variableExpense + o.installmentExpense : 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <MiniStat label="Receitas" value={v(o?.income)} tone="success" />
        <MiniStat label="Despesas" value={v(o?.expense)} tone="danger" />
        <MiniStat label="Resultado" value={v(o?.net)} tone={o && o.net < 0 ? 'danger' : 'brand'} />
        <MiniStat label="Taxa de economia" value={o ? formatPercent(o.savingsRate) : '—'} />
        <MiniStat label="Gasto médio diário" value={v(o?.averageDailyExpense)} className="col-span-2 lg:col-span-1" />
      </div>

      <Card className="p-5">
        <CardHeader title="Insights do período" subtitle="Análises automáticas dos seus números" icon={<Sparkles />} />
        <div className="mt-4">
          {report.isPending ? (
            <SkeletonRows rows={2} />
          ) : o && o.insights.length ? (
            <InsightList insights={o.insights} />
          ) : (
            <EmptyState compact icon={<Sparkles />} title="Sem insights para este período" description="Registre movimentações para receber análises." />
          )}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <CardHeader title="Despesas por categoria" subtitle="Onde o dinheiro foi gasto" icon={<ChartPie />} />
          <div className="mt-4">
            {report.isPending ? (
              <Skeleton className="h-48" />
            ) : o && o.topCategories.length ? (
              <DonutChart data={o.topCategories} total={o.expense} height={180} maxItems={7} />
            ) : (
              <EmptyState compact title="Sem despesas no período" />
            )}
          </div>
        </Card>
        <Card className="p-5">
          <CardHeader title="Perfil das despesas" subtitle="Fixas, parceladas e variáveis · formas de pagamento" />
          {report.isPending ? (
            <Skeleton className="mt-4 h-48" />
          ) : o && o.expense > 0 ? (
            <div className="mt-4 flex flex-col gap-5">
              {[
                { label: 'Fixas', value: o.fixedExpense, color: 'var(--app-chart-1)' },
                { label: 'Parceladas', value: o.installmentExpense, color: 'var(--app-chart-2)' },
                { label: 'Variáveis', value: o.variableExpense, color: 'var(--app-chart-3)' },
              ].map((row) => (
                <div key={row.label}>
                  <div className="flex justify-between text-[13px]">
                    <span className="font-medium">{row.label}</span>
                    <span className="tabular font-semibold">
                      {formatBRL(row.value)} <span className="text-xs font-normal text-muted">· {formatPercent(totalSplit ? row.value / totalSplit : 0, 0)}</span>
                    </span>
                  </div>
                  <ProgressBar value={totalSplit ? row.value / totalSplit : 0} color={row.color} className="mt-1.5" />
                </div>
              ))}
              <div className="border-t border-border pt-4">
                <p className="eyebrow mb-2 text-muted">Formas de pagamento</p>
                <ul className="flex flex-col gap-1.5">
                  {o.byPaymentMethod.map((m) => (
                    <li key={m.label} className="flex items-center justify-between text-[13px]">
                      <span>{m.label}</span>
                      <span className="tabular font-semibold">
                        {formatBRL(m.amount)} <span className="text-xs font-normal text-muted">· {formatPercent(m.share, 0)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <EmptyState compact className="mt-4" title="Sem despesas no período" />
          )}
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="p-5 pb-2">
          <CardHeader title="Maiores despesas" subtitle="Lançamentos de maior valor no período" icon={<Receipt />} />
        </div>
        <div className="p-1.5">
          {report.isPending ? (
            <SkeletonRows rows={4} className="p-3" />
          ) : o && o.topExpenses.length ? (
            o.topExpenses.map((t) => <TransactionRow key={t.id} tx={t} />)
          ) : (
            <EmptyState compact className="m-3" title="Sem despesas no período" />
          )}
        </div>
      </Card>
    </div>
  );
}
