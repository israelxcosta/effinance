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
import { guessDelimiter, type CsvDelimiter } from './decode';

export const DELIMITER_LABELS: Record<CsvDelimiter, string> = {
  ';': 'Ponto e vírgula ( ; )',
  ',': 'Vírgula ( , )',
  '\t': 'Tabulação',
  '|': 'Barra vertical ( | )',
};

export const DATE_FORMAT_LABELS: Record<CsvDateFormat, string> = {
  'DD/MM/YYYY': 'DD/MM/AAAA · 31/10/2026',
  'DD/MM/YY': 'DD/MM/AA · 31/10/26',
  'YYYY-MM-DD': 'AAAA-MM-DD · 2026-10-31',
  'MM/DD/YYYY': 'MM/DD/AAAA · 10/31/2026',
};
export { CSV_DATE_FORMATS };

/** Starting point of the mapping step when the API could not detect the layout. */
export function defaultCsvMapping(content: string): CsvMapping {
  const delimiter = guessDelimiter(content);
  const iso = /\b\d{4}-\d{2}-\d{2}\b/.test(content.slice(0, 2000));
  return {
    delimiter,
    hasHeader: true,
    dateColumn: 0,
    descriptionColumn: 1,
    amountColumn: 2,
    debitColumn: null,
    creditColumn: null,
    dateFormat: iso ? 'YYYY-MM-DD' : 'DD/MM/YYYY',
    // Comma decimals go with `;` in Brazilian exports; `,`-separated files use `.` (Nubank).
    decimalSeparator: delimiter === ',' ? '.' : ',',
    invertSign: false,
  };
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
