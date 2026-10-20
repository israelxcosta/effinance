import { useEffect, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  ArrowRight,
  CalendarClock,
  ChartPie,
  CreditCard as CardIcon,
  Gauge as GaugeIcon,
  Landmark,
  PieChart as PieIcon,
  Plus,
  Scale,
  Sparkles,
  Target,
  TrendingUp,
} from 'lucide-react';
import {
  MONTH_NAMES,
  formatBRL,
  formatMonthKey,
  formatPercent,
  percentChange,
  type DashboardResponse,
  type Transaction,
} from '@effinance/shared';
import { Card, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { BankLogo } from '@/components/ui/bank-logo';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState, StatPill } from '@/components/ui/misc';
import { KpiCard } from '@/components/ui/kpi-card';
import { ProgressBar } from '@/components/ui/progress-bar';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Select } from '@/components/ui/select';
import { Skeleton, SkeletonRows } from '@/components/ui/skeleton';
import { DonutChart } from '@/components/charts/donut-chart';
import { axisProps, moneyAxisFormatter, MoneyTooltip } from '@/components/charts/chart-utils';
import { cn } from '@/lib/utils';
import { useTransactionActions } from '@/features/transactions/transaction-actions';
import { TransactionRow } from '@/features/transactions/components/transaction-row';
import { GoalProgress } from '@/features/goals/goal-card';
import { useDashboard } from '../api';
import { CashflowCard } from '../components/cashflow-card';
import { HealthCard } from '../components/health-card';
import { InsightCard } from '../components/insight-card';
import { InsightsTab } from '../components/insights-tab';
import { categoryListHref } from '@/features/transactions/links';
import { WriteGate } from '@/features/auth/permissions';
import { useActiveMonth } from '@/lib/active-month';

type Tab = 'dashboard' | 'insights';

export default function DashboardPage() {
  const [params, setParams] = useSearchParams();
  const [month, setActiveMonth] = useActiveMonth();
  const tab = (params.get('aba') as Tab) || 'dashboard';
  const dashboard = useDashboard(month);
  const d = dashboard.data;

  function update(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (!v) next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  }

  // `?mes=` (old links) seeds the active month, which every other screen follows.
  const linkedMonth = params.get('mes');
  useEffect(() => {
    if (!linkedMonth) return;
    setActiveMonth(linkedMonth);
    update({ mes: null });
  }, [linkedMonth]);

  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(5, 7));
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 6 }, (_, i) => currentYear - 3 + i);
  const setMonth = (y: number, m: number) => setActiveMonth(`${y}-${String(m).padStart(2, '0')}`);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          variant="solid"
          ariaLabel="Visão"
          value={tab}
          onChange={(t) => update({ aba: t === 'dashboard' ? null : t })}
          options={[
            { value: 'dashboard', label: 'Dashboard', icon: <GaugeIcon /> },
            { value: 'insights', label: 'Dashboard inteligente', icon: <Sparkles /> },
          ]}
        />
        <div className="flex items-center gap-2">
          <Select aria-label="Mês" value={monthIndex} onChange={(e) => setMonth(year, Number(e.target.value))} className="h-10 w-[150px] bg-surface font-medium">
            {MONTH_NAMES.map((name, i) => (
              <option key={name} value={i + 1}>
                {name}
              </option>
            ))}
          </Select>
          <Select aria-label="Ano" value={year} onChange={(e) => setMonth(Number(e.target.value), monthIndex)} className="h-10 w-[100px] bg-surface font-medium">
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {dashboard.isError ? (
        <ErrorState error={dashboard.error} onRetry={() => dashboard.refetch()} />
      ) : tab === 'insights' ? (
        <InsightsTab month={month} dashboard={d} loading={dashboard.isPending} />
      ) : (
        <Overview d={d} loading={dashboard.isPending} month={month} />
      )}
    </div>
  );
}

