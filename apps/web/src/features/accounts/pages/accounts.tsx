import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Archive, ArchiveRestore, Ellipsis, FileUp, Landmark, Pencil, Plug, Plus, ScrollText, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ACCOUNT_TYPE_LABELS, formatBRL, type Account } from '@effinance/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { BankLogo } from '@/components/ui/bank-logo';
import { ConfirmDialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState, MiniStat, PageHeader } from '@/components/ui/misc';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { alpha, cn } from '@/lib/utils';
import { useAccounts, useDeleteAccount, useSaveAccount } from '../api';
import { AccountSheet } from '../account-sheet';
import { useTone } from '@/lib/theme';
import { toastError } from '@/lib/notify';
import { usePermissions, WriteGate } from '@/features/auth/permissions';
import { useImportActions } from '@/features/imports/import-actions';
import { useOpenFinanceStatus } from '@/features/open-finance/api';
import { useBankConnectFlow } from '@/features/open-finance/connect-flow';

export default function AccountsPage() {
  const readOnly = !usePermissions().canWrite;
  const [showArchived, setShowArchived] = useState(false);
  const tone = useTone();
  const accounts = useAccounts({ includeArchived: showArchived });
  const [sheet, setSheet] = useState<{ open: boolean; account?: Account | null }>({ open: false });
  const [toDelete, setToDelete] = useState<Account | null>(null);
  const del = useDeleteAccount();
  const save = useSaveAccount();
  const navigate = useNavigate();
  const { openImport } = useImportActions();
  const openFinance = useOpenFinanceStatus();
  const connectFlow = useBankConnectFlow();

  const list = accounts.data ?? [];
  const active = list.filter((a) => !a.archived);
  const inTotal = active.filter((a) => a.type !== 'investment' && a.includeInTotal).reduce((s, a) => s + a.balance, 0);
  const invested = active.filter((a) => a.type === 'investment').reduce((s, a) => s + a.balance, 0);
  const projected = active.filter((a) => a.type !== 'investment' && a.includeInTotal).reduce((s, a) => s + a.projectedBalance, 0);

  async function toggleArchive(a: Account) {
    try {
      await save.mutateAsync({
        id: a.id,
        input: { name: a.name, type: a.type, bank: a.bank, color: a.color, icon: a.icon, initialBalance: a.initialBalance, includeInTotal: a.includeInTotal, archived: !a.archived },
      });
      toast.success(a.archived ? 'Conta reativada' : 'Conta arquivada');
    } catch (error) {
      toastError(error);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        overline="Cadastros"
        title="Contas e carteiras"
        description="Contas bancárias, carteiras, vale-benefício e investimentos."
        actions={
          <>
            <label className="mr-2 flex cursor-pointer items-center gap-2 text-[13px] font-medium text-muted">
              <Switch checked={showArchived} onCheckedChange={setShowArchived} aria-label="Mostrar arquivadas" /> Arquivadas
            </label>
            {openFinance.enabled ? (
              <WriteGate>
                <Button variant="outline" onClick={() => connectFlow.connect()} loading={connectFlow.busy}>
                  <Plug /> Conectar banco
                </Button>
              </WriteGate>
            ) : null}
            <WriteGate>
              <Button onClick={() => setSheet({ open: true, account: null })}>
                <Plus /> Nova conta
              </Button>
            </WriteGate>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniStat label="Saldo em contas" value={formatBRL(inTotal)} tone={inTotal < 0 ? 'danger' : undefined} />
        <MiniStat label="Investimentos" value={formatBRL(invested)} tone="brand" hint="Somados à parte" />
        <MiniStat label="Patrimônio" value={formatBRL(inTotal + invested)} />
        <MiniStat label="Previsto fim do mês" value={formatBRL(projected)} hint="Contas + pendentes do mês" />
      </div>

      {accounts.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      ) : accounts.isError ? (
        <ErrorState error={accounts.error} onRetry={() => accounts.refetch()} />
      ) : list.length === 0 ? (
        <Card className="p-5">
          <EmptyState
            icon={<Landmark />}
            title="Nenhuma conta cadastrada"
            description="Adicione suas contas e carteiras para acompanhar saldos e extratos."
            action={<WriteGate><Button variant="outline" onClick={() => setSheet({ open: true, account: null })}>Adicionar conta</Button></WriteGate>}
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((a) => (
            <Card
              key={a.id}
              className={cn('group relative flex flex-col gap-5 overflow-hidden p-5 transition-shadow hover:shadow-sm', a.archived && 'opacity-60')}
            >
              <div className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: tone(a.color) }} aria-hidden />
              <div className="flex items-start gap-3">
                <BankLogo bank={a.bank} color={a.color} size="lg" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold">{a.name}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <Badge tone={a.type === 'investment' ? 'brand' : 'neutral'}>{ACCOUNT_TYPE_LABELS[a.type]}</Badge>
                    {!a.includeInTotal && a.type !== 'investment' ? <Badge tone="warning">Fora do total</Badge> : null}
                    {a.archived ? <Badge>Arquivada</Badge> : null}
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button type="button" className="flex size-8 items-center justify-center rounded-md text-muted hover:bg-bg-subtle hover:text-fg" aria-label={`Ações de ${a.name}`}>
                      <Ellipsis className="size-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem icon={<Pencil />} disabled={readOnly} onSelect={() => setSheet({ open: true, account: a })}>Editar</DropdownMenuItem>
                    <DropdownMenuItem icon={<ScrollText />} onSelect={() => navigate(`/extrato?conta=${a.id}`)}>Ver extrato</DropdownMenuItem>
                    <DropdownMenuItem icon={<FileUp />} disabled={readOnly || a.archived} onSelect={() => openImport({ target: { kind: 'account', accountId: a.id } })}>
                      Importar extrato
                    </DropdownMenuItem>
                    <DropdownMenuItem icon={a.archived ? <ArchiveRestore /> : <Archive />} disabled={readOnly} onSelect={() => void toggleArchive(a)}>
                      {a.archived ? 'Reativar' : 'Arquivar'}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem icon={<Trash2 />} tone="danger" disabled={readOnly} onSelect={() => setToDelete(a)}>Excluir</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div>
                <p className="text-xs font-medium text-muted">Saldo atual</p>
                <p className={cn('tabular mt-1 text-[26px] font-semibold tracking-tight', a.balance < 0 && 'text-danger')}>{formatBRL(a.balance)}</p>
              </div>
              <div
                className="flex items-center justify-between rounded-md px-3 py-2 text-xs"
                style={{ backgroundColor: alpha(a.color, 0.08) }}
              >
                <span className="text-muted">Previsto fim do mês</span>
                <span className={cn('tabular font-semibold', a.projectedBalance < 0 ? 'text-danger' : 'text-fg')}>{formatBRL(a.projectedBalance)}</span>
              </div>
            </Card>
          ))}
        </div>
      )}

      {connectFlow.element}
      <AccountSheet open={sheet.open} account={sheet.account} onOpenChange={(open) => setSheet((s) => ({ ...s, open }))} />
      <ConfirmDialog
        open={Boolean(toDelete)}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Excluir conta?"
        description={`A conta "${toDelete?.name}" será excluída. Contas com lançamentos não podem ser excluídas — arquive-as para preservar o histórico.`}
        confirmLabel="Excluir"
        loading={del.isPending}
        onConfirm={async () => {
          try {
            await del.mutateAsync(toDelete!.id);
            toast.success('Conta excluída');
            setToDelete(null);
          } catch (error) {
            toastError(error);
          }
        }}
      />
    </div>
  );
}
