import { Fragment, useState } from 'react';
import { ChevronDown, ChevronRight, Ellipsis, Pencil, Plus, ShoppingCart, Trash2, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import {
  ASSET_TYPE_LABELS,
  formatBRL,
  formatDateBR,
  formatPercent,
  type InvestmentPosition,
  type InvestmentPurchase,
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
import { formatQuantity, useDeletePurchase, usePortfolio } from '../api';
import { PurchaseSheet, type PurchaseSheetState } from '../purchase-sheet';

/** Investimentos: purchases by asset, with quantity, average price and share of the portfolio. */
export default function InvestmentsPage() {
  const portfolio = usePortfolio();
  const { canWrite } = usePermissions();
  const [sheet, setSheet] = useState<PurchaseSheetState>({ open: false });
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [toDelete, setToDelete] = useState<InvestmentPurchase | null>(null);
  const del = useDeletePurchase();
  const d = portfolio.data;
  const positions = d?.positions ?? [];
  const purchases = d?.purchases ?? [];
  const biggest = positions[0];

  function toggle(ticker: string) {
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(ticker)) next.delete(ticker);
      else next.add(ticker);
      return next;
    });
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
        description="Registre suas compras: o Effinance soma a quantidade e calcula o preço médio de cada ativo."
        actions={
          <WriteGate>
            <Button onClick={() => setSheet({ open: true })}>
              <Plus /> Nova compra
            </Button>
          </WriteGate>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniStat label="Total investido" value={d ? formatBRL(d.totalInvested) : '—'} tone="brand" hint="Valor pago, com taxas" />
        <MiniStat label="Ativos" value={d ? String(positions.length) : '—'} hint={d ? `${purchases.length} ${purchases.length === 1 ? 'compra' : 'compras'}` : undefined} />
        <MiniStat label="Maior posição" value={biggest ? biggest.ticker : '—'} hint={biggest ? `${formatPercent(biggest.share, 0)} da carteira` : undefined} />
        <MiniStat label="Última compra" value={purchases[0] ? formatDateBR(purchases[0].date) : '—'} hint={purchases[0]?.ticker} />
      </div>

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
        <Card className="overflow-hidden">
          <div className="border-b border-border p-4">
            <h2 className="text-title font-semibold tracking-tight text-fg">Carteira</h2>
            <p className="mt-0.5 text-xs text-muted">Posição por ativo · preço médio com taxas · clique para ver as compras</p>
          </div>
          <table className="w-full text-sm max-md:[&_tr>*:nth-child(5)]:hidden max-sm:[&_tr>*:nth-child(2)]:hidden max-sm:[&_tr>*:nth-child(3)]:hidden max-sm:[&_tr>*:nth-child(6)]:hidden">
            <thead>
              <tr className="border-b border-border bg-surface-muted text-left text-2xs font-semibold tracking-wide text-muted uppercase">
                <th className="px-4 py-2.5">Ativo</th>
                <th className="px-3 py-2.5 text-right">Quantidade</th>
                <th className="px-3 py-2.5 text-right">Preço médio</th>
                <th className="px-3 py-2.5 text-right">Total investido</th>
                <th className="w-44 px-4 py-2.5">Na carteira</th>
                <th className="w-10 px-2 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {positions.map((p) => {
                const isOpen = open.has(p.ticker);
                const rows = purchases.filter((x) => x.ticker === p.ticker);
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
                            <p className="truncate font-semibold text-fg">{p.ticker}</p>
                            <p className="truncate text-xs text-muted">
                              {p.name ?? ASSET_TYPE_LABELS[p.assetType]}
                              {p.name ? ` · ${ASSET_TYPE_LABELS[p.assetType]}` : ''}
                            </p>
                            {/* Phones hide the quantity and average price columns: they go under the name. */}
                            <p className="mt-0.5 text-xs text-fg tabular sm:hidden">
                              {formatQuantity(p.quantity)} × {formatBRL(p.averagePrice)}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="tabular whitespace-nowrap px-3 py-3 text-right text-fg">{formatQuantity(p.quantity)}</td>
                      <td className="tabular whitespace-nowrap px-3 py-3 text-right text-fg">{formatBRL(p.averagePrice)}</td>
                      <td className="tabular whitespace-nowrap px-3 py-3 text-right font-semibold text-fg">{formatBRL(p.totalInvested)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <ProgressBar value={p.share} size="sm" />
                          <span className="w-10 text-right text-xs text-muted">{formatPercent(p.share, 0)}</span>
                        </div>
                      </td>
                      <td className="px-2 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        {canWrite ? (
                          <Button variant="ghost" size="icon-sm" aria-label={`Comprar mais ${p.ticker}`} title="Comprar mais" onClick={() => setSheet({ open: true, ticker: p.ticker })}>
                            <ShoppingCart />
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                    {isOpen ? (
                      <tr className="border-b border-border bg-surface-muted/60">
                        <td colSpan={6} className="px-3 py-2 sm:px-4 sm:pl-14">
                          <ul className="divide-y divide-border">
                            {rows.map((x) => (
                              <PurchaseLine key={x.id} purchase={x} canWrite={canWrite} onEdit={() => setSheet({ open: true, purchase: x })} onDelete={() => setToDelete(x)} />
                            ))}
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
      )}

      <PurchaseSheet state={sheet} onOpenChange={(o) => setSheet((s) => ({ ...s, open: o }))} positions={positions} purchases={purchases} />
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

function PurchaseLine({ purchase: x, canWrite, onEdit, onDelete }: { purchase: InvestmentPurchase; canWrite: boolean; onEdit: () => void; onDelete: () => void }) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-label">
      <span className="w-24 shrink-0 tabular text-muted">{formatDateBR(x.date)}</span>
      <span className="order-last w-full min-w-0 tabular text-fg sm:order-none sm:w-auto sm:flex-1">
        {formatQuantity(x.quantity)} × {formatBRL(x.unitPrice)}
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

