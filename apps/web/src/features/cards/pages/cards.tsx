import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { CreditCard as CardIcon, Ellipsis, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { INVOICE_STATUS_LABELS, formatBRL, formatDateBR, formatMonthKey, type CreditCard } from '@effinance/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
import { errorMessage } from '@/lib/api';
import { useCards, useDeleteCard } from '../api';
import { CardSheet } from '../card-sheet';
import { CardVisual } from '../card-visual';
import { PayInvoiceDialog } from '../pay-invoice-dialog';

export const INVOICE_TONE = { open: 'brand', closed: 'warning', paid: 'success', overdue: 'danger' } as const;

export default function CardsPage() {
  const cards = useCards();
  const [sheet, setSheet] = useState<{ open: boolean; card?: CreditCard | null }>({ open: false });
  const [toDelete, setToDelete] = useState<CreditCard | null>(null);
  const [paying, setPaying] = useState<CreditCard | null>(null);
  const del = useDeleteCard();
  const navigate = useNavigate();

  const list = (cards.data ?? []).filter((c) => !c.archived);
  const totalLimit = list.reduce((s, c) => s + c.limit, 0);
  const used = list.reduce((s, c) => s + c.usedLimit, 0);
  const currentInvoices = list.reduce((s, c) => s + c.currentInvoice.unpaidTotal, 0);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        overline="Cadastros"
        title="Cartões de crédito"
        description="Limites, faturas e compras parceladas em um só lugar."
        actions={
          <Button onClick={() => setSheet({ open: true, card: null })}>
            <Plus /> Novo cartão
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniStat label="Limite total" value={formatBRL(totalLimit)} />
        <MiniStat label="Limite utilizado" value={formatBRL(used)} tone="danger" hint={totalLimit ? `${Math.round((used / totalLimit) * 100)}% do limite` : undefined} />
        <MiniStat label="Disponível" value={formatBRL(Math.max(0, totalLimit - used))} tone="success" />
        <MiniStat label="Faturas atuais" value={formatBRL(currentInvoices)} tone="brand" />
      </div>

      {cards.isPending ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-80 rounded-xl" />)}
        </div>
      ) : cards.isError ? (
        <ErrorState error={cards.error} onRetry={() => cards.refetch()} />
      ) : list.length === 0 ? (
        <Card className="p-5">
          <EmptyState
            icon={<CardIcon />}
            title="Nenhum cartão cadastrado"
            description="Cadastre seus cartões com dia de fechamento e vencimento para acompanhar as faturas."
            action={<Button variant="outline" onClick={() => setSheet({ open: true, card: null })}>Adicionar cartão</Button>}
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map((c) => {
            const usage = c.limit ? c.usedLimit / c.limit : 0;
            const inv = c.currentInvoice;
            return (
              <Card key={c.id} className="flex flex-col gap-4 p-4">
                <Link to={`/cartoes/${c.id}`} className="block transition-transform hover:-translate-y-0.5" aria-label={`Abrir ${c.name}`}>
                  <CardVisual card={c} />
                </Link>
                <div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted">Usado {formatBRL(c.usedLimit)}</span>
                    <span className="font-semibold">Limite {formatBRL(c.limit)}</span>
                  </div>
                  <ProgressBar value={usage} tone={usage > 0.9 ? 'danger' : usage > 0.7 ? 'warning' : 'brand'} className="mt-2" label="Uso do limite" />
                </div>
                <div className="flex items-center justify-between gap-3 rounded-lg bg-surface-muted px-3.5 py-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-xs text-muted">
                      Fatura {formatMonthKey(inv.month, 'short')}
                      <Badge tone={INVOICE_TONE[inv.status]}>{INVOICE_STATUS_LABELS[inv.status]}</Badge>
                    </p>
                    <p className="tabular mt-0.5 text-lg font-semibold">{formatBRL(inv.total)}</p>
                    <p className="text-[11px] text-subtle">
                      Fecha {formatDateBR(inv.closingDate).slice(0, 5)} · vence {formatDateBR(inv.dueDate).slice(0, 5)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    {inv.unpaidTotal > 0 ? (
                      <Button size="sm" variant="soft" onClick={() => setPaying(c)}>
                        Pagar
                      </Button>
                    ) : null}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button type="button" className="flex size-8 items-center justify-center rounded-md text-muted hover:bg-bg-subtle hover:text-fg" aria-label={`Ações de ${c.name}`}>
                          <Ellipsis className="size-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem icon={<CardIcon />} onSelect={() => navigate(`/cartoes/${c.id}`)}>
                          Ver faturas
                        </DropdownMenuItem>
                        <DropdownMenuItem icon={<Pencil />} onSelect={() => setSheet({ open: true, card: c })}>Editar</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem icon={<Trash2 />} tone="danger" onSelect={() => setToDelete(c)}>Excluir</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <CardSheet open={sheet.open} card={sheet.card} onOpenChange={(open) => setSheet((s) => ({ ...s, open }))} />
      {paying ? (
        <PayInvoiceDialog open={Boolean(paying)} onOpenChange={(o) => !o && setPaying(null)} card={paying} invoice={paying.currentInvoice} />
      ) : null}
      <ConfirmDialog
        open={Boolean(toDelete)}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Excluir cartão?"
        description={`O cartão "${toDelete?.name}" será excluído. Cartões com compras não podem ser excluídos — arquive-os pela edição.`}
        confirmLabel="Excluir"
        loading={del.isPending}
        onConfirm={async () => {
          try {
            await del.mutateAsync(toDelete!.id);
            toast.success('Cartão excluído');
            setToDelete(null);
          } catch (error) {
            toast.error(errorMessage(error));
          }
        }}
      />
    </div>
  );
}
