import { Check, Plus, X } from 'lucide-react';
import { formatBRL, splitInstallments, type CategoryType } from '@effinance/shared';
import { cn } from '@/lib/utils';
import { MoneyInput } from '@/components/ui/money-input';
import { CategoryPicker } from '@/features/categories/category-picker';

export interface SplitRow {
  key: string;
  categoryId: string;
  subcategoryId: string;
  amount: number;
}

export interface SplitRowErrors {
  category?: string;
  amount?: string;
}

export const MAX_SPLITS = 10;

export function newSplitRow(partial: Partial<SplitRow> = {}): SplitRow {
  return { key: crypto.randomUUID(), categoryId: '', subcategoryId: '', amount: 0, ...partial };
}

/** Even split of `total` across the rows (remainder cents go to the first row). */
export function evenSplit(rows: SplitRow[], total: number): SplitRow[] {
  const parts = total > 0 ? splitInstallments(total, rows.length) : rows.map(() => 0);
  return rows.map((r, i) => ({ ...r, amount: parts[i] ?? 0 }));
}

/** Client-side checks mirroring the API (category chosen, positive amounts, sum = total). */
export function validateSplits(rows: SplitRow[], total: number) {
  const rowErrors: Record<number, SplitRowErrors> = {};
  rows.forEach((r, i) => {
    const e: SplitRowErrors = {};
    if (!r.categoryId) e.category = 'Selecione a categoria';
    if (!(r.amount > 0)) e.amount = 'Informe o valor';
    if (e.category || e.amount) rowErrors[i] = e;
  });
  const sum = rows.reduce((acc, r) => acc + r.amount, 0);
  const summary = sum !== total ? 'A soma das categorias deve ser igual ao valor total' : undefined;
  return { rowErrors, summary, ok: Object.keys(rowErrors).length === 0 && !summary };
}

interface SplitEditorProps {
  type: CategoryType;
  total: number;
  rows: SplitRow[];
  onChange: (rows: SplitRow[]) => void;
  onCancel: () => void;
  rowErrors?: Record<number, SplitRowErrors>;
  error?: string;
}

/** Divides the transaction amount across two or more categories. */
export function SplitEditor({ type, total, rows, onChange, onCancel, rowErrors = {}, error }: SplitEditorProps) {
  const sum = rows.reduce((acc, r) => acc + r.amount, 0);
  const diff = total - sum;
  const update = (i: number, patch: Partial<SplitRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <section aria-label="Divisão por categoria" className="flex flex-col gap-3 rounded-xl border border-border bg-surface-muted/60 p-3.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-medium text-fg">Dividir em categorias</p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onChange(evenSplit(rows, total))}
            disabled={total <= 0}
            className="rounded-md px-2 py-1 text-xs font-semibold text-brand-text transition-colors hover:bg-bg-subtle disabled:opacity-50"
          >
            Dividir igualmente
          </button>
          <button type="button" onClick={onCancel} className="rounded-md px-2 py-1 text-xs font-semibold text-muted transition-colors hover:bg-bg-subtle hover:text-fg">
            Desfazer divisão
          </button>
        </div>
      </div>

      <ul className="flex flex-col gap-2">
        {rows.map((row, i) => {
          const e = rowErrors[i];
          return (
            <li key={row.key} className="flex flex-col gap-1">
              <div className="grid grid-cols-[minmax(0,1fr)_132px_auto] items-center gap-2">
                <CategoryPicker
                  type={type}
                  aria-label={`Categoria ${i + 1}`}
                  aria-invalid={e?.category ? true : undefined}
                  value={{ categoryId: row.categoryId, subcategoryId: row.subcategoryId }}
                  onChange={(v) => update(i, v)}
                />
                <MoneyInput
                  aria-label={`Valor da categoria ${i + 1}`}
                  aria-invalid={e?.amount ? true : undefined}
                  value={row.amount}
                  onChange={(amount) => update(i, { amount })}
                />
                <button
                  type="button"
                  onClick={() => onChange(rows.filter((_, j) => j !== i))}
                  disabled={rows.length <= 2}
                  aria-label={`Remover categoria ${i + 1}`}
                  className="flex size-9 items-center justify-center rounded-md text-muted transition-colors hover:bg-bg-subtle hover:text-danger disabled:pointer-events-none disabled:opacity-30"
                >
                  <X className="size-4" />
                </button>
              </div>
              {e?.category || e?.amount ? (
                <p className="text-xs text-danger">{[e.category, e.amount].filter(Boolean).join(' · ')}</p>
              ) : null}
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        onClick={() => onChange([...rows, newSplitRow({ amount: diff > 0 ? diff : 0 })])}
        disabled={rows.length >= MAX_SPLITS}
        className="flex items-center gap-1.5 self-start rounded-md px-1 py-1 text-[13px] font-semibold text-brand-text transition-colors hover:underline disabled:opacity-50"
      >
        <Plus className="size-4" /> Adicionar categoria
      </button>

      <div
        className={cn(
          'flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-[13px]',
          diff === 0 ? 'bg-success-soft text-success' : diff > 0 ? 'bg-warning-soft text-warning' : 'bg-danger-soft text-danger',
        )}
        aria-live="polite"
      >
        <span className="text-fg">
          Distribuído <strong className="tabular">{formatBRL(sum)}</strong> de <span className="tabular">{formatBRL(total)}</span>
        </span>
        <span className="flex items-center gap-1 font-semibold">
          {diff === 0 ? (
            <>
              <Check className="size-4" /> Valores conferem
            </>
          ) : diff > 0 ? (
            `Falta ${formatBRL(diff)}`
          ) : (
            `Excede ${formatBRL(-diff)}`
          )}
        </span>
      </div>
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </section>
  );
}
