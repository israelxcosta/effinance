// Reads a bank statement / card invoice file in the browser and turns it into the text sent to
// `POST /imports/preview`. The API only receives decoded text, so the charset is resolved here:
//
// - OFX 1.x (SGML) declares it in the header (`ENCODING:` / `CHARSET:1252`); OFX 2.x (XML) in the
//   XML declaration (`encoding="UTF-8"`).
// - CSV has no declaration: strict UTF-8 first, falling back to windows-1252 (Excel / older bank
//   exports in Brazil).
// - Many Brazilian banks declare `CHARSET:1252` and actually write UTF-8. Bytes that form valid
//   multi-byte UTF-8 sequences are practically never real windows-1252 text ("Ã§" instead of "ç"),
//   so valid UTF-8 with non-ASCII bytes wins over a single-byte declaration.

import { MAX_IMPORT_CONTENT_CHARS, type ImportFormat } from '@effinance/shared';

export const ACCEPTED_EXTENSIONS = ['.ofx', '.qfx', '.csv', '.txt'] as const;
export const ACCEPT_ATTRIBUTE = '.ofx,.qfx,.csv,.txt,text/csv,text/plain,application/x-ofx,application/vnd.intu.qfx';

export type ImportCharset = 'utf-8' | 'windows-1252' | 'utf-16le' | 'utf-16be';

export interface DecodedImportFile {
  fileName: string;
  format: ImportFormat;
  content: string;
  charset: ImportCharset;
  /** Charset declared by the OFX header, when any (may differ from `charset` on mislabeled files). */
  declaredCharset: 'utf-8' | 'windows-1252' | null;
  /** Original size in bytes. */
  size: number;
}

export class ImportFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportFileError';
  }
}

/** UTF-16 never needs more than 2 bytes per char: anything larger cannot fit the limit. */
export const MAX_IMPORT_FILE_BYTES = MAX_IMPORT_CONTENT_CHARS * 2 + 4;

const SINGLE_BYTE_LABELS = /^(?:1252|cp-?1252|windows-?1252|8859-?1|iso-?8859-?1|latin-?1|ansi)$/i;

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot >= 0 ? fileName.slice(dot).toLowerCase() : '';
}

function hasNonAscii(bytes: Uint8Array): boolean {
  for (let i = 0; i < bytes.length; i++) if (bytes[i]! > 0x7f) return true;
  return false;
}

function tryUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

// windows-1252 bytes 0x80–0x9F (€, curly quotes, dashes…). Browsers decode them per WHATWG; some
// runtimes (Node 22's TextDecoder) treat the label as ISO-8859-1 and return C1 control characters.
const CP1252_HIGH =
  '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f' +
  '\u0090‘’“”•–—˜™š›œ\u009džŸ';

function decodeWith(bytes: Uint8Array, charset: ImportCharset): string {
  const text = new TextDecoder(charset).decode(bytes);
  return charset === 'windows-1252' ? text.replace(/[\u0080-\u009f]/g, (c) => CP1252_HIGH[c.charCodeAt(0) - 0x80]!) : text;
}

/** ASCII view of the first bytes, enough to read OFX headers and XML declarations. */
function asciiHead(bytes: Uint8Array, length = 2048): string {
  let out = '';
  const end = Math.min(bytes.length, length);
  for (let i = 0; i < end; i++) out += String.fromCharCode(bytes[i]!);
  return out;
}

function looksLikeOfx(head: string): boolean {
  return /OFXHEADER\s*[:=]/i.test(head) || /<OFX[\s>]/i.test(head);
}

/** Charset declared by an OFX file: `utf-8`, `windows-1252` or null (none / unknown). */
export function declaredOfxCharset(head: string): 'utf-8' | 'windows-1252' | null {
  // OFX 2.x: <?xml version="1.0" encoding="UTF-8"?>
  const xml = /<\?xml[^>]*\bencoding\s*=\s*["']([^"']+)["']/i.exec(head);
  if (xml) {
    const label = xml[1]!.trim();
    if (/^utf-?8$/i.test(label)) return 'utf-8';
    if (SINGLE_BYTE_LABELS.test(label)) return 'windows-1252';
    return null;
  }
  // OFX 1.x (SGML) header lines: ENCODING:USASCII|UTF-8 and CHARSET:1252|ISO-8859-1|NONE.
  const encoding = /^\s*ENCODING\s*:\s*([^\s<]+)/im.exec(head)?.[1] ?? '';
  if (/^utf-?8$/i.test(encoding)) return 'utf-8';
  const charset = /^\s*CHARSET\s*:\s*([^\s<]+)/im.exec(head)?.[1] ?? '';
  if (/^utf-?8$/i.test(charset)) return 'utf-8';
  if (SINGLE_BYTE_LABELS.test(charset)) return 'windows-1252';
  return null;
}

function bomCharset(bytes: Uint8Array): { charset: ImportCharset; skip: number } | null {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { charset: 'utf-8', skip: 3 };
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { charset: 'utf-16le', skip: 2 };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { charset: 'utf-16be', skip: 2 };
  return null;
}

