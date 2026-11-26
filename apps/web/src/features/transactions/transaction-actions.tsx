import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { MoneyInput } from '@/components/ui/money-input';
import { cn } from '@/lib/utils';
import { useCategories } from '@/features/categories/api';
import { CategoryPicker, type CategoryValue } from '@/features/categories/category-picker';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { formatBRL, formatMonthKey, todayISO, type Transaction, type TransactionListResponse } from '@effinance/shared';
import { ConfirmDialog, Modal } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useAccounts } from '@/features/accounts/api';
import { useDeleteTransfer } from '@/features/transfers/api';
import { TransferSheet, type TransferMode, type TransferSheetState } from '@/features/transfers/transfer-sheet';
import { useAnticipateInstallments, useDeleteTransaction, useSetPaid } from './api';
import { ScopeDialog } from './scope-dialog';
import { TransactionSheet, type TransactionSheetState, type TxKind } from './transaction-sheet';
import { toastError } from '@/lib/notify';
import { usePermissions } from '@/features/auth/permissions';
import { DateInput } from '@/components/ui/date-input';

interface OpenTransactionOptions {
  type: TxKind;
  defaults?: TransactionSheetState['defaults'];
}

interface TransactionActions {
  openTransaction: (options: OpenTransactionOptions) => void;
  openTransfer: (mode?: TransferMode) => void;
  edit: (tx: Transaction) => void;
  duplicate: (tx: Transaction) => void;
  remove: (tx: Transaction) => void;
  togglePaid: (tx: Transaction, paid: boolean) => void;
  /** Pays/receives an amount different from the planned one (smaller bill, interest and fines). */
  payOtherAmount: (tx: Transaction) => void;
  /** Moves future installments of an installment purchase to today / the current invoice. */
  anticipate: (tx: Transaction) => void;
  /** Id of the transaction whose paid status is being saved. */
  savingPaidId: string | null;
  /** Why the workspace is read-only (viewer role or inactive subscription); null when writable. */
  readOnlyReason: string | null;
}

const Ctx = createContext<TransactionActions | null>(null);

const CLOSED_TX: TransactionSheetState = { open: false, mode: 'create', type: 'expense' };
const CLOSED_TRANSFER: TransferSheetState = { open: false, mode: 'transfer' };

