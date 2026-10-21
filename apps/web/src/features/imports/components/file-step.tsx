import { useId, useRef, useState, type DragEvent } from 'react';
import { FileText, LoaderCircle, ShieldCheck, Upload, X } from 'lucide-react';
import { addMonthKey, formatMonthKey, type Account, type CreditCard } from '@effinance/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/input';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { ACCEPT_ATTRIBUTE, CHARSET_LABELS, ImportFileError, readImportFile, type DecodedImportFile } from '../decode';
import { formatBytes } from '../labels';

export type InvoiceMode = 'date' | 'month';

interface FileStepProps {
  file: DecodedImportFile | null;
  onFile: (file: DecodedImportFile | null) => void;
  source: string;
  onSource: (source: string) => void;
  accounts: Account[];
  cards: CreditCard[];
  invoiceMode: InvoiceMode;
  onInvoiceMode: (mode: InvoiceMode) => void;
  invoiceMonth: string;
  onInvoiceMonth: (month: string) => void;
  /** Preview request error (shown under the form). */
  error: string | null;
}

export function FileStep({
  file,
  onFile,
  source,
  onSource,
  accounts,
  cards,
  invoiceMode,
  onInvoiceMode,
  invoiceMonth,
  onInvoiceMonth,
  error,
}: FileStepProps) {
  const inputId = useId();
  const hintId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [reading, setReading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const card = source.startsWith('card:') ? cards.find((c) => c.id === source.slice(5)) : undefined;

  async function load(selected: File | undefined) {
    if (!selected) return;
    setFileError(null);
    setReading(true);
    try {
      onFile(await readImportFile(selected));
    } catch (e) {
      onFile(null);
      setFileError(e instanceof ImportFileError ? e.message : 'Não foi possível ler o arquivo. Tente exportá-lo novamente.');
    } finally {
      setReading(false);
      // Allows choosing the same file again after fixing it.
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function onDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDragging(false);
    void load(e.dataTransfer.files[0]);
  }

  const months = card ? Array.from({ length: 10 }, (_, i) => addMonthKey(card.currentInvoice.month, i - 7)) : [];
  // An older/newer invoice preselected from the card screen stays available.
  if (card && invoiceMonth && !months.includes(invoiceMonth)) months.push(invoiceMonth);
  months.sort();

  return (
    <div className="flex flex-col gap-5">
      <div>
        {/* Before the drop zone so the zone can show the input's keyboard focus (peer). */}
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={ACCEPT_ATTRIBUTE}
          className="peer sr-only"
          aria-describedby={hintId}
          aria-label="Arquivo de extrato ou fatura"
          onChange={(e) => void load(e.target.files?.[0])}
        />
        {file ? (
          <div className="flex items-center gap-3 rounded-lg border border-border bg-surface-muted px-4 py-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary-soft-fg">
              <FileText className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-fg" title={file.fileName}>
                {file.fileName}
              </p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                <Badge tone="brand">{file.format.toUpperCase()}</Badge>
                <span>{formatBytes(file.size)}</span>
                <span>· {CHARSET_LABELS[file.charset]}</span>
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => inputRef.current?.click()}>
              Trocar
            </Button>
            <button
              type="button"
              onClick={() => onFile(null)}
              className="flex size-8 items-center justify-center rounded-md text-muted hover:bg-bg-subtle hover:text-fg"
              aria-label="Remover arquivo"
            >
              <X className="size-4" />
            </button>
          </div>
        ) : (
          <label
            htmlFor={inputId}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn(
              'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-[1.5px] border-dashed px-6 py-9 text-center transition-colors peer-focus-visible:border-brand-500 peer-focus-visible:ring-[3px] peer-focus-visible:ring-brand-500/15',
              dragging ? 'border-brand-500 bg-brand-50' : 'border-border-strong hover:border-brand-400 hover:bg-surface-muted',
            )}
          >
            <span className="flex size-11 items-center justify-center rounded-md bg-bg-subtle text-muted">
              {reading ? <LoaderCircle className="size-5 animate-spin" /> : <Upload className="size-5" />}
            </span>
            <span className="text-sm font-semibold text-fg">
              {reading ? 'Lendo arquivo…' : dragging ? 'Solte o arquivo aqui' : 'Arraste o arquivo aqui ou clique para escolher'}
            </span>
            <span id={hintId} className="text-xs text-muted">
              OFX, QFX, CSV ou TXT exportado pelo banco
            </span>
          </label>
        )}
        {fileError ? (
          <p role="alert" className="mt-2 text-xs font-medium text-danger">
            {fileError}
          </p>
        ) : null}
      </div>

      <Field label="Importar para" hint="Escolha a conta do extrato ou o cartão da fatura.">
        <Select value={source} onChange={(e) => onSource(e.target.value)}>
          <option value="">Selecione a conta ou o cartão</option>
          <optgroup label="Contas">
            {accounts.map((a) => (
              <option key={a.id} value={`account:${a.id}`}>
                {a.name}
              </option>
            ))}
          </optgroup>
          {cards.length ? (
            <optgroup label="Cartões de crédito">
              {cards.map((c) => (
                <option key={c.id} value={`card:${c.id}`}>
                  {c.name}
                </option>
              ))}
            </optgroup>
          ) : null}
        </Select>
      </Field>

      {card ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-[13px] font-medium text-fg">Fatura</legend>
          <SegmentedControl
            ariaLabel="Fatura de destino"
            fullWidth
            value={invoiceMode}
            onChange={onInvoiceMode}
            options={[
              { value: 'date', label: 'Pela data da compra' },
              { value: 'month', label: 'Fatura específica' },
            ]}
          />
          {invoiceMode === 'month' ? (
            <Select aria-label="Mês da fatura" value={invoiceMonth || card.currentInvoice.month} onChange={(e) => onInvoiceMonth(e.target.value)}>
              {months.map((m) => (
                <option key={m} value={m}>
                  Fatura de {formatMonthKey(m).toLowerCase()}
                  {m === card.currentInvoice.month ? ' (atual)' : ''}
                </option>
              ))}
            </Select>
          ) : null}
          <p className="text-xs text-muted">
            {invoiceMode === 'date'
              ? `Cada compra entra na fatura da sua data (fechamento no dia ${card.closingDay}).`
              : 'Todos os lançamentos entram na fatura escolhida — ideal para o arquivo da fatura exportado pelo banco.'}
          </p>
        </fieldset>
      ) : null}

      {error ? (
        <div role="alert" className="rounded-md border border-danger/25 bg-danger-soft/60 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      ) : null}

      <div className="rounded-lg bg-surface-muted px-4 py-3.5 text-xs leading-relaxed text-muted">
        <p className="flex items-center gap-1.5 font-semibold text-fg">
          <ShieldCheck className="size-4 text-success" /> Como funciona
        </p>
        <ul className="mt-1.5 list-disc space-y-1 pl-5">
          <li>No app ou site do banco, procure Extrato ou Fatura → Exportar → OFX (Money/Quicken) ou CSV.</li>
          <li>Você confere tudo antes: nada é gravado até confirmar a importação, e ela pode ser desfeita.</li>
          <li>Lançamentos já importados são reconhecidos e não entram duas vezes.</li>
        </ul>
      </div>
    </div>
  );
}