function Overview({ d, loading, month }: { d: DashboardResponse | undefined; loading: boolean; month: string }) {
  const actions = useTransactionActions();
  const navigate = useNavigate();
  const s = d?.summary;
  const p = d?.previous;
  const avgExpense = useMemo(() => {
    const months = (d?.monthly ?? []).filter((m) => m.expense > 0);
    return months.length ? Math.round(months.reduce((a, m) => a + m.expense, 0) / months.length) : 0;
  }, [d]);

  const money = (v: number | undefined) => (v === undefined ? <Skeleton className="h-8 w-36" /> : formatBRL(v));

  return (
    <>
      {/* Row 1 — cash flow, health + insights, balances */}
      <div className="grid gap-4 lg:grid-cols-12">
        <div className="lg:col-span-6">
          <CashflowCard monthly={d?.monthly} loading={loading} anchorMonth={month} />
        </div>
        <div className="flex flex-col gap-4 sm:flex-row lg:col-span-3 lg:flex-col">
          <HealthCard health={d?.health} loading={loading} />
          <InsightCard insights={d?.insights} loading={loading} className="flex-1" />
        </div>
        <div className="lg:col-span-3">
          <BalancesCard d={d} loading={loading} />
        </div>
      </div>

      {/* Row 2 — KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Receitas" info="Receitas do mês (recebidas + a receber)" value={money(s?.income)} change={s && p ? percentChange(s.income, p.income) : undefined} href="/contas-a-receber" />
        <KpiCard label="Despesas" info="Despesas do mês, incluindo compras no cartão" value={money(s?.expense)} change={s && p ? percentChange(s.expense, p.expense) : undefined} invert href="/contas-a-pagar" />
        <KpiCard
          label="Eficiência"
          info="Taxa de economia: quanto da receita sobrou no mês"
          value={s ? formatPercent(s.savingsRate ?? 0, 0) : <Skeleton className="h-8 w-20" />}
          change={s && p && s.savingsRate !== null && p.savingsRate !== null ? s.savingsRate - p.savingsRate : undefined}
          href="/relatorios"
        />
        <KpiCard
          label="Patrimônio"
          info="Saldo em contas + investimentos − dívida de cartão"
          value={money(d?.balances.netWorth)}
          footerContent={d ? <span>Investido: <span className="font-semibold text-brand-text">{formatBRL(d.balances.investments)}</span></span> : undefined}
          href="/contas"
        />
      </div>

      {/* Row 3 — Resumo do período */}
      <Card className="p-5">
        <CardHeader title="Resumo do período" subtitle={formatMonthKey(month)} />
        <div className="mt-4 grid gap-4 lg:grid-cols-2 xl:grid-cols-[1fr_1fr_1.4fr]">
          <SummaryBox
            label="Total de receitas"
            value={s?.income}
            change={s && p ? percentChange(s.income, p.income) : undefined}
            pills={[
              { label: 'Recebido 👍', value: s?.paidIncome, tone: 'success' },
              { label: 'A receber 👎', value: s?.pendingIncome, tone: 'danger' },
            ]}
            footerLabel="Saldo (economizado)"
            footerValue={s?.net}
          />
          <SummaryBox
            label="Total de despesas"
            value={s?.expense}
            change={s && p ? percentChange(s.expense, p.expense) : undefined}
            invert
            pills={[
              { label: 'Pago 👍', value: s?.paidExpense, tone: 'success' },
              { label: 'A pagar 👎', value: s?.pendingExpense, tone: 'danger' },
            ]}
            footerLabel="Média mensal (6 meses)"
            footerValue={avgExpense}
          />
          {/* Wider column so the donut sits beside its legend instead of leaving empty space. */}
          <div className="rounded-xl border border-border p-5 lg:col-span-2 xl:col-span-1">
            <p className="text-[13px] font-medium text-muted">Gastos por categoria</p>
            <div className="mt-3">
              {loading ? (
                <Skeleton className="h-44" />
              ) : d && d.expensesByCategory.length ? (
                <DonutChart
                  data={d.expensesByCategory}
                  total={s?.expense ?? 0}
                  height={150}
                  maxItems={4}
                  onSelect={(c) => c.categoryId && navigate(categoryListHref('expense', c.categoryId, month))}
                />
              ) : (
                <EmptyState
                  compact
                  icon={<ChartPie />}
                  title="Nenhuma despesa neste período"
                  description="Registre uma despesa ou selecione outro período para visualizar a distribuição por categoria."
                  action={<WriteGate><Button variant="outline" size="sm" onClick={() => actions.openTransaction({ type: 'expense' })}>Adicionar despesa</Button></WriteGate>}
                />
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* Row 4 — upcoming + goals */}
      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="overflow-hidden lg:col-span-7">
          <div className="p-5 pb-2">
            <CardHeader
              title="Próximos vencimentos"
              subtitle={d?.overdue.count ? `${d.overdue.count} vencido(s) · ${formatBRL(d.overdue.amount)}` : 'Vencidos e próximos 15 dias'}
              action={<Link to="/contas-a-pagar" className="text-xs font-semibold text-brand-text hover:underline">Ver todos →</Link>}
            />
          </div>
          <div className="p-1.5">
            {loading ? (
              <SkeletonRows rows={4} className="p-3" />
            ) : d && d.upcoming.length ? (
              d.upcoming.slice(0, 7).map((t) => <TransactionRow key={t.id} tx={t} />)
            ) : (
              <EmptyState className="m-3" compact icon={<CalendarClock />} title="Nada vencendo por aqui 🎉" description="Contas a pagar e a receber dos próximos 15 dias aparecem aqui." />
            )}
          </div>
        </Card>
        <Card className="p-5 lg:col-span-5">
          <CardHeader title="Metas" action={<Link to="/metas" className="text-xs font-semibold text-brand-text hover:underline">Ver todas</Link>} />
          <div className="mt-4 flex flex-col gap-4">
            {loading ? (
              <SkeletonRows rows={3} />
            ) : d && d.goals.length ? (
              d.goals.slice(0, 4).map((g) => <GoalProgress key={g.id} goal={g} />)
            ) : (
              <EmptyState
                compact
                icon={<Target />}
                title="Você ainda não tem metas ativas"
                description="Metas ajudam a priorizar seu plano financeiro e acompanhar o progresso."
                action={<Button size="sm" asChild><Link to="/metas">Criar meta</Link></Button>}
              />
            )}
          </div>
        </Card>
      </div>

      {/* Row 5 — cards, monthly balance, income distribution */}
      <div className="grid gap-4 lg:grid-cols-3">
        <CardsUsage d={d} loading={loading} />
        <MonthlyBalance d={d} loading={loading} />
        <Card className="p-5">
          <CardHeader title="Distribuição das receitas" subtitle="Mês selecionado" icon={<PieIcon />} />
          <div className="mt-4">
            {loading ? (
              <Skeleton className="h-44" />
            ) : d && d.incomeByCategory.length ? (
              <DonutChart
                data={d.incomeByCategory}
                total={s?.income ?? 0}
                height={150}
                maxItems={4}
                onSelect={(c) => c.categoryId && navigate(categoryListHref('income', c.categoryId, month))}
              />
            ) : (
              <EmptyState compact icon={<PieIcon />} title="Nenhuma receita registrada no período selecionado." />
            )}
          </div>
        </Card>
      </div>

      {/* Row 6 — fixed */}
      <div className="grid gap-4 lg:grid-cols-2">
        <FixedList title="Gastos fixos" type="expense" items={d?.fixedExpenses} loading={loading} />
        <FixedList title="Receitas fixas" type="income" items={d?.fixedIncome} loading={loading} />
      </div>
    </>
  );
}

function SummaryBox({
  label,
  value,
  change,
  invert,
  pills,
  footerLabel,
  footerValue,
}: {
  label: string;
  value: number | undefined;
  change: number | null | undefined;
  invert?: boolean;
  pills: { label: string; value: number | undefined; tone: 'success' | 'danger' }[];
  footerLabel: string;
  footerValue: number | undefined;
}) {
  const up = (change ?? 0) >= 0;
  const good = invert ? !up : up;
  return (
    <div className="flex flex-col rounded-xl border border-border p-5">
      {/* Label and comparison on the left, total on the right (vertically centered). */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-muted">{label}</p>
          <p className="mt-1 text-xs text-muted">
            {change === undefined || change === null ? (
              'Sem base de comparação'
            ) : (
              <>
                <span className={cn('font-semibold', good ? 'text-success' : 'text-danger')}>
                  {up ? '+' : ''}
                  {formatPercent(change)}
                </span>{' '}
                vs mês anterior
              </>
            )}
          </p>
        </div>
        <div className="tabular ml-auto text-right text-[28px] font-bold tracking-tight">
          {value === undefined ? <Skeleton className="h-9 w-40" /> : formatBRL(value)}
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-2">
        {pills.map((p) => (
          <StatPill key={p.label} label={p.label} value={p.value === undefined ? '—' : formatBRL(p.value)} tone={p.tone} />
        ))}
      </div>
      <div className="mt-auto flex items-center justify-between border-t border-border px-3 pt-3 text-[13px]">
        <span className="text-muted">{footerLabel}</span>
        <span className={cn('tabular font-semibold', (footerValue ?? 0) < 0 ? 'text-danger' : 'text-brand-text')}>
          {footerValue === undefined ? '—' : formatBRL(footerValue)}
        </span>
      </div>
    </div>
  );
}

function BalancesCard({ d, loading }: { d: DashboardResponse | undefined; loading: boolean }) {
  const accounts = (d?.accounts ?? []).filter((a) => !a.archived);
  return (
    <Card className="flex h-full flex-col p-5">
      <CardHeader title="Saldo em contas" icon={<Landmark />} />
      {loading ? (
        <Skeleton className="mt-4 h-40" />
      ) : accounts.length === 0 ? (
        <EmptyState
          className="mt-4 flex-1"
          compact
          icon={<Landmark />}
          title="Nenhuma conta"
          description="Cadastre suas contas e carteiras."
          action={<Button size="sm" asChild><Link to="/contas">Adicionar conta</Link></Button>}
        />
      ) : (
        <>
          <div className="mt-4 flex justify-center -space-x-2">
            {accounts.slice(0, 5).map((a) => (
              <BankLogo key={a.id} bank={a.bank} color={a.color} size="md" />
            ))}
          </div>
          <p className="tabular mt-3 text-center text-[26px] font-bold tracking-tight">{formatBRL(d!.balances.accounts)}</p>
          <p className="text-center text-xs text-muted">
            {accounts.length} conta(s) · investido <span className="font-semibold text-brand-text">{formatBRL(d!.balances.investments)}</span>
          </p>
          <ul className="mt-4 flex flex-col gap-1">
            {accounts.slice(0, 5).map((a) => (
              <li key={a.id}>
                <Link to={`/extrato?conta=${a.id}`} className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-surface-muted">
                  <BankLogo bank={a.bank} color={a.color} size="xs" />
                  <span className="flex-1 truncate text-[13px] font-medium">{a.name}</span>
                  <span className={cn('tabular text-[13px] font-semibold', a.balance < 0 && 'text-danger')}>{formatBRL(a.balance)}</span>
                </Link>
              </li>
            ))}
          </ul>
          <Button className="mt-auto w-full" size="md" asChild>
            <Link to="/contas">Gerenciar contas</Link>
          </Button>
        </>
      )}
    </Card>
  );
}

function CardsUsage({ d, loading }: { d: DashboardResponse | undefined; loading: boolean }) {
  const cards = (d?.cards ?? []).filter((c) => !c.archived);
  return (
    <Card className="p-5">
      <CardHeader title="Gastos no cartão de crédito" subtitle="Fatura atual e uso do limite" icon={<CardIcon />} />
      <div className="mt-4 flex flex-col gap-4">
        {loading ? (
          <SkeletonRows rows={2} />
        ) : cards.length === 0 ? (
          <EmptyState compact icon={<CardIcon />} title="Nenhum cartão cadastrado" action={<Button variant="outline" size="sm" asChild><Link to="/cartoes">Adicionar cartão</Link></Button>} />
        ) : (
          cards.slice(0, 4).map((c) => {
            const usage = c.limit ? c.usedLimit / c.limit : 0;
            return (
              <Link key={c.id} to={`/cartoes/${c.id}`} className="group block">
                <div className="flex items-center gap-2.5">
                  <BankLogo bank={c.bank} size="sm" />
                  <span className="flex-1 truncate text-[13px] font-semibold">{c.name}</span>
                  <span className="tabular text-[13px] font-semibold">{formatBRL(c.currentInvoice.total)}</span>
                </div>
                <ProgressBar value={usage} size="sm" className="mt-2" tone={usage > 0.9 ? 'danger' : usage > 0.7 ? 'warning' : 'brand'} />
                <p className="mt-1 text-[11px] text-muted">
                  {formatPercent(usage, 0)} do limite · disponível {formatBRL(c.availableLimit)}
                </p>
              </Link>
            );
          })
        )}
      </div>
    </Card>
  );
}

function MonthlyBalance({ d, loading }: { d: DashboardResponse | undefined; loading: boolean }) {
  const data = (d?.monthly ?? []).map((m) => ({
    label: formatMonthKey(m.month, 'short').split('/')[0],
    saldo: m.net,
    fill: m.net >= 0 ? 'var(--app-success)' : 'var(--app-danger)',
  }));
  const empty = data.every((x) => x.saldo === 0);
  return (
    <Card className="p-5">
      <CardHeader title="Saldo mensal" subtitle="Últimos 6 meses" icon={<Scale />} />
      <div className="mt-4 h-48">
        {loading ? (
          <Skeleton className="h-full" />
        ) : empty ? (
          <EmptyState className="h-full" compact icon={<TrendingUp />} title="Sem movimentações nos últimos 6 meses." />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ left: -12, right: 4, top: 8 }}>
              <CartesianGrid vertical={false} stroke="var(--app-chart-grid)" strokeDasharray="4 4" />
              <XAxis dataKey="label" {...axisProps} />
              <YAxis {...axisProps} tickFormatter={moneyAxisFormatter} width={52} />
              <ReferenceLine y={0} stroke="var(--app-border-strong)" />
              <Tooltip cursor={{ fill: 'var(--app-bg-subtle)' }} content={<MoneyTooltip names={{ saldo: 'Saldo do mês' }} />} />
              <Bar dataKey="saldo" name="saldo" radius={[6, 6, 6, 6]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}

function FixedList({ title, type, items, loading }: { title: string; type: 'income' | 'expense'; items: Transaction[] | undefined; loading: boolean }) {
  const actions = useTransactionActions();
  const total = (items ?? []).reduce((s, t) => s + t.amount, 0);
  return (
    <Card className="overflow-hidden">
      <div className="p-5 pb-2">
        <CardHeader
          title={title}
          subtitle={items?.length ? `${items.length} lançamento(s) · ${formatBRL(total)}/mês` : 'Lançamentos fixos do mês'}
          action={
            <Link to={type === 'expense' ? '/contas-a-pagar' : '/contas-a-receber'} className="flex items-center gap-1 text-xs font-semibold text-brand-text hover:underline">
              Ver todos <ArrowRight className="size-3" />
            </Link>
          }
        />
      </div>
      <div className="p-1.5">
        {loading ? (
          <SkeletonRows rows={3} className="p-3" />
        ) : items && items.length ? (
          items.slice(0, 6).map((t) => <TransactionRow key={t.id} tx={t} />)
        ) : (
          <EmptyState
            className="m-3"
            compact
            title={type === 'expense' ? 'Nenhum gasto fixo cadastrado' : 'Nenhuma receita fixa cadastrada'}
            description={type === 'expense' ? 'Cadastre aluguel, assinaturas e contas mensais para prever o mês com precisão.' : 'Cadastre salário, aluguéis recebidos e outras entradas recorrentes.'}
            action={
              <WriteGate>
                <Button variant="outline" size="sm" onClick={() => actions.openTransaction({ type })}>
                  <Plus /> {type === 'expense' ? 'Adicionar gasto fixo' : 'Adicionar receita fixa'}
                </Button>
              </WriteGate>
            }
          />
        )}
      </div>
    </Card>
  );
}
