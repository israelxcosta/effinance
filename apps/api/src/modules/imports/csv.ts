// CSV statements and card invoices exported by Brazilian banks: BOM, quoted fields (RFC 4180),
// delimiter and header detection, column presets by header names (Nubank, Inter, Itaú, BB,
// Bradesco, Santander, C6…) and a data-driven fallback for files without a header. Pure functions.

import type { CsvDateFormat, CsvMapping, ISODate } from '@effinance/shared';
import { cleanDescription, isBalanceLine, normalizeDescription } from './describe';
import { detectDateFormat, parseAmount, parseDate } from './values';

export type CsvDelimiter = CsvMapping['delimiter'];

export interface CsvRow {
  date: ISODate;
  /** Signed cents (negative = money out), after `invertSign`. */
  amount: number;
  description: string;
  /** Transaction id written in the file (e.g. Nubank "Identificador"), when there is such a column. */
  fileId: string | null;
}

export interface CsvParseResult {
  columns: string[];
  /** Null when the columns could not be recognized (the UI asks for the mapping). */
  mapping: CsvMapping | null;
  rows: CsvRow[];
  /** Bank recognized from the header layout, e.g. "Nubank". */
  institution: string | null;
}

const DELIMITERS: CsvDelimiter[] = [';', ',', '\t', '|'];
const HEADER_SCAN = 15;
/** Columns kept per line: the mapping addresses columns 0–200; anything wider is not a statement. */
export const MAX_CSV_COLUMNS = 201;
/** Non-empty lines read (MAX_IMPORT_ROWS movements plus preamble, balances and junk lines). */
export const MAX_CSV_RECORDS = 20_000;

/**
 * Splits CSV text into records (quotes, doubled quotes, newlines inside quotes, CRLF) in linear time.
 * Empty lines are dropped; fields after the first `maxFields` of a line are ignored.
 */
export function splitCsv(
  text: string,
  delimiter: string,
  maxRecords = Number.POSITIVE_INFINITY,
  maxFields = MAX_CSV_COLUMNS,
): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  // Whether `field` is still only whitespace (then a quote opens a quoted field). Tracked per
  // character: re-trimming the growing field at every quote made a line of quotes quadratic.
  let blank = true;
  let quoted = false;
  let i = 0;
  const n = text.length;
  const endField = () => {
    if (record.length < maxFields) record.push(field);
    field = '';
    blank = true;
  };
  while (i < n) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          blank = false;
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += ch;
      if (blank && ch.trim() !== '') blank = false;
      i += 1;
      continue;
    }
    if (ch === '"' && blank) {
      quoted = true;
      field = '';
      i += 1;
      continue;
    }
    if (ch === delimiter) {
      endField();
      i += 1;
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      const emptyLine = record.length === 0 && field === '';
      endField();
      if (!emptyLine) {
        records.push(record);
        if (records.length >= maxRecords) return records;
      }
      record = [];
      i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    field += ch;
    if (blank && ch.trim() !== '') blank = false;
    i += 1;
  }
  if (field !== '' || record.length > 0) {
    endField();
    records.push(record);
  }
  return records;
}

/** The delimiter that splits the first lines into the most consistent number of fields (> 1). */
export function detectDelimiter(text: string): CsvDelimiter {
  const sample = text.slice(0, 20_000);
  let best: { delimiter: CsvDelimiter; score: number } = { delimiter: ';', score: -1 };
  for (const delimiter of DELIMITERS) {
    const counts = splitCsv(sample, delimiter, 40)
      .filter((r) => r.some((c) => c.trim() !== ''))
      .map((r) => r.length);
    const freq = new Map<number, number>();
    for (const c of counts) if (c > 1) freq.set(c, (freq.get(c) ?? 0) + 1);
    let score = 0;
    for (const [fields, times] of freq) score = Math.max(score, times * 100 + Math.min(fields, 50));
    if (score > best.score) best = { delimiter, score };
  }
  return best.delimiter;
}

