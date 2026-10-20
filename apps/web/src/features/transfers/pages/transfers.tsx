import { useSearchParams } from 'react-router';
import { ArrowLeftRight, PiggyBank, TrendingDown, TrendingUp } from 'lucide-react';
import { formatBRL, todayISO, type TransferKind } from '@effinance/shared';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { BankLogo } from '@/components/ui/bank-logo';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState, MiniStat, PageHeader } from '@/components/ui/misc';
import { PeriodNavigator } from '@/components/ui/period-navigator';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Skeleton, SkeletonRows } from '@/components/ui/skeleton';
import { periodRange, type PeriodMode, type PeriodValue } from '@/lib/period';
import { useAccounts } from '@/features/accounts/api';
import { useTransactionActions } from '@/features/transactions/transaction-actions';
import { TransactionRow } from '@/features/transactions/components/transaction-row';
import { useTransfers } from '../api';

type KindFilter = 'all' | TransferKind;

export default function TransfersPage() {
  const [params, setParams] = useSearchParams();
  const actions = useTransactionActions();
  const kind = (params.get('tipo') as KindFilter) || 'all';
  const period: PeriodValue = { mode: (params.get('modo') as PeriodMode) || 'month', anchor: params.get('data') || todayISO() };
  const range = periodRange(period);

  function update(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  }

  const accounts = useAccounts();
  const transfers = useTransfers({ from: range.from, to: range.to, kind: kind === 'all' ? undefined : kind, pageSize: 200 });
  const allInPeriod = useTransfers({ from: range.from, to: range.to, pageSize: 200 });

  const investmentAccounts = (accounts.data ?? []).filter((a) => a.type === 'investment' && !a.archived);
  const invested = investmentAccounts.reduce((s, a) => s + a.balance, 0);
  const items = allInPeriod.data?.items ?? [];
  const applied = items.filter((t) => t.transferKind === 'investment').reduce((s, t) => s + t.amount, 0);
  const redeemed = items.filter((t) => t.transferKind === 'redemption').reduce((s, t) => s + t.amount, 0);
  const moved = items.filter((t) => t.transferKind === 'transfer').reduce((s, t) => s + t.amount, 0);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        overline="Movimentações"
        title="Transferências e investimentos"
        description="Mova dinheiro entre contas, aplique em investimentos e acompanhe o saldo investido à parte."
        actions={
          <>
            <Button variant="outline" onClick={() => actions.openTransfer('redemption')}>
              <TrendingDown /> Resgatar
            </Button>
            <Button variant="soft" onClick={() => actions.openTransfer('investment')}>
              <TrendingUp /> Investir
            </Button>
            <Button onClick={() => actions.openTransfer('transfer')}>
              <ArrowLeftRight /> Transferir
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <MiniStat label="Total investido" value={accounts.isPending ? '—' : formatBRL(invested)} tone="brand" hint="Somado à parte do saldo em contas" />
            <MiniStat label="Aplicado no período" value={formatBRL(applied)} tone="success" />
            <MiniStat label="Resgatado no período" value={formatBRL(redeemed)} tone="warning" />
            <MiniStat label="Transferido" value={formatBRL(moved)} />
          </div>

          <Card className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <PeriodNavigator
                value={period}
                modes={['week', 'month', 'year']}
                onChange={(v) => update({ modo: v.mode === 'month' ? null : v.mode, data: v.anchor === todayISO() ? null : v.anchor })}
              />
              <SegmentedControl
                ariaLabel="Tipo"
                value={kind}
                onChange={(k) => update({ tipo: k === 'all' ? null : k })}
                options={[
                  { value: 'all', label: 'Todas' },
                  { value: 'transfer', label: 'Transferências' },
                  { value: 'investment', label: 'Aplicações' },
                  { value: 'redemption', label: 'Resgates' },
                  { value: 'card_payment', label: 'Faturas' },
                ]}
              />
            </div>
          </Card>

          <Card className="overflow-hidden p-1.5">
            {transfers.isPending ? (
              <SkeletonRows rows={5} className="p-3" />
            ) : transfers.isError ? (
              <ErrorState error={transfers.error} onRetry={() => transfers.refetch()} className="m-3" />
            ) : transfers.data.items.length === 0 ? (
              <EmptyState
                className="m-3"
                icon={<ArrowLeftRight />}
                title="Nenhuma movimentação no período"
                description="Transfira entre contas ou aplique em uma conta de investimento."
                action={
                  <Button variant="outline" onClick={() => actions.openTransfer('transfer')}>
                    Nova transferência
                  </Button>
                }
              />
            ) : (
              transfers.data.items.map((t) => <TransactionRow key={t.id} tx={t} amount={t.amount} />)
            )}
          </Card>
        </div>

        <Card className="h-fit p-5">
          <CardHeader title="Investimentos" subtitle="Saldo por conta de investimento" icon={<PiggyBank />} />
          <div className="mt-4 rounded-xl bg-gradient-to-br from-hero-from to-hero-to p-5 text-white">
            <p className="eyebrow text-white/70">Patrimônio investido</p>
            <p className="tabular mt-2 text-[28px] font-semibold tracking-tight">{formatBRL(invested)}</p>
            <p className="mt-1 text-xs text-white/70">{investmentAccounts.length} conta(s) de investimento</p>
          </div>
          <div className="mt-4 flex flex-col gap-1">
            {accounts.isPending ? (
              <Skeleton className="h-12" />
            ) : investmentAccounts.length === 0 ? (
              <EmptyState
                compact
                icon={<TrendingUp />}
                title="Nenhuma conta de investimento"
                description="Crie uma conta do tipo Investimento em Contas e carteiras."
              />
            ) : (
              investmentAccounts.map((a) => (
                <div key={a.id} className="flex items-center gap-3 rounded-md px-2 py-2.5 hover:bg-surface-muted">
                  <BankLogo bank={a.bank} color={a.color} size="sm" />
                  <span className="flex-1 truncate text-sm font-medium">{a.name}</span>
                  <span className="tabular text-sm font-semibold">{formatBRL(a.balance)}</span>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
