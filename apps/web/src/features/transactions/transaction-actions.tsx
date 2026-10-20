import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { formatBRL, todayISO, type Transaction, type TransactionListResponse } from '@effinance/shared';
import { ConfirmDialog, Modal } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { errorMessage } from '@/lib/api';
import { useAccounts } from '@/features/accounts/api';
import { useDeleteTransfer } from '@/features/transfers/api';
import { TransferSheet, type TransferMode, type TransferSheetState } from '@/features/transfers/transfer-sheet';
import { useDeleteTransaction, useSetPaid } from './api';
import { ScopeDialog } from './scope-dialog';
import { TransactionSheet, type TransactionSheetState, type TxKind } from './transaction-sheet';

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
  /** Id of the transaction whose paid status is being saved. */
  savingPaidId: string | null;
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
  const [savingPaidId, setSavingPaidId] = useState<string | null>(null);
  const txSheetUsed = useStickyTrue(txSheet.open);
  const transferSheetUsed = useStickyTrue(transferSheet.open);

  const deleteTx = useDeleteTransaction();
  const deleteTransfer = useDeleteTransfer();
  const setPaid = useSetPaid();

  const openTransaction = useCallback((o: OpenTransactionOptions) => {
    setTxSheet({ open: true, mode: 'create', type: o.type, defaults: o.defaults });
  }, []);

  const openTransfer = useCallback((mode: TransferMode = 'transfer') => {
    setTransferSheet({ open: true, mode });
  }, []);

  const edit = useCallback((tx: Transaction) => {
    if (tx.type === 'transfer') {
      if (tx.transferKind === 'card_payment') {
        toast.info('Pagamentos de fatura são gerenciados na tela do cartão.');
        return;
      }
      setTransferSheet({ open: true, mode: 'transfer', transfer: tx });
      return;
    }
    setTxSheet({ open: true, mode: 'edit', type: tx.type, transaction: tx });
  }, []);

  const duplicate = useCallback((tx: Transaction) => {
    if (tx.type === 'transfer') return;
    setTxSheet({ open: true, mode: 'duplicate', type: tx.type, transaction: tx });
  }, []);

  const remove = useCallback((tx: Transaction) => setToDelete(tx), []);

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
        toast.error(errorMessage(error));
      } finally {
        setSavingPaidId(null);
      }
    },
    [qc, setPaid],
  );

  const togglePaid = useCallback(
    (tx: Transaction, paid: boolean) => {
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
    [applyPaid],
  );

  async function confirmDelete(scope: 'one' | 'future' | 'all') {
    if (!toDelete) return;
    try {
      if (toDelete.type === 'transfer') await deleteTransfer.mutateAsync(toDelete.id);
      else await deleteTx.mutateAsync({ id: toDelete.id, scope });
      toast.success('Lançamento excluído');
      setToDelete(null);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  const value = useMemo<TransactionActions>(
    () => ({ openTransaction, openTransfer, edit, duplicate, remove, togglePaid, savingPaidId }),
    [openTransaction, openTransfer, edit, duplicate, remove, togglePaid, savingPaidId],
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
          <Input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

export function useTransactionActions(): TransactionActions {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTransactionActions must be used inside TransactionActionsProvider');
  return ctx;
}
