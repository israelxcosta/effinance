import { Fragment, useState } from 'react';
import { ArrowDownToLine, ArrowLeftRight, ChevronDown, ChevronRight, Ellipsis, HandCoins, Pencil, Plus, ShoppingCart, Trash2, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import {
  ASSET_TYPE_LABELS,
  INVESTMENT_INCOME_LABELS,
  formatBRL,
  formatDateBR,
  type InvestmentIncome,
  type InvestmentPosition,
  type InvestmentPurchase,
  type InvestmentSale,
} from '@effinance/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { BankLogo } from '@/components/ui/bank-logo';
import { ConfirmDialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState, MiniStat, PageHeader } from '@/components/ui/misc';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { usePermissions, WriteGate } from '@/features/auth/permissions';
import { toastError } from '@/lib/notify';
import { cn } from '@/lib/utils';
import { formatQuantity, useDeleteIncome, useDeletePurchase, useDeleteSale, usePortfolio } from '../api';
import { byValue, IncomeDialog, SellDialog, type IncomeDialogState } from '../trade-dialogs';
import { useTransactionActions } from '@/features/transactions/transaction-actions';
import { PurchaseSheet, type PurchaseSheetState } from '../purchase-sheet';
import { BrokersDialog } from '../brokers-dialog';

/** Investimentos: purchases by asset, with quantity, average price and share of the portfolio. */
export default function InvestmentsPage() {
  const portfolio = usePortfolio();
  const { canWrite } = usePermissions();
  const [sheet, setSheet] = useState<PurchaseSheetState>({ open: false });
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [toDelete, setToDelete] = useState<InvestmentPurchase | null>(null);
  const del = useDeletePurchase();
  const delSale = useDeleteSale();
  const delIncome = useDeleteIncome();
  const actions = useTransactionActions();
  const [selling, setSelling] = useState<InvestmentPosition | null>(null);
  const [income, setIncome] = useState<IncomeDialogState>({ open: false });
  const [saleToDelete, setSaleToDelete] = useState<InvestmentSale | null>(null);
  const [incomeToDelete, setIncomeToDelete] = useState<InvestmentIncome | null>(null);
  const d = portfolio.data;
  const positions = d?.positions ?? [];
  const purchases = d?.purchases ?? [];
  const sales = d?.sales ?? [];
  const incomes = d?.incomes ?? [];
  const usedBrokers = (d?.brokers ?? []).filter((b) => b.invested > 0);
  const cashBrokers = (d?.brokers ?? []).filter((b) => b.available !== 0);
  const lastBrokerOf = (ticker: string) => purchases.find((x) => x.ticker === ticker)?.accountId ?? null;
  const [brokersOpen, setBrokersOpen] = useState(false);
  // Broker of a position: the single one used, or "N corretoras".
  const brokerOf = (ticker: string) => {
    const names = [...new Set(purchases.filter((x) => x.ticker === ticker).map((x) => x.account?.name ?? '—'))];
    return names.length === 1 ? names[0]! : `${names.length} corretoras`;
  };

  function toggle(ticker: string) {
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(ticker)) next.delete(ticker);
      else next.add(ticker);
      return next;
    });
  }

  async function confirmDeleteSale() {
    if (!saleToDelete) return;
    try {
      await delSale.mutateAsync(saleToDelete.id);
      toast.success('Venda excluída');
      setSaleToDelete(null);
    } catch (error) {
      toastError(error);
    }
  }

  async function confirmDeleteIncome() {
    if (!incomeToDelete) return;
    try {
      await delIncome.mutateAsync(incomeToDelete.id);
      toast.success('Provento excluído');
      setIncomeToDelete(null);
    } catch (error) {
      toastError(error);
    }
  }

  async function confirmDelete() {
    if (!toDelete) return;
    try {
      await del.mutateAsync(toDelete.id);
      toast.success('Compra excluída');
      setToDelete(null);
    } catch (error) {
      toastError(error);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        overline="Patrimônio"
        title="Investimentos"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setBrokersOpen(true)}>
              Corretoras
            </Button>
            <WriteGate>
              <Button variant="outline" onClick={() => setIncome({ open: true })} disabled={!positions.length && !cashBrokers.length}>
                <HandCoins /> Provento
              </Button>
            </WriteGate>
            <WriteGate>
              <Button onClick={() => setSheet({ open: true })}>
                <Plus /> Nova compra
              </Button>
            </WriteGate>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniStat label="Total investido" value={d ? formatBRL(d.totalInvested) : '—'} tone="brand" />
        <MiniStat label="Disponível nas corretoras" value={d ? formatBRL(d.available) : '—'} />
        <MiniStat label="Proventos no ano" value={d ? formatBRL(d.incomesYear) : '—'} tone={d?.incomesYear ? 'success' : undefined} />
        <MiniStat
          label="Resultado de vendas"
          value={d ? signedBRL(d.realizedResult) : '—'}
          tone={d && d.realizedResult < 0 ? 'danger' : d && d.realizedResult > 0 ? 'success' : undefined}
        />
      </div>

      {cashBrokers.length ? (
        <Card className="p-5">
          <h2 className="text-title font-semibold tracking-tight text-fg">Disponível nas corretoras</h2>
          <ul className="mt-2 flex flex-col divide-y divide-border">
            {cashBrokers.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-3 py-3">
                <BankLogo bank={b.bank} color={b.color} size="sm" />
                <span className="min-w-0 flex-1 truncate text-label font-medium text-fg">{b.name}</span>
                <span className={cn('tabular font-semibold', b.available < 0 ? 'text-danger' : 'text-fg')}>{signedBRL(b.available)}</span>
                {canWrite && b.available > 0 ? (
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => actions.openTransfer('redemption', { fromAccountId: b.id, amount: b.available })}>
                      <ArrowLeftRight /> Transferir
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setSheet({ open: true, accountId: b.id })}>
                      <ShoppingCart /> Aplicar
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {portfolio.isPending ? (
        <Card className="flex flex-col gap-2 p-4">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </Card>
      ) : portfolio.isError ? (
        <ErrorState error={portfolio.error} onRetry={() => portfolio.refetch()} />
      ) : positions.length === 0 ? (
        <Card className="p-5">
          <EmptyState
            icon={<TrendingUp />}
            title="Nenhuma compra registrada"
            description="Cadastre o que você comprou (ativo, data, quantidade e preço). Comprou mais do mesmo ativo? O preço médio é recalculado."
            action={
              <WriteGate>
                <Button onClick={() => setSheet({ open: true })}>Registrar primeira compra</Button>
              </WriteGate>
            }
          />
        </Card>
      ) : (
        <>
        {usedBrokers.length > 1 ? (
          <Card className="p-5">
            <h2 className="text-title font-semibold tracking-tight text-fg">Por corretora</h2>
            <ul className="mt-4 flex flex-col gap-3">
              {usedBrokers.map((b) => (
                <li key={b.id} className="grid grid-cols-[minmax(0,10rem)_1fr_7rem] items-center gap-4 text-label">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: b.color }} />
                    <span className="truncate text-fg">{b.name}</span>
                  </span>
                  <ProgressBar value={d ? b.invested / Math.max(1, d.totalInvested) : 0} color={b.color} size="sm" />
                  <span className="text-right font-semibold text-fg tabular">{formatBRL(b.invested)}</span>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
        <Card className="overflow-hidden">
          <div className="border-b border-border p-4">
            <h2 className="text-title font-semibold tracking-tight text-fg">Carteira</h2>
          </div>
          <table className="w-full text-sm max-xl:[&_tr>*:nth-child(6)]:hidden max-xl:[&_tr>*:nth-child(7)]:hidden max-md:[&_tr>*:nth-child(2)]:hidden max-sm:[&_tr>*:nth-child(3)]:hidden max-sm:[&_tr>*:nth-child(4)]:hidden max-sm:[&_tr>*:nth-child(8)]:hidden">
            <thead>
              <tr className="border-b border-border bg-surface-muted text-left text-2xs font-semibold tracking-wide text-muted uppercase">
                <th className="px-4 py-2.5">Ativo</th>
                <th className="px-3 py-2.5">Corretora</th>
                <th className="px-3 py-2.5 text-right">Quantidade</th>
                <th className="px-3 py-2.5 text-right">Preço médio</th>
                <th className="px-3 py-2.5 text-right">Total investido</th>
                <th className="px-3 py-2.5 text-right">Proventos</th>
                <th className="px-3 py-2.5 text-right">Resultado</th>
                <th className="px-2 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {positions.map((p) => {
                const isOpen = open.has(p.ticker);
                const rows = [
                  ...purchases.filter((x) => x.ticker === p.ticker).map((x) => ({ kind: 'purchase' as const, date: x.date, at: x.createdAt, item: x })),
                  ...sales.filter((x) => x.ticker === p.ticker).map((x) => ({ kind: 'sale' as const, date: x.date, at: x.createdAt, item: x })),
                  ...incomes.filter((x) => x.ticker === p.ticker).map((x) => ({ kind: 'income' as const, date: x.date, at: x.createdAt, item: x })),
                ].sort((a, b) => (a.date === b.date ? b.at.localeCompare(a.at) : b.date.localeCompare(a.date)));
                return (
                  <Fragment key={p.ticker}>
                    <tr className="cursor-pointer border-b border-border last:border-0 hover:bg-surface-muted" onClick={() => toggle(p.ticker)}>
                      <td className="px-4 py-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <button
                            type="button"
                            aria-expanded={isOpen}
                            aria-label={`${isOpen ? 'Recolher' : 'Ver'} compras de ${p.ticker}`}
                            className="grid size-5 shrink-0 place-items-center rounded text-muted hover:text-fg"
                          >
                            {isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                          </button>
                          <AssetBadge position={p} />
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-fg">{byValue(p) && p.name ? p.name : p.ticker}</p>
                            <p className="truncate text-xs text-muted">
                              {byValue(p) ? ASSET_TYPE_LABELS[p.assetType] : (p.name ?? ASSET_TYPE_LABELS[p.assetType])}
                              {p.name && !byValue(p) ? ` · ${ASSET_TYPE_LABELS[p.assetType]}` : ''}
                            </p>
                            {/* Phones hide the quantity and average price columns: they go under the name. */}
                            {byValue(p) ? null : (
                              <p className="mt-0.5 text-xs text-fg tabular sm:hidden">
                                {formatQuantity(p.quantity)} × {formatBRL(p.averagePrice)}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="truncate px-3 py-3 text-muted">{brokerOf(p.ticker)}</td>
                      <td className="tabular whitespace-nowrap px-3 py-3 text-right text-fg">{byValue(p) ? '—' : formatQuantity(p.quantity)}</td>
                      <td className="tabular whitespace-nowrap px-3 py-3 text-right text-fg">{byValue(p) ? '—' : formatBRL(p.averagePrice)}</td>
                      <td className="tabular whitespace-nowrap px-3 py-3 text-right font-semibold text-fg">{formatBRL(p.totalInvested)}</td>
                      <td className={cn('tabular whitespace-nowrap px-3 py-3 text-right', p.incomes ? 'text-success' : 'text-muted')}>
                        {p.incomes ? formatBRL(p.incomes) : '—'}
                      </td>
                      <td
                        className={cn(
                          'tabular whitespace-nowrap px-3 py-3 text-right',
                          p.realizedResult < 0 ? 'text-danger' : p.realizedResult > 0 ? 'text-success' : 'text-muted',
                        )}
                      >
                        {p.realizedResult ? signedBRL(p.realizedResult) : '—'}
                      </td>
                      <td className="px-2 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        {canWrite ? (
                          <div className="flex justify-end">
                            <Button variant="ghost" size="icon-sm" aria-label={`Comprar mais ${p.ticker}`} title="Comprar mais" onClick={() => setSheet({ open: true, ticker: p.ticker })}>
                              <ShoppingCart />
                            </Button>
                            <Button variant="ghost" size="icon-sm" aria-label={`Vender ${p.ticker}`} title="Vender" onClick={() => setSelling(p)}>
                              <ArrowDownToLine />
                            </Button>
                            <Button variant="ghost" size="icon-sm" aria-label={`Provento de ${p.ticker}`} title="Provento" onClick={() => setIncome({ open: true, ticker: p.ticker })}>
                              <HandCoins />
                            </Button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                    {isOpen ? (
                      <tr className="border-b border-border bg-surface-muted/60">
                        <td colSpan={8} className="px-3 py-2 sm:px-4 sm:pl-14">
                          {canWrite ? (
                            // Phones hide the actions column: the same actions go here.
                            <div className="flex flex-wrap gap-2 py-2 sm:hidden">
                              <Button variant="outline" size="sm" onClick={() => setSheet({ open: true, ticker: p.ticker })}>
                                <ShoppingCart /> Comprar
                              </Button>
                              <Button variant="outline" size="sm" onClick={() => setSelling(p)}>
                                <ArrowDownToLine /> Vender
                              </Button>
                              <Button variant="outline" size="sm" onClick={() => setIncome({ open: true, ticker: p.ticker })}>
                                <HandCoins /> Provento
                              </Button>
                            </div>
                          ) : null}
                          <ul className="divide-y divide-border">
                            {rows.map((r) =>
                              r.kind === 'purchase' ? (
                                <PurchaseLine key={r.item.id} purchase={r.item} canWrite={canWrite} onEdit={() => setSheet({ open: true, purchase: r.item })} onDelete={() => setToDelete(r.item)} />
                              ) : r.kind === 'sale' ? (
                                <SaleLine key={r.item.id} sale={r.item} byValue={byValue(p)} canWrite={canWrite} onDelete={() => setSaleToDelete(r.item)} />
                              ) : (
                                <IncomeLine key={r.item.id} income={r.item} canWrite={canWrite} onDelete={() => setIncomeToDelete(r.item)} />
                              ),
                            )}
                          </ul>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </Card>
        </>
      )}

      <BrokersDialog open={brokersOpen} onOpenChange={setBrokersOpen} brokers={d?.brokers ?? []} />
      <PurchaseSheet state={sheet} onOpenChange={(o) => setSheet((s) => ({ ...s, open: o }))} positions={positions} purchases={purchases} />
      <SellDialog
        position={selling}
        brokerName={(selling && (d?.brokers ?? []).find((b) => b.id === lastBrokerOf(selling.ticker))?.name) || 'corretora'}
        onClose={() => setSelling(null)}
      />
      <IncomeDialog
        state={income}
        onClose={() => setIncome({ open: false })}
        positions={positions}
        brokers={d?.brokers ?? []}
        brokerOf={lastBrokerOf}
      />
      <ConfirmDialog
        open={Boolean(saleToDelete)}
        onOpenChange={(o) => !o && setSaleToDelete(null)}
        title="Excluir venda?"
        description={saleToDelete ? `${saleToDelete.ticker} em ${formatDateBR(saleToDelete.date)}. As unidades voltam para a carteira.` : undefined}
        confirmLabel="Excluir"
        tone="danger"
        loading={delSale.isPending}
        onConfirm={confirmDeleteSale}
      />
      <ConfirmDialog
        open={Boolean(incomeToDelete)}
        onOpenChange={(o) => !o && setIncomeToDelete(null)}
        title="Excluir provento?"
        description={incomeToDelete ? `${INVESTMENT_INCOME_LABELS[incomeToDelete.kind]} de ${formatBRL(incomeToDelete.amount)} em ${formatDateBR(incomeToDelete.date)}. A receita sai do extrato.` : undefined}
        confirmLabel="Excluir"
        tone="danger"
        loading={delIncome.isPending}
        onConfirm={confirmDeleteIncome}
      />
      <ConfirmDialog
        open={Boolean(toDelete)}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Excluir compra?"
        description={toDelete ? `${toDelete.ticker} · ${formatQuantity(toDelete.quantity)} × ${formatBRL(toDelete.unitPrice)} em ${formatDateBR(toDelete.date)}. O preço médio será recalculado.` : undefined}
        confirmLabel="Excluir"
        tone="danger"
        loading={del.isPending}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

function AssetBadge({ position }: { position: InvestmentPosition }) {
  return (
    <span className="hidden size-9 shrink-0 place-items-center rounded-md bg-primary-soft text-2xs font-bold text-primary-soft-fg sm:grid" aria-hidden>
      {position.ticker.slice(0, 4)}
    </span>
  );
}

const signedBRL = (v: number) => (v < 0 ? `−${formatBRL(-v)}` : formatBRL(v));

function DeleteMenu({ label, onDelete }: { label: string; onDelete: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="flex size-8 shrink-0 items-center justify-center rounded-sm text-muted hover:bg-bg-subtle hover:text-fg" aria-label={label}>
          <Ellipsis className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem icon={<Trash2 />} tone="danger" onSelect={onDelete}>
          Excluir
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SaleLine({ sale: x, byValue: value, canWrite, onDelete }: { sale: InvestmentSale; byValue: boolean; canWrite: boolean; onDelete: () => void }) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-label">
      <span className="w-24 shrink-0 tabular text-muted">{formatDateBR(x.date)}</span>
      <span className="order-last w-full min-w-0 text-fg sm:order-none sm:w-auto sm:flex-1">
        <span className="font-medium">Venda</span>
        {value ? null : <span className="tabular"> · {formatQuantity(x.quantity)} × {formatBRL(x.unitPrice)}</span>}
        <span className={cn('tabular', x.result < 0 ? 'text-danger' : x.result > 0 ? 'text-success' : 'text-muted')}>
          {' '}· {x.result < 0 ? 'prejuízo' : 'lucro'} {signedBRL(x.result)}
        </span>
      </span>
      <span className="ml-auto w-28 shrink-0 text-right tabular font-semibold text-fg">{formatBRL(x.proceeds)}</span>
      {canWrite ? <DeleteMenu label={`Ações da venda de ${formatDateBR(x.date)}`} onDelete={onDelete} /> : null}
    </li>
  );
}

function IncomeLine({ income: x, canWrite, onDelete }: { income: InvestmentIncome; canWrite: boolean; onDelete: () => void }) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-label">
      <span className="w-24 shrink-0 tabular text-muted">{formatDateBR(x.date)}</span>
      <span className="order-last w-full min-w-0 font-medium text-fg sm:order-none sm:w-auto sm:flex-1">{INVESTMENT_INCOME_LABELS[x.kind]}</span>
      <span className="ml-auto w-28 shrink-0 text-right tabular font-semibold text-success">+{formatBRL(x.amount)}</span>
      {canWrite ? <DeleteMenu label={`Ações do provento de ${formatDateBR(x.date)}`} onDelete={onDelete} /> : null}
    </li>
  );
}

function PurchaseLine({ purchase: x, canWrite, onEdit, onDelete }: { purchase: InvestmentPurchase; canWrite: boolean; onEdit: () => void; onDelete: () => void }) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-label">
      <span className="w-24 shrink-0 tabular text-muted">{formatDateBR(x.date)}</span>
      <span className="order-last w-full min-w-0 tabular text-fg sm:order-none sm:w-auto sm:flex-1">
        {byValue(x) ? null : `${formatQuantity(x.quantity)} × ${formatBRL(x.unitPrice)}`}
        {x.fees ? <span className="text-muted"> + {formatBRL(x.fees)} de taxas</span> : null}
      </span>
      {x.account ? (
        <span className={cn('hidden min-w-0 items-center gap-1.5 text-xs text-muted md:flex')}>
          <BankLogo bank={x.account.bank} color={x.account.color} size="xs" />
          <span className="truncate">{x.account.name}</span>
        </span>
      ) : null}
      <span className="ml-auto w-28 shrink-0 text-right tabular font-semibold text-fg">{formatBRL(x.total)}</span>
      {canWrite ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="flex size-8 shrink-0 items-center justify-center rounded-sm text-muted hover:bg-bg-subtle hover:text-fg" aria-label={`Ações da compra de ${formatDateBR(x.date)}`}>
              <Ellipsis className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem icon={<Pencil />} onSelect={onEdit}>
              Editar
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem icon={<Trash2 />} tone="danger" onSelect={onDelete}>
              Excluir
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </li>
  );
}

