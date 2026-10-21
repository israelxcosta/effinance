import { useState } from 'react';
import { toast } from 'sonner';
import { ArrowRight, CreditCard, Ellipsis, Landmark, Plug, RefreshCw, Settings2, TriangleAlert, Unplug } from 'lucide-react';
import {
  BANK_CONNECTION_STATUS_LABELS,
  formatDateBR,
  type BankConnection,
  type BankConnectionAccount,
  type BankConnectionStatus,
} from '@effinance/shared';
import { Badge } from '@/components/ui/badge';
import { BankLogo } from '@/components/ui/bank-logo';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/misc';
import { SkeletonRows } from '@/components/ui/skeleton';
import { useAccounts } from '@/features/accounts/api';
import { usePermissions, WriteGate } from '@/features/auth/permissions';
import { useCards } from '@/features/cards/api';
import { formatRelative } from '@/lib/datetime';
import { toastError } from '@/lib/notify';
import { cn } from '@/lib/utils';
import { useBankConnections, useDeleteConnection, useSyncConnection } from './api';
import { OpenFinanceTransparency, syncSummary, useBankConnectFlow } from './connect-flow';

const STATUS_TONE: Record<BankConnectionStatus, 'brand' | 'success' | 'warning' | 'danger'> = {
  syncing: 'brand',
  active: 'success',
  waiting_user_input: 'warning',
  outdated: 'warning',
  login_error: 'danger',
  error: 'danger',
};

/** Consent expiring within this many days shows the renewal warning. */
const CONSENT_WARNING_DAYS = 30;

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

/** "Bancos conectados" (Configurações → Integrações). */
export function BankConnectionsCard() {
  const connections = useBankConnections();
  const flow = useBankConnectFlow();
  const { readOnlyReason } = usePermissions();
  const list = connections.data ?? [];

  return (
    <Card className="p-6">
      <CardHeader
        title="Bancos conectados"
        subtitle="Open Finance Brasil: lançamentos e faturas chegam sozinhos, somente leitura."
        action={
          <WriteGate>
            <Button size="sm" onClick={() => flow.connect()} loading={flow.busy}>
              <Plug /> Conectar banco
            </Button>
          </WriteGate>
        }
      />
      <div className="mt-4 rounded-lg bg-surface-muted px-4 py-3.5">
        <OpenFinanceTransparency compact />
      </div>
      <div className="mt-5">
        {connections.isPending ? (
          <SkeletonRows rows={2} />
        ) : connections.isError ? (
          <ErrorState error={connections.error} onRetry={() => connections.refetch()} />
        ) : list.length === 0 ? (
          <EmptyState
            icon={<Landmark />}
            title="Nenhum banco conectado"
            description="Conecte sua conta ou cartão para importar os lançamentos automaticamente, sem digitar nem baixar arquivos."
            action={
              <WriteGate>
                <Button variant="outline" onClick={() => flow.connect()}>
                  Conectar banco
                </Button>
              </WriteGate>
            }
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {list.map((c) => (
              <ConnectionItem
                key={c.id}
                connection={c}
                readOnly={Boolean(readOnlyReason)}
                onRenew={() => flow.connect({ connectionId: c.id, institution: c.institution.name })}
                onManage={() => flow.manage(c)}
              />
            ))}
          </ul>
        )}
      </div>
      {flow.element}
    </Card>
  );
}