export function TransactionActionsProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [txSheet, setTxSheet] = useState<TransactionSheetState>(CLOSED_TX);
  const [transferSheet, setTransferSheet] = useState<TransferSheetState>(CLOSED_TRANSFER);
  const [toDelete, setToDelete] = useState<Transaction | null>(null);
  const [payTarget, setPayTarget] = useState<Transaction | null>(null);
  const [payAmountTarget, setPayAmountTarget] = useState<Transaction | null>(null);
  const [anticipateTarget, setAnticipateTarget] = useState<Transaction | null>(null);
  const [savingPaidId, setSavingPaidId] = useState<string | null>(null);
  const txSheetUsed = useStickyTrue(txSheet.open);
  const transferSheetUsed = useStickyTrue(transferSheet.open);

  const deleteTx = useDeleteTransaction();
  const deleteTransfer = useDeleteTransfer();
  const setPaid = useSetPaid();
  const { readOnlyReason } = usePermissions();

  /** Every entry point (quick bar, palette, rows, dashboard) goes through here: read-only blocks it. */
  const blocked = useCallback(() => {
    if (!readOnlyReason) return false;
    toast.info(readOnlyReason, { id: 'read-only' });
    return true;
  }, [readOnlyReason]);

  const openTransaction = useCallback(
    (o: OpenTransactionOptions) => {
      if (blocked()) return;
      setTxSheet({ open: true, mode: 'create', type: o.type, defaults: o.defaults });
    },
    [blocked],
  );

  const openTransfer = useCallback(
    (mode: TransferMode = 'transfer') => {
      if (blocked()) return;
      setTransferSheet({ open: true, mode });
    },
    [blocked],
  );

  const edit = useCallback((tx: Transaction) => {
    if (blocked()) return;
    if (tx.type === 'transfer') {
      if (tx.transferKind === 'card_payment') {
        toast.info('Pagamentos de fatura são gerenciados na tela do cartão.');
        return;
      }
      setTransferSheet({ open: true, mode: 'transfer', transfer: tx });
      return;
    }
    setTxSheet({ open: true, mode: 'edit', type: tx.type, transaction: tx });
  }, [blocked]);

  const duplicate = useCallback(
    (tx: Transaction) => {
      if (tx.type === 'transfer' || blocked()) return;
      setTxSheet({ open: true, mode: 'duplicate', type: tx.type, transaction: tx });
    },
    [blocked],
  );

  const remove = useCallback(
    (tx: Transaction) => {
      if (!blocked()) setToDelete(tx);
    },
    [blocked],
  );

  const applyPaid = useCallback(
    async (tx: Transaction, paid: boolean, extra: { accountId?: string | null; paidAt?: string | null } = {}) => {
      setSavingPaidId(tx.id);
      // Optimistic update of every cached transaction list.
      const snapshots = qc.getQueriesData<TransactionListResponse>({ queryKey: ['transactions'] });
      qc.setQueriesData<TransactionListResponse>({ queryKey: ['transactions'] }, (old) =>
        old?.items
          ? { ...old, items: old.items.map((t) => (t.id === tx.id ? { ...t, paid, overdue: paid ? false : t.overdue } : t)) }
          : old,
      );
      try {
        await setPaid.mutateAsync({
          id: tx.id,
          input: { paid, paidAt: paid ? (extra.paidAt ?? todayISO()) : null, accountId: extra.accountId ?? undefined },
        });
        const label = tx.type === 'income' ? (paid ? 'Recebimento confirmado 👍' : 'Marcado como a receber') : paid ? 'Pagamento confirmado 👍' : 'Marcado como pendente';
        toast.success(label);
      } catch (error) {
        for (const [key, data] of snapshots) qc.setQueryData(key, data);
        toastError(error);
      } finally {
        setSavingPaidId(null);
      }
    },
    [qc, setPaid],
  );

  const togglePaid = useCallback(
    (tx: Transaction, paid: boolean) => {
      if (blocked()) return;
      if (tx.creditCardId && tx.type !== 'transfer') {
        toast.info('Compras no cartão são quitadas ao pagar a fatura.');
        return;
      }
      if (paid && !tx.accountId && tx.type !== 'transfer') {
        setPayTarget(tx);
        return;
      }
      void applyPaid(tx, paid);
    },
    [applyPaid, blocked],
  );

  const payOtherAmount = useCallback(
    (tx: Transaction) => {
      if (blocked()) return;
      if (tx.creditCardId || tx.type === 'transfer') {
        toast.info('Compras no cartão são quitadas ao pagar a fatura.');
        return;
      }
      setPayAmountTarget(tx);
    },
    [blocked],
  );

  async function confirmDelete(scope: 'one' | 'future' | 'all') {
    if (!toDelete) return;
    try {
      if (toDelete.type === 'transfer') await deleteTransfer.mutateAsync(toDelete.id);
      else await deleteTx.mutateAsync({ id: toDelete.id, scope });
      toast.success('Lançamento excluído');
      setToDelete(null);
    } catch (error) {
      toastError(error);
    }
  }

  const anticipate = useCallback(
    (tx: Transaction) => {
      if (!blocked()) setAnticipateTarget(tx);
    },
    [blocked],
  );

  const value = useMemo<TransactionActions>(
    () => ({ openTransaction, openTransfer, edit, duplicate, remove, togglePaid, payOtherAmount, anticipate, savingPaidId, readOnlyReason }),
    [openTransaction, openTransfer, edit, duplicate, remove, togglePaid, payOtherAmount, anticipate, savingPaidId, readOnlyReason],
  );

  const isSeries = Boolean(toDelete?.recurrenceId) && toDelete?.type !== 'transfer';

  return (
    <Ctx.Provider value={value}>
      {children}
      {/* Mounted on first use so their option queries don't run on every page load. */}
      {txSheetUsed ? (
        <TransactionSheet state={txSheet} onOpenChange={(open) => setTxSheet((s) => (open ? s : { ...s, open: false }))} />
      ) : null}
      {transferSheetUsed ? (
        <TransferSheet
          state={transferSheet}
          onOpenChange={(open) => setTransferSheet((s) => (open ? s : { ...s, open: false }))}
        />
      ) : null}
      <ScopeDialog
        open={Boolean(toDelete) && isSeries}
        onOpenChange={(o) => !o && setToDelete(null)}
        action="delete"
        kind={toDelete?.recurrenceKind}
        loading={deleteTx.isPending}
        onConfirm={(scope) => void confirmDelete(scope)}
      />
      <ConfirmDialog
        open={Boolean(toDelete) && !isSeries}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Excluir lançamento?"
        description={
          toDelete ? `"${toDelete.description}" de ${formatBRL(toDelete.amount)} será excluído. Esta ação não pode ser desfeita.` : undefined
        }
        confirmLabel="Excluir"
        loading={deleteTx.isPending || deleteTransfer.isPending}
        onConfirm={() => void confirmDelete('one')}
      />
      <PayWithAccountDialog
        tx={payTarget}
        onClose={() => setPayTarget(null)}
        onConfirm={(accountId, paidAt) => {
          const tx = payTarget!;
          setPayTarget(null);
          void applyPaid(tx, true, { accountId, paidAt });
        }}
      />
      <AnticipateDialog tx={anticipateTarget} onClose={() => setAnticipateTarget(null)} />
      <PayAmountDialog tx={payAmountTarget} onClose={() => setPayAmountTarget(null)} />
    </Ctx.Provider>
  );
}

