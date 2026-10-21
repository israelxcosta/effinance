import { useMemo, useState } from 'react';
import { CheckCheck, ChevronLeft, ChevronRight, Copy, FileSearch, Layers, SlidersHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { formatBRL, formatDateBR, type CategoryWithChildren, type ImportPreview, type ImportPreviewRow } from '@effinance/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { EmptyState } from '@/components/ui/empty-state';
import { Money } from '@/components/ui/misc';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { CategoryPicker, type CategoryValue } from '@/features/categories/category-picker';
import { useCategories } from '@/features/categories/api';
import { cn, pluralize } from '@/lib/utils';
import { duplicateKind, typeLabel } from '../labels';

export interface RowChoice {
  selected: boolean;
  /** (Sub)category id sent with the row; starts as the API suggestion. */
  categoryId: string | null;
}

export type RowChoices = Map<number, RowChoice>;

export function initialChoices(preview: ImportPreview): RowChoices {
  return new Map(preview.rows.map((r) => [r.index, { selected: !r.skip, categoryId: r.categoryId }]));
}

type Filter = 'all' | 'new' | 'flagged';
const PAGE_SIZE = 50;

interface ReviewStepProps {
  preview: ImportPreview;
  /** "Nubank · conta" / "Cartão X · fatura de outubro de 2026". */
  destination: string;
  choices: RowChoices;
  onChoices: (update: (prev: RowChoices) => RowChoices) => void;
  onChangeFile: () => void;
  onAdjustColumns: (() => void) | null;
}

/** Maps the single (sub)category id of an import row to the picker value and back. */
function useCategoryIndex() {
  const expense = useCategories({ type: 'expense' });
  const income = useCategories({ type: 'income' });
  return useMemo(() => {
    const parentOf = new Map<string, string | null>();
    const add = (list: CategoryWithChildren[] | undefined) => {
      for (const c of list ?? []) {
        parentOf.set(c.id, null);
        for (const s of c.subcategories) parentOf.set(s.id, c.id);
      }
    };
    add(expense.data);
    add(income.data);
    return {
      toValue(id: string | null): CategoryValue {
        if (!id) return { categoryId: '', subcategoryId: '' };
        const parent = parentOf.get(id);
        return parent ? { categoryId: parent, subcategoryId: id } : { categoryId: id, subcategoryId: '' };
      },
    };
  }, [expense.data, income.data]);
}

export function ReviewStep({ preview, destination, choices, onChoices, onChangeFile, onAdjustColumns }: ReviewStepProps) {
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(1);
  const [bulkType, setBulkType] = useState<'expense' | 'income' | null>(null);
  const index = useCategoryIndex();
  const targetKind = preview.target.kind;

  const flagged = (r: ImportPreviewRow) => r.skip || r.duplicate;
  const counts = useMemo(
    () => ({ all: preview.rows.length, flagged: preview.rows.filter(flagged).length }),
    [preview.rows],
  );
  const visible = useMemo(
    () => preview.rows.filter((r) => (filter === 'all' ? true : filter === 'new' ? !flagged(r) : flagged(r))),
    [preview.rows, filter],
  );
  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const pageRows = visible.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  const selected = preview.rows.filter((r) => choices.get(r.index)?.selected);
  const selectedByType = { expense: selected.filter((r) => r.type === 'expense').length, income: selected.filter((r) => r.type === 'income').length };
  const effectiveBulkType = bulkType && selectedByType[bulkType] ? bulkType : selectedByType.expense >= selectedByType.income ? 'expense' : 'income';
  const visibleSelected = visible.filter((r) => choices.get(r.index)?.selected).length;
  const allVisibleChecked = visible.length > 0 && visibleSelected === visible.length ? true : visibleSelected > 0 ? 'indeterminate' : false;

  function setVisible(selectedValue: boolean) {
    onChoices((prev) => {
      const next = new Map(prev);
      for (const r of visible) next.set(r.index, { ...next.get(r.index)!, selected: selectedValue });
      return next;
    });
  }

  function updateRow(i: number, patch: Partial<RowChoice>) {
    onChoices((prev) => new Map(prev).set(i, { ...prev.get(i)!, ...patch }));
  }

  function applyCategory(value: CategoryValue) {
    const id = value.subcategoryId || value.categoryId || null;
    const targets = selected.filter((r) => r.type === effectiveBulkType);
    onChoices((prev) => {
      const next = new Map(prev);
      for (const r of targets) next.set(r.index, { ...next.get(r.index)!, categoryId: id });
      return next;
    });
    toast.success(`Categoria aplicada a ${targets.length} ${targets.length === 1 ? 'lançamento' : 'lançamentos'}`);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg bg-surface-muted px-4 py-3">
        <dl className="grid min-w-0 flex-1 grid-cols-2 gap-x-6 gap-y-2 text-xs lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1.4fr)_auto_minmax(0,1fr)]">
          <div className="min-w-0">
            <dt className="text-muted">Arquivo</dt>
            <dd className="mt-0.5 font-semibold break-words text-fg" title={preview.fileName}>
              {preview.fileName} <Badge tone="brand" className="ml-0.5 align-middle">{preview.format.toUpperCase()}</Badge>
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-muted">Destino</dt>
            <dd className="mt-0.5 font-semibold text-fg">{destination}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-muted">Período</dt>
            <dd className="mt-0.5 font-semibold text-fg">
              {preview.period ? `${formatDateBR(preview.period.from)} a ${formatDateBR(preview.period.to)}` : '—'}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-muted">No arquivo</dt>
            <dd className="mt-0.5 truncate font-semibold text-fg">
              {[preview.institution, preview.accountHint ? `final ${preview.accountHint}` : null].filter(Boolean).join(' · ') || '—'}
            </dd>
          </div>
        </dl>
        <div className="flex gap-1">
          {onAdjustColumns ? (
            <Button variant="ghost" size="sm" onClick={onAdjustColumns}>
              <SlidersHorizontal /> Ajustar colunas
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={onChangeFile}>
            Trocar arquivo
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Lançamentos no arquivo" value={String(preview.totals.count)} />
        <Tile label={targetKind === 'credit_card' ? 'Estornos e créditos' : 'Entradas'} value={formatBRL(preview.totals.income)} tone="success" />
        <Tile label={targetKind === 'credit_card' ? 'Compras' : 'Saídas'} value={formatBRL(preview.totals.expense)} tone="danger" />
        <Tile
          label="Sinalizados"
          value={String(counts.flagged)}
          tone={counts.flagged ? 'warning' : undefined}
          hint={preview.totals.duplicates ? pluralize(preview.totals.duplicates, 'duplicado', 'duplicados') : 'Nenhum duplicado'}
        />
      </div>

      {preview.rows.length > 0 && preview.rows.every((r) => duplicateKind(r) === 'imported') ? (
        <p role="status" className="flex items-center gap-2 rounded-md bg-primary-soft px-4 py-3 text-[13px] font-medium text-primary-soft-fg">
          <CheckCheck className="size-4 shrink-0" /> Todos os lançamentos deste arquivo já foram importados antes — nada novo para trazer.
        </p>
      ) : null}

      {preview.rows.length === 0 ? (
        <EmptyState
          icon={<FileSearch />}
          title="Nenhum lançamento encontrado no arquivo"
          description="Confira se o arquivo é o extrato ou a fatura do período desejado. Em CSV, ajuste o mapeamento das colunas."
          action={
            onAdjustColumns ? (
              <Button variant="outline" onClick={onAdjustColumns}>
                Ajustar colunas
              </Button>
            ) : (
              <Button variant="outline" onClick={onChangeFile}>
                Escolher outro arquivo
              </Button>
            )
          }
        />
      ) : (
        <section aria-label="Lançamentos do arquivo" className="overflow-hidden rounded-xl border border-border">
          <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
            <Checkbox
              checked={allVisibleChecked}
              onCheckedChange={(c) => setVisible(c)}
              aria-label={allVisibleChecked === true ? 'Desmarcar todos' : 'Marcar todos'}
            />
            <SegmentedControl
              size="sm"
              ariaLabel="Filtrar lançamentos"
              value={filter}
              onChange={(f) => {
                setFilter(f);
                setPage(1);
              }}
              options={[
                { value: 'all', label: `Todos (${counts.all})` },
                { value: 'new', label: `Novos (${counts.all - counts.flagged})` },
                { value: 'flagged', label: `Sinalizados (${counts.flagged})` },
              ]}
            />
            <div className="flex gap-1">
              <Button variant="ghost" size="xs" onClick={() => setVisible(true)}>
                Marcar todos
              </Button>
              <Button variant="ghost" size="xs" onClick={() => setVisible(false)}>
                Desmarcar todos
              </Button>
            </div>
            {selected.length ? (
              <div className="flex w-full flex-wrap items-center gap-2 lg:ml-auto lg:w-auto">
                {selectedByType.expense && selectedByType.income ? (
                  <SegmentedControl
                    size="sm"
                    ariaLabel="Tipo para aplicar a categoria"
                    value={effectiveBulkType}
                    onChange={setBulkType}
                    options={[
                      { value: 'expense', label: `${targetKind === 'credit_card' ? 'Compras' : 'Saídas'} (${selectedByType.expense})` },
                      { value: 'income', label: `${targetKind === 'credit_card' ? 'Estornos' : 'Entradas'} (${selectedByType.income})` },
                    ]}
                  />
                ) : null}
                <CategoryPicker
                  key={effectiveBulkType}
                  type={effectiveBulkType}
                  value={{ categoryId: '', subcategoryId: '' }}
                  onChange={applyCategory}
                  placeholder={`Categoria para ${selectedByType[effectiveBulkType]} ${selectedByType[effectiveBulkType] === 1 ? 'selecionado' : 'selecionados'}`}
                  aria-label="Aplicar categoria aos lançamentos selecionados"
                  className="h-9 w-full rounded-[10px] text-[13px] sm:w-72"
                />
              </div>
            ) : null}
          </div>

          <div className="hidden grid-cols-[18px_84px_minmax(0,1fr)_230px_124px] gap-x-3 border-b border-border bg-surface-muted px-4 py-2 text-[11px] font-semibold tracking-wide text-muted uppercase md:grid" aria-hidden>
            <span />
            <span>Data</span>
            <span>Descrição</span>
            <span>Categoria</span>
            <span className="text-right">Valor</span>
          </div>

          {pageRows.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted">Nenhum lançamento neste filtro.</p>
          ) : (
            <ul className="divide-y divide-border">
              {pageRows.map((r) => {
                const choice = choices.get(r.index) ?? { selected: false, categoryId: null };
                return (
                  <ReviewRow
                    key={r.index}
                    row={r}
                    choice={choice}
                    targetKind={targetKind}
                    categoryValue={index.toValue(choice.categoryId)}
                    onSelected={(s) => updateRow(r.index, { selected: s })}
                    onCategory={(v) => updateRow(r.index, { categoryId: v.subcategoryId || v.categoryId || null })}
                  />
                );
              })}
            </ul>
          )}

          {pages > 1 ? (
            <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-xs text-muted">
              <span>
                Página {current} de {pages} · {visible.length} lançamentos
              </span>
              <div className="flex gap-1">
                <Button variant="outline" size="icon-sm" disabled={current <= 1} onClick={() => setPage(current - 1)} aria-label="Página anterior">
                  <ChevronLeft />
                </Button>
                <Button variant="outline" size="icon-sm" disabled={current >= pages} onClick={() => setPage(current + 1)} aria-label="Próxima página">
                  <ChevronRight />
                </Button>
              </div>
            </div>
          ) : null}
        </section>
      )}
    </div>
  );
}

function Tile({ label, value, tone, hint }: { label: string; value: string; tone?: 'success' | 'danger' | 'warning'; hint?: string }) {
  return (
    <div className="rounded-lg border border-border px-3.5 py-2.5">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p
        className={cn(
          'tabular mt-0.5 text-[15px] font-semibold tracking-tight text-fg',
          tone === 'success' && 'text-success',
          tone === 'danger' && 'text-danger',
          tone === 'warning' && 'text-warning',
        )}
      >
        {value}
      </p>
      {hint ? <p className="text-[11px] text-subtle">{hint}</p> : null}
    </div>
  );
}

interface ReviewRowProps {
  row: ImportPreviewRow;
  choice: RowChoice;
  targetKind: 'account' | 'credit_card';
  categoryValue: CategoryValue;
  onSelected: (selected: boolean) => void;
  onCategory: (value: CategoryValue) => void;
}

function ReviewRow({ row, choice, targetKind, categoryValue, onSelected, onCategory }: ReviewRowProps) {
  const dup = duplicateKind(row);
  const signed = row.type === 'expense' ? -row.amount : row.amount;
  // The note repeats what the duplicate badge already says.
  const note = row.note && !(dup && /duplic|importad/i.test(row.note)) ? row.note : null;
  return (
    <li
      className={cn(
        'grid grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-3 transition-colors md:grid-cols-[18px_84px_minmax(0,1fr)_230px_124px]',
        !choice.selected && 'bg-surface-muted/50',
      )}
    >
      <Checkbox
        checked={choice.selected}
        onCheckedChange={onSelected}
        aria-label={`Importar ${row.description} de ${formatDateBR(row.date)}`}
        className="row-span-2 self-start md:row-span-1 md:self-center"
      />
      <span className={cn('tabular hidden text-[13px] text-muted md:block', !choice.selected && 'opacity-60')}>{formatDateBR(row.date)}</span>
      <div className={cn('min-w-0', !choice.selected && 'opacity-60')}>
        <p className="line-clamp-2 text-sm font-semibold break-words text-fg md:line-clamp-1" title={row.description}>
          {row.description}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
          <span className="tabular md:hidden">{formatDateBR(row.date)} ·</span>
          <span>{typeLabel(row.type, targetKind)}</span>
          {dup === 'imported' ? (
            <Badge tone="neutral" title="Este lançamento já foi importado antes e não será criado de novo">
              <CheckCheck /> Já importado
            </Badge>
          ) : dup === 'similar' ? (
            <Badge tone="warning" title="Já existe um lançamento com a mesma data, valor e descrição">
              <Copy /> Possível duplicado
            </Badge>
          ) : null}
          {row.installment ? (
            <Badge tone="brand" title="Parcela identificada na descrição">
              <Layers /> Parcela {row.installment.number}/{row.installment.total}
            </Badge>
          ) : null}
          {note ? <span className={cn(row.skip ? 'text-warning' : 'text-muted')}>{note}</span> : null}
        </p>
      </div>
      <div className="col-start-2 col-end-4 row-start-2 md:col-auto md:row-auto">
        <CategoryPicker
          type={row.type}
          value={categoryValue}
          onChange={onCategory}
          placeholder="Sem categoria"
          aria-label={`Categoria de ${row.description}`}
          className="h-9 rounded-[10px] text-[13px]"
        />
      </div>
      <div className={cn('col-start-3 row-start-1 text-right md:col-auto md:row-auto', !choice.selected && 'opacity-60')}>
        <Money value={signed} signed showPlus className="text-sm" />
      </div>
    </li>
  );
}
