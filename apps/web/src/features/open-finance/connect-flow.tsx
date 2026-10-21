import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, CreditCard, EyeOff, KeyRound, Landmark, LockKeyhole, RefreshCw, ShieldCheck } from 'lucide-react';
import {
  addDays,
  formatBRL,
  formatDateBR,
  OPEN_FINANCE_DEFAULT_HISTORY_DAYS,
  OPEN_FINANCE_MAX_HISTORY_DAYS,
  todayISO,
  type Account,
  type BankConnection,
  type BankConnectionAccount,
  type CreditCard as Card,
  type LinkAccountsInput,
  type SyncResult,
} from '@effinance/shared';
import { BankLogo } from '@/components/ui/bank-logo';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { ErrorState } from '@/components/ui/misc';
import { Select } from '@/components/ui/select';
import { SkeletonRows } from '@/components/ui/skeleton';
import { useAccounts } from '@/features/accounts/api';
import { usePermissions } from '@/features/auth/permissions';
import { useCards } from '@/features/cards/api';
import { useTheme } from '@/lib/theme';
import { toastError } from '@/lib/notify';
import { pluralize } from '@/lib/utils';
import {
  useConnectToken,
  useCreateConnection,
  useFakeConnect,
  useFakeInstitutions,
  useLinkAccounts,
  useSyncConnection,
} from './api';
import { openPluggyConnect } from './pluggy-connect';

/** Plain-language summary of what the connection can and cannot do (LGPD transparency). */
export function OpenFinanceTransparency({ compact = false }: { compact?: boolean }) {
  const items = [
    { icon: <EyeOff />, text: 'Somente leitura: o Effinance vê contas, saldos, lançamentos e faturas — não faz pagamentos nem movimenta dinheiro.' },
    { icon: <KeyRound />, text: 'Você autoriza no ambiente do seu banco. Não pedimos nem guardamos suas senhas.' },
    { icon: <LockKeyhole />, text: 'O consentimento tem prazo e pode ser revogado a qualquer momento aqui ou no app do banco.' },
  ];
  return (
    <ul className={compact ? 'flex flex-col gap-2' : 'flex flex-col gap-3'}>
      {items.map((item) => (
        <li key={item.text} className="flex items-start gap-2.5 text-[13px] leading-relaxed text-muted">
          <span className="mt-0.5 shrink-0 text-success [&_svg]:size-4">{item.icon}</span>
          {item.text}
        </li>
      ))}
    </ul>
  );
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'intro'; connectionId?: string; institution?: string }
  | { kind: 'fake'; updateItemId: string | null; institution?: string }
  | { kind: 'link'; connection: BankConnection; initial: boolean };

export interface BankConnectFlow {
  /** New connection, or re-consent (`connectionId`) of an existing one. */
  connect: (options?: { connectionId?: string; institution?: string }) => void;
  /** "Gerenciar contas": link, create or ignore the accounts of a connection. */
  manage: (connection: BankConnection) => void;
  busy: boolean;
  /** Dialogs of the flow: render once next to the triggers. */
  element: ReactNode;
}

export function useBankConnectFlow(): BankConnectFlow {
  const { resolved: theme } = useTheme();
  const { readOnlyReason } = usePermissions();
  const token = useConnectToken();
  const create = useCreateConnection();
  const sync = useSyncConnection();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [busy, setBusy] = useState(false);
  const fakeResult = useRef<((itemId: string | null) => void) | null>(null);

  const blocked = useCallback(() => {
    if (!readOnlyReason) return false;
    toast.info(readOnlyReason, { id: 'read-only' });
    return true;
  }, [readOnlyReason]);

  const connect = useCallback(
    (options: { connectionId?: string; institution?: string } = {}) => {
      if (!blocked()) setPhase({ kind: 'intro', ...options });
    },
    [blocked],
  );

  const manage = useCallback(
    (connection: BankConnection) => {
      if (!blocked()) setPhase({ kind: 'link', connection, initial: false });
    },
    [blocked],
  );

  async function start(connectionId: string | undefined, institution: string | undefined) {
    setBusy(true);
    try {
      const t = await token.mutateAsync(connectionId ? { connectionId } : {});
      let itemId: string | null;
      if (t.provider === 'fake') {
        itemId = await new Promise<string | null>((resolve) => {
          fakeResult.current = resolve;
          setPhase({ kind: 'fake', updateItemId: t.updateItemId, institution });
        });
      } else {
        // Close our (modal) dialog first: Radix blocks pointer events outside it, widget included.
        setPhase({ kind: 'idle' });
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        itemId = await openPluggyConnect({
          connectToken: t.accessToken,
          updateItem: t.updateItemId,
          includeSandbox: t.sandbox,
          theme,
        });
      }
      if (!itemId) {
        setPhase({ kind: 'idle' });
        return;
      }
      const connection = await create.mutateAsync({ itemId });
      if (connectionId) {
        setPhase({ kind: 'idle' });
        toast.success('Consentimento renovado', { description: 'Buscando os lançamentos mais recentes…' });
        const result = await sync.mutateAsync(connection.id);
        toast.success(syncSummary(result));
      } else {
        setPhase({ kind: 'link', connection, initial: true });
      }
    } catch (error) {
      setPhase({ kind: 'idle' });
      toastError(error);
    } finally {
      fakeResult.current = null;
      setBusy(false);
    }
  }

  const close = () => setPhase({ kind: 'idle' });

  const element = (
    <>
      <IntroDialog
        open={phase.kind === 'intro'}
        renewing={phase.kind === 'intro' && Boolean(phase.connectionId)}
        institution={phase.kind === 'intro' ? phase.institution : undefined}
        loading={busy}
        onCancel={close}
        onContinue={() => phase.kind === 'intro' && void start(phase.connectionId, phase.institution)}
      />
      <FakeConnectDialog
        open={phase.kind === 'fake'}
        updateItemId={phase.kind === 'fake' ? phase.updateItemId : null}
        institution={phase.kind === 'fake' ? phase.institution : undefined}
        onDone={(itemId) => fakeResult.current?.(itemId)}
      />
      {phase.kind === 'link' ? (
        <LinkAccountsDialog key={phase.connection.id} connection={phase.connection} initial={phase.initial} onClose={close} />
      ) : null}
    </>
  );

  return { connect, manage, busy, element };
}