const norm = (cell: string | undefined) => normalizeDescription(cell ?? '');

const DATE_NAMES = [
  'data',
  'date',
  'data lancamento',
  'data do lancamento',
  'data de lancamento',
  'data da transacao',
  'data transacao',
  'data movimento',
  'data mov',
  'dt lancamento',
  'data da compra',
  'data compra',
];
// Order matters when a file has several: C6 "Título" is the full text ("Descrição" is a category),
// Inter "Descrição" is the counterparty ("Histórico" only says "Pix enviado").
const DESCRIPTION_NAMES = [
  'title',
  'titulo',
  'descricao',
  'description',
  'historico',
  'lancamento',
  'lancamentos',
  'detalhes',
  'estabelecimento',
  'descricao do lancamento',
  'memo',
  'nome',
];
const AMOUNT_NAMES = ['valor', 'amount', 'valor r', 'valor rs', 'valor em r', 'valor brl', 'quantia', 'montante', 'valor da transacao', 'valor lancamento'];
const DEBIT_NAMES = ['debito', 'debitos', 'saida', 'saidas', 'debito r', 'saida r', 'saidas r', 'debitos r', 'valor debito'];
const CREDIT_NAMES = ['credito', 'creditos', 'entrada', 'entradas', 'credito r', 'entrada r', 'entradas r', 'creditos r', 'valor credito'];
const ID_NAMES = ['identificador', 'id', 'fitid', 'id da transacao', 'id transacao', 'codigo da transacao'];

function findColumn(header: string[], names: string[], taken: Set<number>, fallback?: (n: string) => boolean): number | null {
  for (const name of names) {
    const i = header.findIndex((h, idx) => !taken.has(idx) && h === name);
    if (i >= 0) return i;
  }
  if (fallback) {
    const i = header.findIndex((h, idx) => !taken.has(idx) && fallback(h));
    if (i >= 0) return i;
  }
  return null;
}

function isHeaderRow(record: string[]): boolean {
  const cells = record.map(norm);
  const hasDate = cells.some((c) => DATE_NAMES.includes(c) || c.startsWith('data '));
  const hasMoney = cells.some(
    (c) => AMOUNT_NAMES.includes(c) || DEBIT_NAMES.includes(c) || CREDIT_NAMES.includes(c) || c.startsWith('valor'),
  );
  return hasDate && hasMoney;
}

/** Index of the header row (some exports start with a few lines of account information). */
function headerIndex(records: string[][]): number | null {
  const limit = Math.min(records.length, HEADER_SCAN);
  for (let i = 0; i < limit; i++) if (isHeaderRow(records[i]!)) return i;
  return null;
}

function detectDecimal(samples: string[]): ',' | '.' {
  let comma = 0;
  let dot = 0;
  for (const s of samples) {
    const v = s.trim();
    if (/,\d{1,2}\)?\s*[DC-]?$/i.test(v)) comma++;
    else if (/\.\d{1,2}\)?\s*[DC-]?$/i.test(v)) dot++;
    else if (/\d\.\d{3}(?!\d)/.test(v) && !v.includes(',')) comma++;
    else if (/\d,\d{3}(?!\d)/.test(v) && !v.includes('.')) dot++;
  }
  return dot > comma ? '.' : ',';
}

function columnValues(records: string[][], column: number | null, limit = 200): string[] {
  if (column === null) return [];
  const out: string[] = [];
  for (const r of records) {
    const v = r[column]?.trim();
    if (v) out.push(v);
    if (out.length >= limit) break;
  }
  return out;
}

