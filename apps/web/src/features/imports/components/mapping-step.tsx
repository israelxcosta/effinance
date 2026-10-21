import { useMemo } from 'react';
import { LoaderCircle, TriangleAlert } from 'lucide-react';
import { CSV_DATE_FORMATS, formatBRL, formatDateBR, type CsvMapping, type ImportPreview } from '@effinance/shared';
import { Field } from '@/components/ui/input';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { csvSample, type CsvDelimiter } from '../decode';
import { DATE_FORMAT_LABELS, DELIMITER_LABELS } from '../labels';

export interface LivePreviewState {
  data: ImportPreview | null;
  error: string | null;
  loading: boolean;
}

interface MappingStepProps {
  content: string;
  mapping: CsvMapping;
  onChange: (mapping: CsvMapping) => void;
  /** Columns reported by the API for the current mapping (header cells or "Coluna N"). */
  apiColumns: string[] | null;
  live: LivePreviewState;
}

const SAMPLE_ROWS = 8;

export function MappingStep({ content, mapping, onChange, apiColumns, live }: MappingStepProps) {
  const sample = useMemo(() => csvSample(content, mapping.delimiter as CsvDelimiter, 4), [content, mapping.delimiter]);
  const width = Math.max(apiColumns?.length ?? 0, ...sample.map((r) => r.length), 1);
  const header = mapping.hasHeader ? sample[0] : undefined;
  const example = mapping.hasHeader ? sample[1] : sample[0];
  const columns = Array.from({ length: width }, (_, i) => apiColumns?.[i] || header?.[i] || `Coluna ${i + 1}`);

  const split = mapping.amountColumn === null;
  const set = (patch: Partial<CsvMapping>) => onChange({ ...mapping, ...patch });

  function columnOptions(allowNone = false) {
    return (
      <>
        {allowNone ? <option value="">Nenhuma</option> : null}
        {columns.map((name, i) => {
          const ex = example?.[i];
          return (
            <option key={i} value={String(i)}>
              {name}
              {ex && ex !== name ? ` · ${ex.length > 16 ? `${ex.slice(0, 15)}…` : ex}` : ''}
            </option>
          );
        })}
      </>
    );
  }

  const rows = live.data?.rows ?? [];

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">Diga o que cada coluna representa. A prévia ao lado é atualizada na hora.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Separador">
            <Select value={mapping.delimiter} onChange={(e) => set({ delimiter: e.target.value as CsvMapping['delimiter'] })}>
              {(Object.keys(DELIMITER_LABELS) as CsvDelimiter[]).map((d) => (
                <option key={d} value={d}>
                  {DELIMITER_LABELS[d]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Decimais">
            <Select value={mapping.decimalSeparator} onChange={(e) => set({ decimalSeparator: e.target.value as ',' | '.' })}>
              <option value=",">Vírgula · 1.234,56</option>
              <option value=".">Ponto · 1,234.56</option>
            </Select>
          </Field>
        </div>
        <label className="flex cursor-pointer items-center justify-between gap-3 text-[13px] font-medium text-fg">
          A primeira linha é o cabeçalho
          <Switch checked={mapping.hasHeader} onCheckedChange={(c) => set({ hasHeader: c })} aria-label="A primeira linha é o cabeçalho" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Coluna da data">
            <Select value={String(mapping.dateColumn)} onChange={(e) => set({ dateColumn: Number(e.target.value) })}>
              {columnOptions()}
            </Select>
          </Field>
          <Field label="Formato da data">
            <Select value={mapping.dateFormat} onChange={(e) => set({ dateFormat: e.target.value as CsvMapping['dateFormat'] })}>
              {CSV_DATE_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {DATE_FORMAT_LABELS[f]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Coluna da descrição">
          <Select value={String(mapping.descriptionColumn)} onChange={(e) => set({ descriptionColumn: Number(e.target.value) })}>
            {columnOptions()}
          </Select>
        </Field>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-[13px] font-medium text-fg">Valores</legend>
          <SegmentedControl
            ariaLabel="Como os valores aparecem"
            fullWidth
            size="sm"
            value={split ? 'split' : 'single'}
            onChange={(v) =>
              v === 'split'
                ? set({ amountColumn: null, debitColumn: mapping.amountColumn ?? 2, creditColumn: Math.min((mapping.amountColumn ?? 2) + 1, columns.length - 1) })
                : set({ amountColumn: mapping.debitColumn ?? 2, debitColumn: null, creditColumn: null })
            }
            options={[
              { value: 'single', label: 'Uma coluna de valor' },
              { value: 'split', label: 'Débito e crédito' },
            ]}
          />
          {split ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Débito (saídas)">
                <Select value={mapping.debitColumn === null ? '' : String(mapping.debitColumn)} onChange={(e) => set({ debitColumn: e.target.value === '' ? null : Number(e.target.value) })}>
                  {columnOptions(true)}
                </Select>
              </Field>
              <Field label="Crédito (entradas)">
                <Select value={mapping.creditColumn === null ? '' : String(mapping.creditColumn)} onChange={(e) => set({ creditColumn: e.target.value === '' ? null : Number(e.target.value) })}>
                  {columnOptions(true)}
                </Select>
              </Field>
            </div>
          ) : (
            <Field label="Coluna do valor" hint="Valores negativos são saídas; positivos, entradas.">
              <Select value={String(mapping.amountColumn)} onChange={(e) => set({ amountColumn: Number(e.target.value) })}>
                {columnOptions()}
              </Select>
            </Field>
          )}
        </fieldset>
        <label className="flex cursor-pointer items-start justify-between gap-3 text-[13px] font-medium text-fg">
          <span>
            Inverter sinal dos valores
            <span className="mt-0.5 block text-xs font-normal text-muted">Para faturas de cartão que listam as compras como valores positivos.</span>
          </span>
          <Switch checked={mapping.invertSign} onCheckedChange={(c) => set({ invertSign: c })} aria-label="Inverter sinal dos valores" />
        </label>
      </div>

      <section aria-label="Prévia da leitura" aria-busy={live.loading} className="flex min-w-0 flex-col rounded-xl border border-border">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-fg">Prévia</h3>
            <p className="text-xs text-muted" aria-live="polite">
              {live.data
                ? `${live.data.totals.count} ${live.data.totals.count === 1 ? 'lançamento lido' : 'lançamentos lidos'}`
                : live.loading
                  ? 'Lendo com o novo mapeamento…'
                  : 'Ajuste as colunas para ver os lançamentos'}
            </p>
          </div>
          {live.loading ? <LoaderCircle className="size-4 animate-spin text-muted" aria-hidden /> : null}
        </div>
        {live.error ? (
          <p role="alert" className="m-4 flex items-start gap-2 rounded-md bg-danger-soft/60 px-3 py-2.5 text-[13px] text-danger">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" /> {live.error}
          </p>
        ) : null}
        {rows.length ? (
          <div className={cn('overflow-x-auto', live.loading && 'opacity-60')}>
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11px] font-semibold tracking-wide text-muted uppercase">
                  <th scope="col" className="w-28 px-4 py-2 font-semibold">Data</th>
                  <th scope="col" className="px-2 py-2 font-semibold">Descrição</th>
                  <th scope="col" className="px-4 py-2 text-right font-semibold">Valor</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, SAMPLE_ROWS).map((r) => (
                  <tr key={r.index} className="border-t border-border">
                    <td className="tabular px-4 py-2 whitespace-nowrap text-muted">{formatDateBR(r.date)}</td>
                    <td className="max-w-0 truncate px-2 py-2 text-fg" title={r.description}>
                      {r.description}
                    </td>
                    <td className={cn('tabular px-4 py-2 text-right font-semibold whitespace-nowrap', r.type === 'income' ? 'text-success' : 'text-danger')}>
                      {r.type === 'income' ? '+' : '−'}
                      {formatBRL(r.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > SAMPLE_ROWS ? (
              <p className="border-t border-border px-4 py-2 text-xs text-muted">e mais {rows.length - SAMPLE_ROWS} na revisão.</p>
            ) : null}
          </div>
        ) : !live.loading && !live.error ? (
          <p className="px-4 py-8 text-center text-sm text-muted">Nenhum lançamento lido com este mapeamento.</p>
        ) : null}
      </section>
    </div>
  );
}