function ConnectionItem({
  connection: c,
  readOnly,
  onRenew,
  onManage,
}: {
  connection: BankConnection;
  readOnly: boolean;
  onRenew: () => void;
  onManage: () => void;
}) {
  const sync = useSyncConnection();
  const remove = useDeleteConnection();
  const accounts = useAccounts();
  const cards = useCards();
  const [confirming, setConfirming] = useState(false);
  const days = c.consentExpiresAt ? daysUntil(c.consentExpiresAt) : null;
  const expiring = days !== null && days <= CONSENT_WARNING_DAYS;
  const needsConsent = expiring || c.status === 'outdated' || c.status === 'login_error' || c.status === 'waiting_user_input';
  const linked = c.accounts.filter((a) => a.linkedAccountId || a.linkedCreditCardId);

  async function syncNow() {
    try {
      toast.success(syncSummary(await sync.mutateAsync(c.id)));
    } catch (error) {
      toastError(error);
    }
  }

  async function disconnect() {
    try {
      await remove.mutateAsync(c.id);
      setConfirming(false);
      toast.success(`${c.institution.name} desconectado`, { description: 'O acesso foi revogado. Os lançamentos importados continuam no Effinance.' });
    } catch (error) {
      toastError(error);
    }
  }

  function targetName(a: BankConnectionAccount): string | null {
    if (a.linkedAccountId) return accounts.data?.find((x) => x.id === a.linkedAccountId)?.name ?? 'Conta vinculada';
    if (a.linkedCreditCardId) return cards.data?.find((x) => x.id === a.linkedCreditCardId)?.name ?? 'Cartão vinculado';
    return null;
  }

  return (
    <li className="rounded-lg border border-border">
      <div className="flex flex-wrap items-start gap-3 p-4">
        <BankLogo bank={c.institution.bank} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-[15px] font-semibold text-fg">{c.institution.name}</p>
            <Badge tone={STATUS_TONE[c.status]}>
              {c.status === 'syncing' ? <RefreshCw className="animate-spin" aria-hidden /> : null}
              {BANK_CONNECTION_STATUS_LABELS[c.status]}
            </Badge>
          </div>
          <p className="mt-0.5 text-xs text-muted">
            {c.lastSyncAt
              ? `Última sincronização ${Date.now() - new Date(c.lastSyncAt).getTime() < 60_000 ? 'agora há pouco' : formatRelative(c.lastSyncAt)}`
              : 'Ainda não sincronizado'}
            {c.consentExpiresAt && !expiring ? ` · consentimento até ${formatDateBR(c.consentExpiresAt.slice(0, 10))}` : ''}
          </p>
          {c.statusDetail && c.status !== 'active' ? <p className="mt-1 text-xs text-muted">{c.statusDetail}</p> : null}
        </div>
        <div className="flex items-center gap-1.5">
          <WriteGate>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void syncNow()}
              loading={sync.isPending}
              disabled={c.status === 'syncing'}
              aria-label="Sincronizar agora"
            >
              {sync.isPending ? null : <RefreshCw />}
              <span className="hidden sm:inline">Sincronizar agora</span>
            </Button>
          </WriteGate>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex size-8 items-center justify-center rounded-md text-muted hover:bg-bg-subtle hover:text-fg"
                aria-label={`Mais ações de ${c.institution.name}`}
              >
                <Ellipsis className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem icon={<Settings2 />} disabled={readOnly} onSelect={onManage}>
                Gerenciar contas
              </DropdownMenuItem>
              <DropdownMenuItem icon={<RefreshCw />} disabled={readOnly} onSelect={onRenew}>
                Renovar consentimento
              </DropdownMenuItem>
              <DropdownMenuItem icon={<Unplug />} tone="danger" disabled={readOnly} onSelect={() => setConfirming(true)}>
                Desconectar
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {needsConsent ? (
        <div className="mx-4 mb-3 flex flex-wrap items-center gap-3 rounded-md bg-warning-soft px-3 py-2.5 text-[13px] text-warning">
          <TriangleAlert className="size-4 shrink-0 self-start sm:self-center" />
          <span className="min-w-[12rem] flex-1">
            {c.status === 'outdated' || (days !== null && days < 0)
              ? 'O consentimento expirou: a sincronização está pausada até você renovar.'
              : c.status === 'login_error'
                ? 'O banco recusou o consentimento. Autorize novamente para voltar a sincronizar.'
                : c.status === 'waiting_user_input'
                  ? 'O banco aguarda a sua confirmação para continuar.'
                  : `O consentimento expira ${days === 0 ? 'hoje' : days === 1 ? 'amanhã' : `em ${days} dias`} (${formatDateBR(c.consentExpiresAt!.slice(0, 10))}).`}
          </span>
          <WriteGate>
            <Button size="xs" variant="outline" onClick={onRenew}>
              Renovar consentimento
            </Button>
          </WriteGate>
        </div>
      ) : null}

      {c.accounts.length ? (
        <ul className="border-t border-border px-4 py-2" aria-label={`Contas de ${c.institution.name}`}>
          {c.accounts.map((a) => {
            const target = targetName(a);
            return (
              <li key={a.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1.5 text-[13px]">
                {a.kind === 'credit_card' ? <CreditCard className="size-3.5 text-muted" aria-hidden /> : <Landmark className="size-3.5 text-muted" aria-hidden />}
                <span className="font-medium text-fg">{a.name}</span>
                {a.number ? <span className="text-xs text-subtle">final {a.number.replace(/\D/g, '').slice(-4) || a.number}</span> : null}
                <ArrowRight className="size-3.5 text-subtle" aria-hidden />
                <span className={cn('text-xs', target ? 'font-semibold text-fg' : 'text-muted')}>{target ?? 'Não sincroniza (ignorada)'}</span>
                {target && a.syncFrom ? <span className="text-xs text-subtle">· desde {formatDateBR(a.syncFrom)}</span> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {linked.length === 0 && c.accounts.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2.5 text-xs text-muted">
          Nenhuma conta vinculada: nada é sincronizado.
          <WriteGate>
            <Button size="xs" variant="soft" onClick={onManage}>
              Vincular contas
            </Button>
          </WriteGate>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Desconectar ${c.institution.name}?`}
        description="O consentimento é revogado e o Effinance deixa de acessar os dados desta instituição. Os lançamentos já importados permanecem — exclua-os pelo histórico de importações, se quiser."
        confirmLabel="Desconectar"
        loading={remove.isPending}
        onConfirm={() => void disconnect()}
      />
    </li>
  );
}

