import { useEffect, useState } from 'react';
import { SERIES_SCOPES, type RecurrenceKind, type SeriesScope } from '@effinance/shared';
import { Modal } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type ScopeCopy = Record<SeriesScope, { label: string; hint: string }>;

/** Wording per kind of series: installments vs. repetitions (recurring / fixed without end). */
const COPY: Record<'edit' | 'delete', Record<'installment' | 'repeat', ScopeCopy>> = {
  delete: {
    installment: {
      one: { label: 'Somente esta parcela', hint: 'As outras parcelas continuam.' },
      future: {
        label: 'Esta e as próximas parcelas',
        hint: 'Exclui esta parcela e as seguintes ainda não pagas. As anteriores continuam.',
      },
      all: { label: 'Todas as parcelas', hint: 'Exclui a compra parcelada inteira, inclusive parcelas já pagas.' },
    },
    repeat: {
      one: { label: 'Somente este lançamento', hint: 'Os demais períodos continuam.' },
      future: {
        label: 'Deste em diante (encerrar)',
        hint: 'Exclui este e os próximos ainda não pagos e encerra a repetição. Os anteriores ficam no histórico.',
      },
      all: { label: 'Todos, inclusive os anteriores', hint: 'Exclui a série inteira, inclusive os já pagos.' },
    },
  },
  edit: {
    installment: {
      one: { label: 'Somente esta parcela', hint: 'Altera apenas esta parcela.' },
      future: { label: 'Esta e as próximas parcelas', hint: 'Altera esta e as próximas parcelas ainda não pagas.' },
      all: { label: 'Todas as parcelas', hint: 'Altera todas as parcelas não pagas.' },
    },
    repeat: {
      one: { label: 'Somente este lançamento', hint: 'Altera apenas este período.' },
      future: { label: 'Deste em diante', hint: 'Altera este e os próximos ainda não pagos.' },
      all: { label: 'Todos da série', hint: 'Altera todos os lançamentos não pagos da série.' },
    },
  },
};

interface ScopeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: 'edit' | 'delete';
  /** Kind of the series the transaction belongs to (adjusts the wording). */
  kind?: RecurrenceKind;
  loading?: boolean;
  onConfirm: (scope: SeriesScope) => void;
}

/** Asks which occurrences of a series an edit/delete applies to. */
export function ScopeDialog({ open, onOpenChange, action, kind, loading, onConfirm }: ScopeDialogProps) {
  const [scope, setScope] = useState<SeriesScope>('one');
  useEffect(() => {
    if (open) setScope('one');
  }, [open]);

  const group = kind === 'installment' ? 'installment' : 'repeat';
  const copy = COPY[action][group];
  const title =
    action === 'edit'
      ? 'Aplicar alteração em…'
      : group === 'installment'
        ? 'Excluir compra parcelada'
        : 'Excluir lançamento que se repete';

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={
        action === 'edit'
          ? group === 'installment'
            ? 'Este lançamento é uma parcela de uma compra parcelada.'
            : 'Este lançamento se repete em outros períodos.'
          : 'O que deseja excluir?'
      }
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button variant={action === 'delete' ? 'danger' : 'primary'} loading={loading} onClick={() => onConfirm(scope)}>
            {action === 'delete' ? 'Excluir' : 'Salvar'}
          </Button>
        </>
      }
    >
      <div role="radiogroup" className="flex flex-col gap-2">
        {SERIES_SCOPES.map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={scope === s}
            onClick={() => setScope(s)}
            className={cn(
              'flex items-start gap-3 rounded-lg border p-3.5 text-left transition-colors',
              scope === s ? 'border-brand-500 bg-primary-soft/60' : 'border-border hover:border-border-strong',
            )}
          >
            <span
              className={cn(
                'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border-2',
                scope === s ? 'border-primary' : 'border-border-strong',
              )}
            >
              {scope === s ? <span className="size-2 rounded-full bg-primary" /> : null}
            </span>
            <span>
              <span className="block text-sm font-semibold text-fg">{copy[s].label}</span>
              <span className="block text-xs text-muted">{copy[s].hint}</span>
            </span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