/** Files without a header: date, amount and description columns guessed from the values. */
function guessFromData(records: string[][]): Omit<CsvMapping, 'delimiter' | 'hasHeader' | 'invertSign'> | null {
  const width = Math.max(0, ...records.slice(0, 50).map((r) => r.length));
  const sample = records.slice(0, 50);
  let dateColumn: number | null = null;
  let dateFormat: CsvDateFormat | null = null;
  for (let c = 0; c < width && dateColumn === null; c++) {
    const format = detectDateFormat(columnValues(sample, c));
    if (format) {
      dateColumn = c;
      dateFormat = format;
    }
  }
  if (dateColumn === null || !dateFormat) return null;
  let amountColumn: number | null = null;
  let bestRatio = 0;
  for (let c = 0; c < width; c++) {
    if (c === dateColumn) continue;
    const values = columnValues(sample, c);
    if (values.length === 0) continue;
    const ok = values.filter((v) => /\d[.,]\d{2}\)?\s*[DC-]?$/i.test(v) && parseAmount(v, detectDecimal([v])) !== null).length;
    const ratio = ok / values.length;
    if (ratio > bestRatio + 0.0001 && ratio >= 0.8) {
      bestRatio = ratio;
      amountColumn = c;
    }
  }
  if (amountColumn === null) return null;
  let descriptionColumn: number | null = null;
  let longest = 0;
  for (let c = 0; c < width; c++) {
    if (c === dateColumn || c === amountColumn) continue;
    const values = columnValues(sample, c);
    const letters = values.reduce((sum, v) => sum + (v.match(/\p{L}/gu)?.length ?? 0), 0);
    if (letters > longest) {
      longest = letters;
      descriptionColumn = c;
    }
  }
  if (descriptionColumn === null) return null;
  return {
    dateColumn,
    descriptionColumn,
    amountColumn,
    debitColumn: null,
    creditColumn: null,
    idColumn: null,
    dateFormat,
    decimalSeparator: detectDecimal(columnValues(sample, amountColumn)),
  };
}

/** Recognizes the layout of `records` (null when the columns cannot be told apart). */
export function detectMapping(records: string[][], delimiter: CsvDelimiter): { mapping: CsvMapping; institution: string | null } | null {
  const hi = headerIndex(records);
  if (hi === null) {
    const guessed = guessFromData(records);
    return guessed ? { mapping: { delimiter, hasHeader: false, invertSign: false, ...guessed }, institution: null } : null;
  }
  const header = records[hi]!.map(norm);
  const data = records.slice(hi + 1);
  const taken = new Set<number>();
  const take = (i: number | null) => {
    if (i !== null) taken.add(i);
    return i;
  };
  const dateColumn = take(findColumn(header, DATE_NAMES, taken, (h) => h.startsWith('data') && !h.includes('contabil')));
  const amountColumn = take(
    findColumn(header, AMOUNT_NAMES, taken, (h) => h.startsWith('valor') && !h.includes('saldo') && !h.includes('debito') && !h.includes('credito')),
  );
  const debitColumn = amountColumn === null ? take(findColumn(header, DEBIT_NAMES, taken)) : null;
  const creditColumn = amountColumn === null ? take(findColumn(header, CREDIT_NAMES, taken)) : null;
  const idColumn = take(findColumn(header, ID_NAMES, taken));
  const descriptionColumn = take(
    findColumn(header, DESCRIPTION_NAMES, taken, (h) => h.includes('descri') || h.includes('histor')),
  );
  if (dateColumn === null || descriptionColumn === null) return null;
  if (amountColumn === null && (debitColumn === null || creditColumn === null)) return null;

  const dateFormat = detectDateFormat(columnValues(data, dateColumn).slice(0, 100));
  if (!dateFormat) return null;
  const moneySamples = [
    ...columnValues(data, amountColumn),
    ...columnValues(data, debitColumn),
    ...columnValues(data, creditColumn),
  ];
  // Nubank card invoices (`date,title,amount`) list purchases as positive numbers.
  const nubankCard = header.length === 3 && header[0] === 'date' && header[1] === 'title' && header[2] === 'amount';
  const nubankAccount = header.includes('identificador') && header.includes('valor') && header.includes('descricao');
  return {
    mapping: {
      delimiter,
      hasHeader: true,
      dateColumn,
      descriptionColumn,
      amountColumn,
      debitColumn,
      creditColumn,
      idColumn,
      dateFormat,
      decimalSeparator: detectDecimal(moneySamples),
      invertSign: nubankCard,
    },
    institution: nubankCard || nubankAccount ? 'Nubank' : null,
  };
}