/**
 * Decodes the bytes of an OFX/QFX/CSV/TXT file. Throws `ImportFileError` (message in pt-BR) for
 * empty, binary (e.g. a renamed .xlsx/.pdf) or oversized files.
 */
export function decodeImportBytes(input: ArrayBuffer | Uint8Array, fileName: string): DecodedImportFile {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const ext = extensionOf(fileName);
  if (ext && !(ACCEPTED_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new ImportFileError('Formato não suportado. Envie um arquivo .ofx, .qfx, .csv ou .txt.');
  }
  if (bytes.length === 0) throw new ImportFileError('O arquivo está vazio.');
  if (bytes.length > MAX_IMPORT_FILE_BYTES) throw tooLarge();

  let charset: ImportCharset;
  let content: string;
  let declared: 'utf-8' | 'windows-1252' | null = null;
  const bom = bomCharset(bytes);
  if (bom) {
    charset = bom.charset;
    content = decodeWith(bytes.subarray(bom.skip), charset);
  } else {
    // Text files never contain NUL bytes (UTF-16 without a BOM is not supported).
    if (bytes.subarray(0, 8192).includes(0)) {
      throw new ImportFileError('Este arquivo não parece ser um extrato em texto. Exporte do banco em OFX ou CSV.');
    }
    const head = asciiHead(bytes);
    declared = looksLikeOfx(head) ? declaredOfxCharset(head) : null;
    // Pure ASCII reads the same in every charset; otherwise strict UTF-8 decides (see the top note):
    // a UTF-8 declaration with invalid bytes and files without declaration (CSV) fall back to 1252.
    const utf8 = hasNonAscii(bytes) ? tryUtf8(bytes) : null;
    if (utf8 !== null) {
      charset = 'utf-8';
      content = utf8;
    } else {
      charset = hasNonAscii(bytes) || declared === 'windows-1252' ? 'windows-1252' : 'utf-8';
      content = decodeWith(bytes, charset);
    }
  }

  if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);
  if (!content.trim()) throw new ImportFileError('O arquivo está vazio.');
  if (content.length > MAX_IMPORT_CONTENT_CHARS) throw tooLarge();

  const format: ImportFormat = looksLikeOfx(content.slice(0, 4096)) || ext === '.ofx' || ext === '.qfx' ? 'ofx' : 'csv';
  return { fileName: fileName.trim().slice(0, 255) || 'extrato', format, content, charset, declaredCharset: declared, size: bytes.length };
}

function tooLarge(): ImportFileError {
  const limit = new Intl.NumberFormat('pt-BR').format(MAX_IMPORT_CONTENT_CHARS);
  return new ImportFileError(`Arquivo muito grande (limite de ${limit} caracteres). Exporte um período menor.`);
}

/** Reads a `File` chosen by the user (drag and drop or picker). */
export async function readImportFile(file: File): Promise<DecodedImportFile> {
  if (file.size > MAX_IMPORT_FILE_BYTES) throw tooLarge();
  const buffer = await file.arrayBuffer();
  return decodeImportBytes(buffer, file.name);
}

export const CHARSET_LABELS: Record<ImportCharset, string> = {
  'utf-8': 'UTF-8',
  'windows-1252': 'Windows-1252 (ANSI)',
  'utf-16le': 'UTF-16',
  'utf-16be': 'UTF-16',
};

// ---------------------------------------------------------------------------
// CSV header (fallback for the mapping step when the API cannot read the file)
// ---------------------------------------------------------------------------

export type CsvDelimiter = ',' | ';' | '\t' | '|';
const DELIMITERS: CsvDelimiter[] = [';', ',', '\t', '|'];

/** Splits one CSV line, honoring double quotes ("a;b" stays one cell, "" is an escaped quote). */
export function splitCsvLine(line: string, delimiter: CsvDelimiter): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell.trim() === '') {
      quoted = true;
      cell = '';
    } else if (ch === delimiter) {
      cells.push(cell.trim());
      cell = '';
    } else cell += ch;
  }
  cells.push(cell.trim());
  return cells;
}

/** Most frequent delimiter of the first non-empty lines (ties keep the Brazilian `;`). */
export function guessDelimiter(content: string): CsvDelimiter {
  const lines = content.split(/\r?\n/).filter((l) => l.trim()).slice(0, 5);
  let best: CsvDelimiter = ';';
  let bestScore = 0;
  for (const d of DELIMITERS) {
    const counts = lines.map((l) => splitCsvLine(l, d).length - 1);
    const min = counts.length ? Math.min(...counts) : 0;
    if (min > bestScore) {
      best = d;
      bestScore = min;
    }
  }
  return best;
}

/** First rows of a CSV as cells (for the mapping step when the API returned no columns). */
export function csvSample(content: string, delimiter: CsvDelimiter, rows = 6): string[][] {
  return content
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .slice(0, rows)
    .map((l) => splitCsvLine(l, delimiter));
}
