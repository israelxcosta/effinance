import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { formatBRL, formatDateBR, todayISO, type Goal } from '@effinance/shared';
import { Modal } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Skeleton } from '@/components/ui/skeleton';
import { useAddContribution, useDeleteContribution, useGoalContributions } from './api';
import { toastError } from '@/lib/notify';
import { WriteGate } from '@/features/auth/permissions';

export function ContributionDialog({ goal, onClose }: { goal: Goal | null; onClose: () => void }) {
  const [mode, setMode] = useState<'deposit' | 'withdraw'>('deposit');
  const [amount, setAmount] = useState(0);
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState('');
  const add = useAddContribution();
  const del = useDeleteContribution();
  const history = useGoalContributions(goal?.id);

  useEffect(() => {
    if (goal) {
      setMode('deposit');
      setAmount(0);
      setDate(todayISO());
      setNote('');
    }
  }, [goal]);

  async function submit() {
    if (!goal) return;
    if (amount <= 0) {
      toast.error('Informe um valor');
      return;
    }
    try {
      await add.mutateAsync({ goalId: goal.id, input: { amount: mode === 'deposit' ? amount : -amount, date, note: note || null } });
      toast.success(mode === 'deposit' ? 'Aporte registrado 🎯' : 'Retirada registrada');
      setAmount(0);
      setNote('');
    } catch (error) {
      toastError(error);
    }
  }

  return (
    <Modal
      open={Boolean(goal)}
      onOpenChange={(o) => !o && onClose()}
      title={goal?.name ?? 'Meta'}
      description={goal ? `${formatBRL(goal.currentAmount)} de ${formatBRL(goal.targetAmount)}` : undefined}
      className="max-w-lg"
    >
      <div className="flex flex-col gap-4">
        <SegmentedControl
          fullWidth
          value={mode}
          onChange={setMode}
          options={[
            { value: 'deposit', label: 'Guardar', activeClassName: 'bg-success text-white shadow-sm' },
            { value: 'withdraw', label: 'Retirar', activeClassName: 'bg-danger text-white shadow-sm' },
          ]}
        />
        <Field label="Valor">
          <MoneyInput value={amount} onChange={setAmount} size="lg" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Data">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Nota">
            <Input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="Opcional" />
          </Field>
        </div>
        <WriteGate>
          <Button onClick={submit} loading={add.isPending}>{mode === 'deposit' ? 'Guardar dinheiro' : 'Registrar retirada'}</Button>
        </WriteGate>

        <div className="border-t border-border pt-4">
          <p className="eyebrow mb-2 text-muted">Histórico</p>
          {history.isPending ? (
            <Skeleton className="h-16" />
          ) : (history.data ?? []).length === 0 ? (
            <p className="text-sm text-muted">Nenhum aporte ainda.</p>
          ) : (
            <ul className="scrollbar-thin flex max-h-56 flex-col gap-1 overflow-y-auto">
              {history.data!.map((c) => (
                <li key={c.id} className="group flex items-center gap-3 rounded-md px-2 py-2 hover:bg-surface-muted">
                  <span className="flex-1 text-sm">
                    {formatDateBR(c.date)}
                    {c.note ? <span className="ml-2 text-xs text-muted">{c.note}</span> : null}
                  </span>
                  <span className={c.amount >= 0 ? 'tabular text-sm font-semibold text-success' : 'tabular text-sm font-semibold text-danger'}>
                    {c.amount >= 0 ? '+' : ''}
                    {formatBRL(c.amount)}
                  </span>
                  <button
                    type="button"
                    className="text-subtle opacity-0 transition group-hover:opacity-100 hover:text-danger"
                    aria-label="Excluir aporte"
                    onClick={async () => {
                      try {
                        await del.mutateAsync({ goalId: c.goalId, contributionId: c.id });
                      } catch (error) {
                        toastError(error);
                      }
                    }}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}