export function syncSummary(result: SyncResult): string {
  const parts = [pluralize(result.created, 'lançamento novo', 'lançamentos novos')];
  if (result.updated) parts.push(pluralize(result.updated, 'atualizado', 'atualizados'));
  if (result.skipped) parts.push(`${result.skipped} já ${result.skipped === 1 ? 'existia' : 'existiam'}`);
  return `Sincronizado: ${parts.join(' · ')}`;
}

function IntroDialog({
  open,
  renewing,
  institution,
  loading,
  onCancel,
  onContinue,
}: {
  open: boolean;
  renewing: boolean;
  institution?: string;
  loading: boolean;
  onCancel: () => void;
  onContinue: () => void;
}) {
  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && !loading && onCancel()}
      title={renewing ? `Renovar consentimento${institution ? ` · ${institution}` : ''}` : 'Conectar banco via Open Finance'}
      description={
        renewing
          ? 'Autorize novamente o acesso de leitura no ambiente do banco para continuar sincronizando.'
          : 'Traga lançamentos e faturas automaticamente, com o consentimento do Open Finance Brasil.'
      }
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={onContinue} loading={loading} data-autofocus>
            Continuar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <OpenFinanceTransparency />
        <p className="rounded-md bg-surface-muted px-3 py-2.5 text-xs leading-relaxed text-muted">
          A conexão usa um agregador autorizado pelo Banco Central (Pluggy), que recebe os dados do banco em seu nome. Você escolhe quais contas
          entram no Effinance e pode desconectar quando quiser — os lançamentos já importados continuam aqui.
        </p>
      </div>
    </Modal>
  );
}

