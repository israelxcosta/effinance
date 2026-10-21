// Turns an uploaded statement (OFX or CSV text) into dated, signed rows with a stable externalId:
// the file's own id (OFX FITID, CSV id column) or, failing that, a hash of date | amount |
// normalized description | n-th identical occurrence — the same file imported twice yields the same
// ids, so nothing is created twice. WebCrypto only (runs in the browser demo).

import type { CsvMapping, ImportFormat, ISODate } from '@effinance/shared';
import { sha256Hex } from '../../lib/crypto/encoding';
import { parseCsv } from './csv';
import { normalizeDescription } from './describe';
import { looksLikeOfx, parseOfx } from './ofx';

export interface ParsedRow {
  /** Position in the file (0-based). */
  index: number;
  date: ISODate;
  description: string;
  /** Signed cents: negative = money out (expense / card purchase). */
  amount: number;
  externalId: string;
}

export interface ParsedImport {
  format: ImportFormat;
  institution: string | null;
  accountHint: string | null;
  period: { from: ISODate; to: ISODate } | null;
  /** OFX: whether the file is a bank or a credit card statement. */
  statementKind: 'bank' | 'credit_card' | null;
  csvColumns: string[] | null;
  csvMapping: CsvMapping | null;
  rows: ParsedRow[];
}

export class ImportParseError extends Error {}

export function detectFormat(content: string): ImportFormat {
  return looksLikeOfx(content) ? 'ofx' : 'csv';
}

const MAX_SOURCE_ID = 150;

/** Stable ids: the file's id when it has one (repeated ids get "#n"), otherwise a content hash. */
async function assignExternalIds(
  rows: { date: ISODate; amount: number; description: string; sourceId: string | null }[],
  prefix: string,
): Promise<string[]> {
  const seenIds = new Map<string, number>();
  const seenContent = new Map<string, number>();
  const out: string[] = [];
  for (const row of rows) {
    if (row.sourceId) {
      const n = seenIds.get(row.sourceId) ?? 0;
      seenIds.set(row.sourceId, n + 1);
      const base = row.sourceId.length > MAX_SOURCE_ID ? `#${(await sha256Hex(row.sourceId)).slice(0, 40)}` : row.sourceId;
      out.push(`${prefix}:${base}${n > 0 ? `#${n}` : ''}`);
      continue;
    }
    const key = `${row.date}|${row.amount}|${normalizeDescription(row.description)}`;
    const n = seenContent.get(key) ?? 0;
    seenContent.set(key, n + 1);
    out.push(`h:${(await sha256Hex(`${key}|${n}`)).slice(0, 40)}`);
  }
  return out;
}

export async function parseImportFile(input: {
  content: string;
  format?: ImportFormat;
  csv?: CsvMapping;
}): Promise<ParsedImport> {
  const format = input.format ?? detectFormat(input.content);
  if (format === 'ofx') {
    let statement;
    try {
      statement = parseOfx(input.content);
    } catch (error) {
      throw new ImportParseError((error as Error).message);
    }
    const ids = await assignExternalIds(
      statement.transactions.map((t) => ({ ...t, sourceId: t.fitId })),
      'fitid',
    );
    return {
      format,
      institution: statement.institution,
      accountHint: statement.accountHint,
      period: statement.period,
      statementKind: statement.kind,
      csvColumns: null,
      csvMapping: null,
      rows: statement.transactions.map((t, index) => ({
        index,
        date: t.date,
        description: t.description,
        amount: t.amount,
        externalId: ids[index]!,
      })),
    };
  }

  const parsed = parseCsv(input.content, input.csv);
  const ids = await assignExternalIds(
    parsed.rows.map((r) => ({ ...r, sourceId: r.fileId })),
    'id',
  );
  const dates = parsed.rows.map((r) => r.date).sort();
  return {
    format,
    institution: parsed.institution,
    accountHint: null,
    period: dates.length ? { from: dates[0]!, to: dates[dates.length - 1]! } : null,
    statementKind: null,
    csvColumns: parsed.columns,
    csvMapping: parsed.mapping,
    rows: parsed.rows.map((r, index) => ({
      index,
      date: r.date,
      description: r.description,
      amount: r.amount,
      externalId: ids[index]!,
    })),
  };
}
