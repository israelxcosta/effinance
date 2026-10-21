import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  csvMappingSchema,
  formatBRL,
  MAX_IMPORT_ROWS,
  type CsvMapping,
  type ImportPreview,
  type ImportTarget,
} from '@effinance/shared';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/sheet';
import { WriteGate } from '@/features/auth/permissions';
import { useAccounts } from '@/features/accounts/api';
import { useCards } from '@/features/cards/api';
import { ApiRequestError, errorMessage, isAccessError } from '@/lib/api';
import { toastError } from '@/lib/notify';
import { cn } from '@/lib/utils';
import { previewImport, useCommitImport, useImportPreview } from './api';
import { type DecodedImportFile } from './decode';
import { defaultCsvMapping, sourceValue, targetLabel } from './labels';
import { FileStep, type InvoiceMode } from './components/file-step';
import { MappingStep, type LivePreviewState } from './components/mapping-step';
import { initialChoices, ReviewStep, type RowChoices } from './components/review-step';
import { useUndoImportAction } from './use-undo-import';

type Step = 'file' | 'mapping' | 'review';

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

interface ImportWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTarget?: ImportTarget;
}

/** "Importar extrato ou fatura": file + destination → (CSV) column mapping → review → commit. */
export default function ImportWizard({ open, onOpenChange, initialTarget }: ImportWizardProps) {
  const accounts = useAccounts();
  const cards = useCards();
  const activeAccounts = useMemo(() => (accounts.data ?? []).filter((a) => !a.archived), [accounts.data]);
  const activeCards = useMemo(() => (cards.data ?? []).filter((c) => !c.archived), [cards.data]);

  const [step, setStep] = useState<Step>('file');
  const [file, setFile] = useState<DecodedImportFile | null>(null);
  const [source, setSource] = useState(() => sourceValue(initialTarget));
  const [invoiceMode, setInvoiceMode] = useState<InvoiceMode>(
    initialTarget?.kind === 'credit_card' && initialTarget.invoiceMonth && MONTH_KEY.test(initialTarget.invoiceMonth) ? 'month' : 'date',
  );
  const [invoiceMonth, setInvoiceMonth] = useState(() => {
    const m = initialTarget?.kind === 'credit_card' ? initialTarget.invoiceMonth : undefined;
    return m && MONTH_KEY.test(m) ? m : '';
  });
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [choices, setChoices] = useState<RowChoices>(new Map());
  const [mapping, setMapping] = useState<CsvMapping | null>(null);
  const analyze = useImportPreview();
  const commit = useCommitImport();
  const undo = useUndoImportAction();

  const card = source.startsWith('card:') ? activeCards.find((c) => c.id === source.slice(5)) : undefined;
  const accountId = source.startsWith('account:') ? activeAccounts.find((a) => a.id === source.slice(8))?.id : undefined;
  // Only destinations that exist (a stale `?conta=` preselection is ignored).
  const target = useMemo<ImportTarget | null>(() => {
    if (accountId) return { kind: 'account', accountId };
    if (card) {
      const month = invoiceMode === 'month' ? invoiceMonth || card.currentInvoice.month : undefined;
      return { kind: 'credit_card', creditCardId: card.id, ...(month ? { invoiceMonth: month } : {}) };
    }
    return null;
  }, [accountId, card, invoiceMode, invoiceMonth]);

  // Request shared by the mapping step's live preview (stable while the file/target don't change).
  const base = useMemo(() => (file && target ? { fileName: file.fileName, content: file.content, target } : null), [file, target]);
  const live = useLivePreview(step === 'mapping' ? base : null, mapping);

  function chooseFile(next: DecodedImportFile | null) {
    setFile(next);
    setMapping(null);
    setPreview(null);
    setPreviewError(null);
  }

  function accept(result: ImportPreview) {
    setPreview(result);
    setChoices(initialChoices(result));
    setStep('review');
  }

  async function runPreview() {
    if (!base) return;
    setPreviewError(null);
    try {
      const result = await analyze.mutateAsync({ ...base, ...(mapping ? { csv: mapping } : {}) });
      // CSV the API could not read on its own: ask for the columns.
      if (result.format === 'csv' && (!result.csvMapping || result.rows.length === 0)) {
        setMapping(result.csvMapping ?? defaultCsvMapping(base.content));
        setStep('mapping');
        return;
      }
      if (result.csvMapping) setMapping(result.csvMapping);
      accept(result);
    } catch (error) {
      if (isAccessError(error)) return;
      if (file?.format === 'csv' && error instanceof ApiRequestError && (error.status === 400 || error.status === 422)) {
        // Unreadable CSV layout: the mapping step lets the user point the columns.
        setMapping((m) => m ?? defaultCsvMapping(base.content));
        setPreviewError(null);
        setStep('mapping');
        toast.info('Não reconhecemos o layout deste CSV. Indique as colunas.');
        return;
      }
      setPreviewError(errorMessage(error));
    }
  }

  const selectedRows = preview ? preview.rows.filter((r) => choices.get(r.index)?.selected) : [];
  const income = selectedRows.filter((r) => r.type === 'income').reduce((s, r) => s + r.amount, 0);
  const expense = selectedRows.filter((r) => r.type === 'expense').reduce((s, r) => s + r.amount, 0);
  const tooMany = selectedRows.length > MAX_IMPORT_ROWS;

  async function confirm() {
    if (!preview || !selectedRows.length || tooMany) return;
    try {
      const res = await commit.mutateAsync({
        fileName: preview.fileName,
        format: preview.format,
        target: preview.target,
        rows: selectedRows.map((r) => ({
          date: r.date,
          description: r.description,
          amount: r.amount,
          type: r.type,
          externalId: r.externalId,
          categoryId: choices.get(r.index)?.categoryId ?? null,
        })),
      });
      onOpenChange(false);
      const created = res.created;
      toast.success(created === 1 ? '1 lançamento importado' : `${created} lançamentos importados`, {
        description: res.skipped ? `${res.skipped} já existiam e foram ignorados.` : 'Já aparecem no extrato, nas faturas e nos relatórios.',
        duration: 12_000,
        action: created ? { label: 'Desfazer', onClick: () => void undo(res.batch.id) } : undefined,
      });
    } catch (error) {
      toastError(error);
    }
  }

  const isCsv = (preview?.format ?? file?.format) === 'csv';
  const destination = preview ? targetLabel(preview.target, { accounts: accounts.data, cards: cards.data }) : '';
  const mappingValid = mapping ? csvMappingSchema.safeParse(mapping).success : false;

  const steps: { id: Step; label: string }[] = [
    { id: 'file', label: 'Arquivo' },
    ...(isCsv ? [{ id: 'mapping' as const, label: 'Colunas' }] : []),
    { id: 'review', label: 'Revisão' },
  ];

  const footer =
    step === 'file' ? (
      <>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancelar
        </Button>
        <Button onClick={() => void runPreview()} loading={analyze.isPending} disabled={!file || !target}>
          Continuar
        </Button>
      </>
    ) : step === 'mapping' ? (
      <>
        <Button variant="ghost" onClick={() => setStep('file')}>
          Voltar
        </Button>
        <Button
          onClick={() => live.data && accept(live.data)}
          disabled={!mappingValid || !live.data?.rows.length || live.loading}
        >
          {live.data?.rows.length ? `Revisar ${live.data.rows.length} lançamentos` : 'Revisar lançamentos'}
        </Button>
      </>
    ) : (
      <>
        <p className="mr-auto hidden min-w-0 truncate text-xs text-muted sm:block" aria-live="polite">
          <span className="font-semibold text-fg">{selectedRows.length}</span> {selectedRows.length === 1 ? 'selecionado' : 'selecionados'}
          {income ? <span className="tabular text-success"> · +{formatBRL(income)}</span> : null}
          {expense ? <span className="tabular text-danger"> · −{formatBRL(expense)}</span> : null}
          {tooMany ? <span className="text-danger"> · máximo de {MAX_IMPORT_ROWS} por importação</span> : null}
        </p>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancelar
        </Button>
        <WriteGate>
          <Button onClick={() => void confirm()} loading={commit.isPending} disabled={!selectedRows.length || tooMany}>
            {selectedRows.length === 0
              ? 'Nenhum lançamento selecionado'
              : selectedRows.length === 1
                ? 'Importar 1 lançamento'
                : `Importar ${selectedRows.length} lançamentos`}
          </Button>
        </WriteGate>
      </>
    );

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      width={step === 'file' ? 'lg' : 'xl'}
      title="Importar extrato ou fatura"
      description={
        step === 'file'
          ? 'Envie o arquivo OFX ou CSV exportado pelo banco e escolha onde os lançamentos entram.'
          : step === 'mapping'
            ? 'Indique o que cada coluna do CSV representa.'
            : 'Confira os lançamentos, ajuste as categorias e desmarque o que não quiser importar.'
      }
      headerExtra={
        <ol className="flex items-center gap-2 text-xs font-semibold" aria-label="Etapas da importação">
          {steps.map((s, i) => {
            const currentIndex = steps.findIndex((x) => x.id === step);
            const state = i < currentIndex ? 'done' : i === currentIndex ? 'current' : 'todo';
            return (
              <li key={s.id} className="flex items-center gap-2" aria-current={state === 'current' ? 'step' : undefined}>
                {i > 0 ? <span className="h-px w-5 bg-border-strong" aria-hidden /> : null}
                <span
                  className={cn(
                    'flex size-5 items-center justify-center rounded-full text-[11px]',
                    state === 'current' ? 'bg-primary text-primary-fg' : state === 'done' ? 'bg-primary-soft text-primary-soft-fg' : 'bg-bg-subtle text-muted',
                  )}
                >
                  {i + 1}
                </span>
                <span className={state === 'todo' ? 'text-muted' : 'text-fg'}>{s.label}</span>
              </li>
            );
          })}
        </ol>
      }
      footer={footer}
    >
      {step === 'file' ? (
        <FileStep
          file={file}
          onFile={chooseFile}
          source={source}
          onSource={(s) => {
            setSource(s);
            setPreviewError(null);
          }}
          accounts={activeAccounts}
          cards={activeCards}
          invoiceMode={invoiceMode}
          onInvoiceMode={setInvoiceMode}
          invoiceMonth={invoiceMonth}
          onInvoiceMonth={setInvoiceMonth}
          error={previewError}
        />
      ) : step === 'mapping' && file && mapping ? (
        <MappingStep
          content={file.content}
          mapping={mapping}
          onChange={setMapping}
          apiColumns={live.data?.csvColumns ?? preview?.csvColumns ?? null}
          live={live}
        />
      ) : step === 'review' && preview ? (
        <ReviewStep
          preview={preview}
          destination={destination}
          choices={choices}
          onChoices={setChoices}
          onChangeFile={() => setStep('file')}
          onAdjustColumns={preview.format === 'csv' ? () => setStep('mapping') : null}
        />
      ) : null}
    </Sheet>
  );
}

/** Re-reads the CSV with the mapping being edited (debounced; stale requests are aborted). */
function useLivePreview(
  base: { fileName: string; content: string; target: ImportTarget } | null,
  mapping: CsvMapping | null,
): LivePreviewState {
  const [state, setState] = useState<LivePreviewState>({ data: null, error: null, loading: false });

  useEffect(() => {
    if (!base || !mapping) return;
    const parsed = csvMappingSchema.safeParse(mapping);
    if (!parsed.success) {
      setState({ data: null, error: parsed.error.issues[0]?.message ?? 'Mapeamento incompleto', loading: false });
      return;
    }
    const controller = new AbortController();
    setState((s) => ({ ...s, error: null, loading: true }));
    const timer = setTimeout(() => {
      previewImport({ ...base, csv: parsed.data }, controller.signal)
        .then((data) => setState({ data, error: null, loading: false }))
        .catch((error: unknown) => {
          if ((error as Error).name === 'AbortError') return;
          setState({ data: null, error: errorMessage(error), loading: false });
        });
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [base, mapping]);

  return state;
}