/** Simulated widget (provider `fake`): development, tests and the browser demo. */
function FakeConnectDialog({
  open,
  updateItemId,
  institution,
  onDone,
}: {
  open: boolean;
  updateItemId: string | null;
  institution?: string;
  onDone: (itemId: string | null) => void;
}) {
  const institutions = useFakeInstitutions(open && !updateItemId);
  const fakeConnect = useFakeConnect();
  const [choosing, setChoosing] = useState<string | null>(null);

  async function choose(institutionId: string) {
    setChoosing(institutionId);
    try {
      const { itemId } = await fakeConnect.mutateAsync(institutionId);
      onDone(itemId);
    } catch (error) {
      toastError(error);
    } finally {
      setChoosing(null);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && !choosing && onDone(null)}
      title="Banco simulado (ambiente de testes)"
      description={
        updateItemId
          ? `Simula a nova autorização${institution ? ` do ${institution}` : ''} no ambiente do banco.`
          : 'Escolha uma instituição fictícia. Nenhum banco real é acessado.'
      }
    >
      {updateItemId ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">No ambiente real, esta etapa abre o app ou o site do banco para você confirmar o consentimento.</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onDone(null)}>
              Cancelar
            </Button>
            <Button onClick={() => onDone(updateItemId)}>
              <ShieldCheck /> Autorizar novamente
            </Button>
          </div>
        </div>
      ) : institutions.isPending ? (
        <SkeletonRows rows={4} />
      ) : institutions.isError ? (
        <ErrorState error={institutions.error} onRetry={() => institutions.refetch()} />
      ) : (
        <ul className="flex max-h-[50vh] flex-col gap-1.5 overflow-y-auto" aria-label="Instituições de teste">
          {institutions.data.map((inst) => (
            <li key={inst.id}>
              <button
                type="button"
                disabled={Boolean(choosing)}
                onClick={() => void choose(inst.id)}
                className="flex w-full items-center gap-3 rounded-lg border border-border px-3.5 py-3 text-left transition-colors hover:border-border-strong hover:bg-surface-muted focus-visible:ring-[3px] focus-visible:ring-brand-500/25 focus-visible:outline-none disabled:opacity-60"
              >
                <BankLogo bank={inst.bank} size="sm" />
                <span className="flex-1 text-sm font-semibold text-fg">{inst.name}</span>
                {choosing === inst.id ? <RefreshCw className="size-4 animate-spin text-muted" aria-label="Conectando" /> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

type TargetChoice = 'new' | 'ignore' | `account:${string}` | `card:${string}`;

interface LinkRow {
  target: TargetChoice;
  syncFrom: string;
}

function defaultChoice(account: BankConnectionAccount, connection: BankConnection, initial: boolean, accounts: Account[], cards: Card[]): TargetChoice {
  if (account.linkedAccountId) return `account:${account.linkedAccountId}`;
  if (account.linkedCreditCardId) return `card:${account.linkedCreditCardId}`;
  if (!initial) return 'ignore';
  // Suggest the only local account/card of the same bank; otherwise create a new one.
  const bank = connection.institution.bank;
  if (bank) {
    if (account.kind === 'bank') {
      const same = accounts.filter((a) => a.bank === bank);
      if (same.length === 1) return `account:${same[0]!.id}`;
    } else {
      const same = cards.filter((c) => c.bank === bank);
      if (same.length === 1) return `card:${same[0]!.id}`;
    }
  }
  return 'new';
}

/** "Vincular contas": where each account of the institution goes, then the first sync. */
function LinkAccountsDialog({ connection, initial, onClose }: { connection: BankConnection; initial: boolean; onClose: () => void }) {
  const accounts = useAccounts();
  const cards = useCards();
  const link = useLinkAccounts();
  const sync = useSyncConnection();
  const [rows, setRows] = useState<Record<string, LinkRow> | null>(null);
  const [result, setResult] = useState<SyncResult | null>(null);
  const today = todayISO();
  const minDate = addDays(today, -OPEN_FINANCE_MAX_HISTORY_DAYS);
  const defaultFrom = addDays(today, -OPEN_FINANCE_DEFAULT_HISTORY_DAYS);
  const activeAccounts = (accounts.data ?? []).filter((a) => !a.archived);
  const activeCards = (cards.data ?? []).filter((c) => !c.archived);
  const ready = accounts.isSuccess && cards.isSuccess;

  // Defaults once the local accounts/cards are known.
  useEffect(() => {
    if (!ready || rows) return;
    setRows(
      Object.fromEntries(
        connection.accounts.map((a) => [
          a.id,
          { target: defaultChoice(a, connection, initial, activeAccounts, activeCards), syncFrom: a.syncFrom ?? defaultFrom },
        ]),
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const saving = link.isPending || sync.isPending;
  const linkedCount = rows ? Object.values(rows).filter((r) => r.target !== 'ignore').length : 0;
  const invalidDate = rows ? Object.values(rows).some((r) => r.target !== 'ignore' && (r.syncFrom < minDate || r.syncFrom > today)) : false;

  async function save() {
    if (!rows) return;
    const input: LinkAccountsInput = {
      links: connection.accounts.map((a) => {
        const row = rows[a.id]!;
        const target =
          row.target === 'new'
            ? ({ kind: 'new' } as const)
            : row.target === 'ignore'
              ? ({ kind: 'ignore' } as const)
              : row.target.startsWith('account:')
                ? ({ kind: 'account', accountId: row.target.slice(8) } as const)
                : ({ kind: 'credit_card', creditCardId: row.target.slice(5) } as const);
        return { connectionAccountId: a.id, target, ...(row.target !== 'ignore' ? { syncFrom: row.syncFrom } : {}) };
      }),
    };
    try {
      const updated = await link.mutateAsync({ id: connection.id, input });
      if (!linkedCount) {
        toast.success('Nenhuma conta será sincronizada', { description: 'Você pode vincular depois em "Gerenciar contas".' });
        onClose();
        return;
      }
      setResult(await sync.mutateAsync(updated.id));
    } catch (error) {
      toastError(error);
    }
  }

  const institution = connection.institution.name;

  if (result) {
    return (
      <Modal
        open
        onOpenChange={(o) => !o && onClose()}
        title="Banco conectado"
        description={`${institution}: a primeira sincronização terminou.`}
        footer={<Button onClick={onClose}>Concluir</Button>}
      >
        <div className="flex flex-col items-center gap-3 py-2 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-success-soft text-success">
            <CheckCircle2 className="size-6" />
          </span>
          <dl className="grid w-full grid-cols-3 gap-2">
            <SummaryTile label="Criados" value={result.created} tone="success" />
            <SummaryTile label="Atualizados" value={result.updated} />
            <SummaryTile label="Ignorados" value={result.skipped} hint="já existiam" />
          </dl>
          <p className="text-xs text-muted">Os lançamentos já aparecem no extrato, nas faturas e nos relatórios, com o selo “Open Finance”.</p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onOpenChange={(o) => !o && !saving && onClose()}
      className="flex max-h-[calc(100dvh-2rem)] max-w-2xl flex-col"
      title="Vincular contas"
      description={`Escolha onde entram os lançamentos de cada conta do ${institution}.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            {initial ? 'Agora não' : 'Cancelar'}
          </Button>
          <Button onClick={() => void save()} loading={saving} disabled={!rows || invalidDate}>
            {linkedCount ? `Vincular e sincronizar ${pluralize(linkedCount, 'conta', 'contas')}` : 'Salvar'}
          </Button>
        </>
      }
    >
      <div className="-mx-6 max-h-[60dvh] overflow-y-auto px-6">
        {!ready || !rows ? (
          accounts.isError || cards.isError ? (
            <ErrorState error={accounts.error ?? cards.error} onRetry={() => void Promise.all([accounts.refetch(), cards.refetch()])} />
          ) : (
            <SkeletonRows rows={3} />
          )
        ) : connection.accounts.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">A instituição não retornou contas para este consentimento.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {connection.accounts.map((a) => {
              const row = rows[a.id]!;
              const setRow = (patch: Partial<LinkRow>) => setRows((r) => ({ ...r!, [a.id]: { ...r![a.id]!, ...patch } }));
              return (
                <li key={a.id} className="rounded-lg border border-border p-4">
                  <div className="flex items-start gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-bg-subtle text-muted">
                      {a.kind === 'credit_card' ? <CreditCard className="size-4" /> : <Landmark className="size-4" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-fg">{a.name}</p>
                      <p className="text-xs text-muted">
                        {a.kind === 'credit_card' ? 'Cartão de crédito' : 'Conta'}
                        {a.number ? ` · final ${a.number.replace(/\D/g, '').slice(-4) || a.number}` : ''}
                        {a.kind === 'credit_card' && a.creditLimit !== null ? ` · limite ${formatBRL(a.creditLimit)}` : ''}
                        {a.kind === 'bank' && a.balance !== null ? ` · saldo ${formatBRL(a.balance)}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_190px]">
                    <Field label="Destino">
                      <Select value={row.target} onChange={(e) => setRow({ target: e.target.value as TargetChoice })}>
                        <option value="new">{a.kind === 'credit_card' ? 'Criar novo cartão' : 'Criar nova conta'}</option>
                        <option value="ignore">Ignorar (não sincronizar)</option>
                        {a.kind === 'credit_card' ? (
                          activeCards.length ? (
                            <optgroup label="Cartão existente">
                              {activeCards.map((c) => (
                                <option key={c.id} value={`card:${c.id}`}>
                                  {c.name}
                                </option>
                              ))}
                            </optgroup>
                          ) : null
                        ) : activeAccounts.length ? (
                          <optgroup label="Conta existente">
                            {activeAccounts.map((acc) => (
                              <option key={acc.id} value={`account:${acc.id}`}>
                                {acc.name}
                              </option>
                            ))}
                          </optgroup>
                        ) : null}
                      </Select>
                    </Field>
                    {row.target !== 'ignore' ? (
                      <Field label="Importar desde" error={row.syncFrom < minDate || row.syncFrom > today ? `Entre ${formatDateBR(minDate)} e hoje` : undefined}>
                        <Input type="date" min={minDate} max={today} value={row.syncFrom} onChange={(e) => setRow({ syncFrom: e.target.value })} />
                      </Field>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-4 text-xs text-muted">
          “Importar desde” define até onde a primeira sincronização volta (padrão {OPEN_FINANCE_DEFAULT_HISTORY_DAYS} dias, no máximo{' '}
          {OPEN_FINANCE_MAX_HISTORY_DAYS}). Lançamentos repetidos não entram duas vezes.
        </p>
      </div>
    </Modal>
  );
}

function SummaryTile({ label, value, tone, hint }: { label: string; value: number; tone?: 'success'; hint?: string }) {
  return (
    <div className="rounded-lg border border-border px-3 py-2.5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`tabular mt-0.5 text-lg font-semibold ${tone === 'success' ? 'text-success' : 'text-fg'}`}>{value}</dd>
      {hint ? <dd className="text-[11px] text-subtle">{hint}</dd> : null}
    </div>
  );
}
