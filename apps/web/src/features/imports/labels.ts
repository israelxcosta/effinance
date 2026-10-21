import {
  CSV_DATE_FORMATS,
  formatMonthKey,
  type Account,
  type CreditCard,
  type CsvDateFormat,
  type CsvMapping,
  type ImportBatch,
  type ImportPreviewRow,
  type ImportTarget,
} from '@effinance/shared';
import { csvSample, guessDelimiter, type CsvDelimiter } from './decode';

export const DELIMITER_LABELS: Record<CsvDelimiter, string> = {
  ';': 'Ponto e vírgula ( ; )',
  ',': 'Vírgula ( , )',
  '\t': 'Tabulação',
  '|': 'Barra vertical ( | )',
};

export const DATE_FORMAT_LABELS: Record<CsvDateFormat, string> = {
  'DD/MM/YYYY': 'DD/MM/AAAA',
  'DD/MM/YY': 'DD/MM/AA',
  'YYYY-MM-DD': 'AAAA-MM-DD',
  'MM/DD/YYYY': 'MM/DD/AAAA (EUA)',
};
export { CSV_DATE_FORMATS };

const DATE_CELL = /^(\d{1,2}[/.-]\d{1,2}[/.-](\d{2}|\d{4})|\d{4}-\d{1,2}-\d{1,2})(?:[ T].*)?$/;
const AMOUNT_CELL = /^[-+(]?\s*(R\$)?\s*-?[\d.,]*\d[\d.,]*\)?\s*[-DC]?$/i;

/**
 * Starting point of the mapping step when the API could not detect the layout: guesses the date,
 * description and amount (or debit/credit) columns from the header names and the first rows.
 */
export function defaultCsvMapping(content: string): CsvMapping {
  const delimiter = guessDelimiter(content);
  const sample = csvSample(content, delimiter, 12);
  const first = sample[0] ?? [];
  const hasHeader = first.length > 0 && !first.some((c) => DATE_CELL.test(c)) && first.some((c) => /[a-zà-ú]/i.test(c));
  const header = hasHeader ? first.map((h) => h.toLowerCase()) : [];
  const rows = hasHeader ? sample.slice(1) : sample;
  const width = Math.max(1, ...sample.map((r) => r.length));
  const share = (i: number, re: RegExp) => {
    const cells = rows.map((r) => r[i] ?? '').filter(Boolean);
    return cells.length ? cells.filter((c) => re.test(c)).length / cells.length : 0;
  };
  const cols = Array.from({ length: width }, (_, i) => i);
  const byName = (re: RegExp, except: number[] = []) => cols.find((i) => !except.includes(i) && re.test(header[i] ?? '')) ?? null;

  const dateColumn = byName(/^data|^date|dt\b|lan[çc]amento|movimento/) ?? cols.find((i) => share(i, DATE_CELL) > 0.6) ?? 0;
  const dates = rows.map((r) => r[dateColumn] ?? '').filter(Boolean);
  const dateFormat: CsvDateFormat = dates.some((d) => /^\d{4}-/.test(d))
    ? 'YYYY-MM-DD'
    : dates.length && dates.every((d) => /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2}(?:\D|$)/.test(d))
      ? 'DD/MM/YY'
      : 'DD/MM/YYYY';

  const numeric = cols.filter((i) => i !== dateColumn && !/saldo|balance/.test(header[i] ?? '') && share(i, AMOUNT_CELL) > 0.6);
  const debitColumn = byName(/d[ée]bito|sa[íi]da|debit/, [dateColumn]);
  const creditColumn = byName(/cr[ée]dito|entrada|credit/, [dateColumn]);
  const split = debitColumn !== null && creditColumn !== null;
  const amountColumn = split ? null : (byName(/valor|amount|quantia|montante/, [dateColumn]) ?? numeric[0] ?? Math.min(2, width - 1));
  const used = [dateColumn, amountColumn, debitColumn, creditColumn].filter((v): v is number => v !== null);
  const avgLength = (i: number) => rows.reduce((s, r) => s + (r[i]?.length ?? 0), 0) / Math.max(rows.length, 1);
  const descriptionColumn =
    byName(/hist[óo]rico|descri|title|memo|estabelecimento|identifica/, used) ??
    cols.filter((i) => !used.includes(i) && share(i, AMOUNT_CELL) < 0.5).sort((a, b) => avgLength(b) - avgLength(a))[0] ??
    Math.min(1, width - 1);

  const amountCells = rows.flatMap((r) => [amountColumn, debitColumn, creditColumn].map((i) => (i === null ? '' : (r[i] ?? '')))).filter(Boolean);
  const decimalSeparator = amountCells.some((c) => /,\d{1,2}\)?\s*[-DC]?$/i.test(c)) ? ',' : amountCells.some((c) => /\.\d{1,2}\)?\s*[-DC]?$/i.test(c)) ? '.' : delimiter === ',' ? '.' : ',';

  return { delimiter, hasHeader, dateColumn, descriptionColumn, amountColumn, debitColumn: split ? debitColumn : null, creditColumn: split ? creditColumn : null, dateFormat, decimalSeparator, invertSign: false };
}

/**
 * "Já importado" (same externalId: never created twice) vs "Possível duplicado" (same date, amount
 * and description as an existing row). The contract only has `duplicate`, so the API note decides.
 */
export function duplicateKind(row: ImportPreviewRow): 'imported' | 'similar' | null {
  if (!row.duplicate) return null;
  return row.note && /j[áa]\s+importad/i.test(row.note) ? 'imported' : 'similar';
}

export function typeLabel(type: 'income' | 'expense', targetKind: ImportTarget['kind']): string {
  if (targetKind === 'credit_card') return type === 'expense' ? 'Compra' : 'Estorno/crédito';
  return type === 'expense' ? 'Saída' : 'Entrada';
}

export function sourceValue(target: ImportTarget | undefined): string {
  if (!target) return '';
  return target.kind === 'account' ? `account:${target.accountId}` : `card:${target.creditCardId}`;
}

interface TargetRefs {
  accounts?: Account[];
  cards?: CreditCard[];
}

/** "Nubank · conta" / "Cartão Inter · fatura de outubro de 2026" for summaries and history. */
export function targetLabel(
  target: { accountId?: string | null; creditCardId?: string | null; invoiceMonth?: string | null },
  refs: TargetRefs,
): string {
  if (target.creditCardId) {
    const card = refs.cards?.find((c) => c.id === target.creditCardId);
    const name = card?.name ?? 'Cartão';
    return target.invoiceMonth ? `${name} · fatura de ${formatMonthKey(target.invoiceMonth).toLowerCase()}` : `${name} · pela data da compra`;
  }
  if (target.accountId) return refs.accounts?.find((a) => a.id === target.accountId)?.name ?? 'Conta';
  return '—';
}

export function batchTitle(batch: ImportBatch): string {
  if (batch.origin === 'open_finance') return 'Sincronização Open Finance';
  return batch.fileName ?? 'Arquivo importado';
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} KB`;
  return `${(bytes / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
}
