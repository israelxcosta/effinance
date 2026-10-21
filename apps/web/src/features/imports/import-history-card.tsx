import { useState } from 'react';
import { ChevronLeft, ChevronRight, FileText, FileUp, History, Landmark, Undo2 } from 'lucide-react';
import type { ImportBatch } from '@effinance/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/misc';
import { SkeletonRows } from '@/components/ui/skeleton';
import { useAccounts } from '@/features/accounts/api';
import { WriteGate } from '@/features/auth/permissions';
import { useCards } from '@/features/cards/api';
import { formatDateTime } from '@/lib/datetime';
import { cn, pluralize } from '@/lib/utils';
import { useImportBatches } from './api';
import { useImportActions } from './import-actions';
import { batchTitle, targetLabel } from './labels';
import { useUndoImportAction } from './use-undo-import';

const PAGE_SIZE = 10;

/** "Histórico de importações": files and Open Finance syncs, with undo per batch. */
export function ImportHistoryCard() {
  const [page, setPage] = useState(1);
  const batches = useImportBatches({ page, pageSize: PAGE_SIZE });
  const accounts = useAccounts({ includeArchived: true });
  const cards = useCards({ includeArchived: true });
  const { openImport } = useImportActions();
  const undo = useUndoImportAction();
  const [toUndo, setToUndo] = useState<ImportBatch | null>(null);
  const [undoing, setUndoing] = useState(false);
  const data = batches.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  async function confirmUndo() {
    if (!toUndo) return;
    setUndoing(true);
    const ok = await undo(toUndo.id);
    setUndoing(false);
    if (ok) setToUndo(null);
  }

  return (
    <Card className="p-6">
      <CardHeader
        title="Histórico de importações"
        subtitle="Arquivos OFX/CSV e sincronizações. Desfazer exclui os lançamentos criados pelo lote."
        action={
          <WriteGate>
            <Button size="sm" variant="outline" onClick={() => openImport()}>
              <FileUp /> Importar arquivo
            </Button>
          </WriteGate>
        }
      />
      <div className="mt-5">
        {batches.isPending ? (
          <SkeletonRows rows={3} />
        ) : batches.isError || !data ? (
          <ErrorState error={batches.error} onRetry={() => batches.refetch()} />
        ) : data.items.length === 0 ? (
          <EmptyState
            icon={<History />}
            title="Nenhuma importação ainda"
            description="Importe o extrato da conta ou a fatura do cartão em OFX ou CSV — você revisa tudo antes de gravar."
            action={
              <WriteGate>
                <Button variant="outline" onClick={() => openImport()}>
                  Importar extrato ou fatura
                </Button>
              </WriteGate>
            }
          />
        ) : (
          <>
            <ul className={cn('divide-y divide-border rounded-lg border border-border', batches.isPlaceholderData && 'opacity-60')}>
              {data.items.map((b) => {
                const undone = b.remainingCount === 0;
                return (
                  <li key={b.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-bg-subtle text-muted">
                      {b.origin === 'open_finance' ? <Landmark className="size-4" /> : <FileText className="size-4" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-fg">
                        <span className="truncate" title={batchTitle(b)}>
                          {batchTitle(b)}
                        </span>
                        {b.format ? <Badge tone="brand">{b.format.toUpperCase()}</Badge> : null}
                        {b.origin === 'open_finance' ? <Badge tone="brand">Open Finance</Badge> : null}
                        {undone ? <Badge>Desfeita</Badge> : null}
                      </p>
                      <p className="mt-0.5 text-xs text-muted">
                        {targetLabel(b, { accounts: accounts.data, cards: cards.data })} · {formatDateTime(b.createdAt)}
                        {b.createdByName ? ` · por ${b.createdByName}` : ''}
                      </p>
                      <p className="mt-0.5 text-xs text-muted">
                        <span className="font-medium text-fg">{pluralize(b.createdCount, 'criado', 'criados')}</span>
                        {b.skippedCount ? ` · ${pluralize(b.skippedCount, 'ignorado', 'ignorados')} (já existiam)` : ''}
                        {!undone && b.remainingCount < b.createdCount ? ` · ${b.remainingCount} ainda no Effinance` : ''}
                      </p>
                    </div>
                    {!undone ? (
                      <WriteGate>
                        <Button variant="ghost" size="sm" onClick={() => setToUndo(b)}>
                          <Undo2 /> Desfazer
                        </Button>
                      </WriteGate>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {pages > 1 ? (
              <div className="mt-3 flex items-center justify-between text-xs text-muted">
                <span>
                  Página {page} de {pages} · {data.total} importações
                </span>
                <div className="flex gap-1">
                  <Button variant="outline" size="icon-sm" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Página anterior">
                    <ChevronLeft />
                  </Button>
                  <Button variant="outline" size="icon-sm" disabled={page >= pages} onClick={() => setPage(page + 1)} aria-label="Próxima página">
                    <ChevronRight />
                  </Button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
      <ConfirmDialog
        open={Boolean(toUndo)}
        onOpenChange={(o) => !o && !undoing && setToUndo(null)}
        title="Desfazer importação?"
        description={
          toUndo
            ? `${pluralize(toUndo.remainingCount, 'lançamento criado', 'lançamentos criados')} por "${batchTitle(toUndo)}" ${toUndo.remainingCount === 1 ? 'será excluído' : 'serão excluídos'}. Lançamentos manuais não são afetados.`
            : undefined
        }
        confirmLabel="Desfazer importação"
        loading={undoing}
        onConfirm={() => void confirmUndo()}
      />
    </Card>
  );
}