/** Becomes true the first time `value` is true and stays true. */
function useStickyTrue(value: boolean): boolean {
  const [sticky, setSticky] = useState(value);
  if (value && !sticky) setSticky(true);
  return sticky || value;
}

function PayWithAccountDialog({
  tx,
  onClose,
  onConfirm,
}: {
  tx: Transaction | null;
  onClose: () => void;
  onConfirm: (accountId: string | null, paidAt: string) => void;
}) {
  const accounts = useAccounts();
  const [accountId, setAccountId] = useState('');
  const [paidAt, setPaidAt] = useState(todayISO());
  const income = tx?.type === 'income';
  return (
    <Modal
      open={Boolean(tx)}
      onOpenChange={(o) => {
        if (!o) onClose();
        else {
          setAccountId('');
          setPaidAt(todayISO());
        }
      }}
      title={income ? 'Confirmar recebimento' : 'Confirmar pagamento'}
      description={tx ? `${tx.description} · ${formatBRL(tx.amount)}` : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => onConfirm(accountId || null, paidAt)}>Confirmar 👍</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={income ? 'Receber em qual conta?' : 'Pagar com qual conta?'} hint="O saldo da conta será atualizado.">
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">Sem conta vinculada</option>
            {(accounts.data ?? [])
              .filter((a) => !a.archived)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {formatBRL(a.balance)}
                </option>
              ))}
          </Select>
        </Field>
        <Field label={income ? 'Recebido em' : 'Pago em'}>
          <DateInput value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

/**
 * "Pagar outro valor": the bill came smaller (the entry becomes the paid amount) or with interest and
 * fines (the entry keeps its amount and the difference is booked apart, by default in "Juros e
 * multas").
 */