/** Reads the rows with a mapping (detected or chosen by the user). Unreadable lines are left out. */
export function readCsvRows(records: string[][], mapping: CsvMapping): CsvRow[] {
  let start = 0;
  if (mapping.hasHeader) start = (headerIndex(records) ?? 0) + 1;
  const rows: CsvRow[] = [];
  const cell = (r: string[], c: number | null | undefined) => (c === null || c === undefined ? undefined : r[c]);
  for (let i = start; i < records.length; i++) {
    const r = records[i]!;
    if (r.every((c) => c.trim() === '')) continue;
    const date = parseDate(cell(r, mapping.dateColumn), mapping.dateFormat);
    if (!date) continue;
    const description = cleanDescription(cell(r, mapping.descriptionColumn) ?? '');
    if (isBalanceLine(description)) continue;
    let amount: number | null;
    if (mapping.amountColumn !== null) {
      amount = parseAmount(cell(r, mapping.amountColumn), mapping.decimalSeparator);
    } else {
      const debit = parseAmount(cell(r, mapping.debitColumn), mapping.decimalSeparator);
      const credit = parseAmount(cell(r, mapping.creditColumn), mapping.decimalSeparator);
      amount = debit === null && credit === null ? null : Math.abs(credit ?? 0) - Math.abs(debit ?? 0);
    }
    if (amount === null) continue;
    if (mapping.invertSign) amount = -amount;
    const fileId = cell(r, mapping.idColumn)?.trim() || null;
    rows.push({ date, amount: amount === 0 ? 0 : amount, description: description || 'Lançamento sem descrição', fileId });
  }
  return rows;
}

/** Parses a CSV export; `mapping` (from the UI) overrides detection. */
export function parseCsv(content: string, mapping?: CsvMapping): CsvParseResult {
  const text = content.replace(/^﻿/, '');
  const delimiter = mapping?.delimiter ?? detectDelimiter(text);
  const records = splitCsv(text, delimiter, MAX_CSV_RECORDS + 1);
  if (records.length > MAX_CSV_RECORDS) {
    throw new Error(`O arquivo tem mais de ${MAX_CSV_RECORDS} linhas. Exporte um período menor.`);
  }
  const detected = mapping ? null : detectMapping(records, delimiter);
  let used = mapping ?? detected?.mapping ?? null;
  if (mapping && mapping.idColumn === undefined) {
    // A mapping sent without `idColumn` still uses the file's id column when the header has one.
    const hi = mapping.hasHeader ? headerIndex(records) : null;
    const taken = new Set([mapping.dateColumn, mapping.descriptionColumn, mapping.amountColumn, mapping.debitColumn, mapping.creditColumn].filter((c): c is number => c !== null));
    used = { ...mapping, idColumn: hi === null ? null : findColumn(records[hi]!.map(norm), ID_NAMES, taken) };
  }

  const width = Math.max(0, ...records.slice(0, 200).map((r) => r.length));
  // Unrecognized layout: the first line is shown as column names (it usually is the header).
  const header = used && !used.hasHeader ? null : (records[headerIndex(records) ?? 0] ?? null);
  const columns = Array.from({ length: width }, (_, i) => {
    const name = header ? cleanDescription(header[i] ?? '').slice(0, 60) : '';
    return name || `Coluna ${i + 1}`;
  });
  return {
    columns,
    mapping: used,
    rows: used ? readCsvRows(records, used) : [],
    institution: detected?.institution ?? null,
  };
}
