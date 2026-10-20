import { useEffect, useState } from 'react';
import { SERIES_SCOPE_LABELS, SERIES_SCOPES, type SeriesScope } from '@effinance/shared';
import { Modal } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const EDIT_HINTS: Record<SeriesScope, string> = {
  one: 'Altera apenas esta ocorrência.',
  future: 'Altera esta e as próximas ocorrências ainda não pagas.',
  all: 'Altera todas as ocorrências não pagas da série.',
};

const DELETE_HINTS: Record<SeriesScope, string> = {
  one: 'Exclui apenas esta ocorrência.',
  future: 'Exclui esta e as próximas, encerrando a série.',
  all: 'Exclui todas as ocorrências da série.',
};

interface ScopeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: 'edit' | 'delete';
  loading?: boolean;
  onConfirm: (scope: SeriesScope) => void;
}

/** Asks which occurrences of a series an edit/delete applies to. */
export function ScopeDialog({ open, onOpenChange, action, loading, onConfirm }: ScopeDialogProps) {
  const [scope, setScope] = useState<SeriesScope>('one');
  useEffect(() => {
    if (open) setScope('one');
  }, [open]);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={action === 'edit' ? 'Aplicar alteração em…' : 'Excluir lançamento recorrente'}
      description={
        action === 'edit'
          ? 'Este lançamento faz parte de uma série.'
          : 'Este lançamento faz parte de uma série. O que deseja excluir?'
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
              <span className="block text-sm font-semibold text-fg">{SERIES_SCOPE_LABELS[s]}</span>
              <span className="block text-xs text-muted">
                {action === 'delete' ? DELETE_HINTS[s] : EDIT_HINTS[s]}
              </span>
            </span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