function PayAmountDialog({ tx, onClose }: { tx: Transaction | null; onClose: () => void }) {
  const accounts = useAccounts();
  const categories = useCategories({ type: tx?.type === 'income' ? 'income' : 'expense' });
  const setPaid = useSetPaid();
  const [amount, setAmount] = useState(0);
  const [accountId, setAccountId] = useState('');
  const [paidAt, setPaidAt] = useState(todayISO());
  const [diffCategory, setDiffCategory] = useState<CategoryValue>({ categoryId: '', subcategoryId: '' });
  const income = tx?.type === 'income';
  const planned = tx?.amount ?? 0;
  const diff = amount - planned;

  // Default for the extra on an expense: the "Juros e multas" subcategory, when the workspace has it.
  const lateFee = useMemo(() => {
    for (const c of categories.data ?? []) {
      const sub = c.subcategories.find((s) => s.name.toLowerCase() === 'juros e multas' && !s.archived);
      if (sub) return { categoryId: c.id, subcategoryId: sub.id };
      if (c.name.toLowerCase() === 'juros e multas') return { categoryId: c.id, subcategoryId: '' };
    }
    return null;
  }, [categories.data]);

  function reset(t: Transaction) {
    setAmount(t.amount);
    setAccountId(t.accountId ?? '');
    setPaidAt(todayISO());
    setDiffCategory(
      t.type === 'income' ? { categoryId: t.categoryId ?? '', subcategoryId: t.subcategoryId ?? '' } : (lateFee ?? { categoryId: '', subcategoryId: '' }),
    );
  }

  // Opened from a menu (not by the modal itself): start from the planned amount every time.
  const txId = tx?.id;
  useEffect(() => {
    if (tx) reset(tx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txId, lateFee]);

  async function confirm() {
    if (!tx || amount <= 0) return;
    try {
      await setPaid.mutateAsync({
        id: tx.id,
        input: {
          paid: true,
          paidAt,
          accountId: accountId || undefined,
          amount,
          differenceCategoryId: diff > 0 ? diffCategory.categoryId || undefined : undefined,
          differenceSubcategoryId: diff > 0 ? diffCategory.subcategoryId || undefined : undefined,
        },
      });
      toast.success(
        diff > 0
          ? `${income ? 'Recebido' : 'Pago'} com ${formatBRL(diff)} de ${income ? 'acréscimo' : 'juros e multa'} 👍`
          : diff < 0
            ? `${income ? 'Recebido' : 'Pago'}: ${formatBRL(amount)} (${formatBRL(-diff)} a menos) 👍`
            : income
              ? 'Recebimento confirmado 👍'
              : 'Pagamento confirmado 👍',
      );
      onClose();
    } catch (error) {
      toastError(error);
    }
  }

  return (
    <Modal
      open={Boolean(tx)}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={income ? 'Receber outro valor' : 'Pagar outro valor'}
      description={tx ? `${tx.description} · previsto ${formatBRL(planned)}` : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={confirm} loading={setPaid.isPending} disabled={amount <= 0}>
            Confirmar 👍
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={income ? 'Valor recebido' : 'Valor pago'}>
          <MoneyInput value={amount} onChange={setAmount} size="lg" autoFocus />
        </Field>
        {diff !== 0 && amount > 0 ? (
          <div className={cn('rounded-lg px-3.5 py-3 text-label', diff > 0 ? 'bg-danger-soft text-fg' : 'bg-success-soft text-fg')}>
            {diff > 0 ? (
              <>
                <strong className="font-semibold">{formatBRL(diff)}</strong> a mais. O lançamento continua com {formatBRL(planned)} e a
                diferença entra como um lançamento separado{income ? '' : ' de juros e multa'}, já {income ? 'recebido' : 'pago'}.
              </>
            ) : (
              <>
                <strong className="font-semibold">{formatBRL(-diff)}</strong> a menos. O lançamento passa a ser de {formatBRL(amount)} só neste
                mês; os próximos continuam com {formatBRL(planned)}.
              </>
            )}
          </div>
        ) : null}
        {diff > 0 ? (
          <Field
            label={income ? 'Categoria do acréscimo' : 'Categoria dos juros e multa'}
            hint={!income && !diffCategory.categoryId ? 'Em branco, vai para "Juros e multas" (criada se ainda não existir).' : undefined}
          >
            <CategoryPicker type={income ? 'income' : 'expense'} value={diffCategory} onChange={setDiffCategory} placeholder="Juros e multas" />
          </Field>
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          <Field label={income ? 'Recebido em' : 'Pago em'}>
            <DateInput value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
          </Field>
          <Field label="Conta">
            <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">Sem conta vinculada</option>
              {(accounts.data ?? [])
                .filter((a) => !a.archived || a.id === tx?.accountId)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </Select>
          </Field>
        </div>
      </div>
    </Modal>
  );
}

/** Anticipates the last N future installments to today (on a card: the current open invoice). */
function AnticipateDialog({ tx, onClose }: { tx: Transaction | null; onClose: () => void }) {
  const anticipate = useAnticipateInstallments();
  const remaining = tx?.installmentTotal && tx.installmentNumber ? tx.installmentTotal - tx.installmentNumber : 0;
  const [count, setCount] = useState(String(remaining));
  const n = Math.min(Math.max(Number(count) || 0, 0), remaining);
  const isCard = Boolean(tx?.creditCardId);

  async function confirm() {
    if (!tx || n < 1) return;
    try {
      const moved = await anticipate.mutateAsync({ id: tx.id, input: { count: n } });
      const where = isCard && moved[0]?.invoiceMonth ? ` para a fatura de ${formatMonthKey(moved[0].invoiceMonth, 'short')}` : ' para hoje';
      toast.success(`${moved.length} ${moved.length === 1 ? 'parcela antecipada' : 'parcelas antecipadas'}${where}`);
      onClose();
    } catch (error) {
      toastError(error);
    }
  }

  return (
    <Modal
      open={Boolean(tx)}
      onOpenChange={(o) => {
        if (!o) onClose();
        else setCount(String(remaining));
      }}
      title="Antecipar parcelas"
      description={tx ? `${tx.description} · parcela ${tx.installmentNumber}/${tx.installmentTotal}` : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => void confirm()} loading={anticipate.isPending} disabled={n < 1}>
            Antecipar {n > 0 ? `${n} ${n === 1 ? 'parcela' : 'parcelas'}` : ''}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-label leading-relaxed text-muted">
          {isCard
            ? `As parcelas escolhidas saem dos próximos meses e entram na fatura atual do ${tx?.creditCard?.name ?? 'cartão'}.`
            : 'As parcelas escolhidas saem dos próximos meses e passam a vencer hoje.'}{' '}
          Como nos bancos, as últimas parcelas são antecipadas primeiro.
        </p>
        <Field label="Quantas parcelas antecipar?" hint={`Até ${remaining} ${remaining === 1 ? 'parcela futura' : 'parcelas futuras'}`}>
          <Input type="number" min={1} max={remaining} inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} />
        </Field>
        {tx && n > 0 ? (
          <p className="rounded-md bg-primary-soft px-3 py-2 text-label font-semibold text-primary-soft-fg">
            {n}x de {formatBRL(tx.amount)} · total {formatBRL(tx.amount * n)}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

export function useTransactionActions(): TransactionActions {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTransactionActions must be used inside TransactionActionsProvider');
  return ctx;
}
