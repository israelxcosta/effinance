// Amounts and calendar dates as written in Brazilian bank exports (OFX and CSV). Pure functions on
// strings: no Node APIs (the browser demo runs the same code), no floating point for money.

import { isISODate, toISODate, type CsvDateFormat, type ISODate } from '@effinance/shared';

/**
 * Signed cents from a money text: "R$ -1.234,56", "(1.234,56)", "1,234.56", "-50", "50,00-",
 * "50,00 D" (debit) / "50,00 C" (credit). `decimal` is the decimal separator of the file; a value
 * that only has the other separator followed by 1–2 digits at the end is still read as decimal
 * ("12.50" in a "," file). Returns null when the text is not an amount.
 */
export function parseAmount(text: string | null | undefined, decimal: ',' | '.' = ','): number | null {
  if (text === null || text === undefined) return null;
  let s = String(text).replace(/[\s ]/g, '').replace(/^R\$|R\$$/gi, '').replace(/R\$/gi, '');
  if (s === '') return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  const suffix = /([DC])$/i.exec(s);
  if (suffix) {
    negative = negative || suffix[1]!.toUpperCase() === 'D';
    s = s.slice(0, -1);
  }
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  if (s.endsWith('-')) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  s = s.replace(/^R\$/i, '');
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;

  const other = decimal === ',' ? '.' : ',';
  let sep: string = decimal;
  if (!s.includes(decimal) && new RegExp(`^\\d+\\${other}\\d{1,2}$`).test(s)) sep = other;
  const thousands = sep === ',' ? '.' : ',';
  const parts = s.split(sep);
  if (parts.length > 2) return null;
  const intPart = parts[0]!.split(thousands).join('');
  const fracPart = parts[1] ?? '';
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(fracPart) || (intPart === '' && fracPart === '')) return null;
  // Round half up on the third decimal (some exports carry more digits).
  let cents = Number(intPart || '0') * 100 + Number((fracPart + '00').slice(0, 2));
  if (fracPart.length > 2 && Number(fracPart[2]) >= 5) cents += 1;
  if (!Number.isSafeInteger(cents)) return null;
  return negative && cents !== 0 ? -cents : cents;
}

const DATE_PATTERNS: Record<CsvDateFormat, RegExp> = {
  'DD/MM/YYYY': /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/,
  'DD/MM/YY': /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2})$/,
  'YYYY-MM-DD': /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/,
  'MM/DD/YYYY': /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/,
};

function valid(year: number, month: number, day: number): ISODate | null {
  if (year < 1900 || year > 2199 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const iso = toISODate(year, month, day);
  return isISODate(iso) ? iso : null;
}

/** Calendar date in one of the contract formats; a time after the date ("01/10/2026 14:33") is ignored. */
export function parseDate(text: string | null | undefined, format: CsvDateFormat): ISODate | null {
  if (!text) return null;
  const value = String(text).trim().split(/[\sT]/)[0] ?? '';
  const m = DATE_PATTERNS[format].exec(value);
  if (!m) return null;
  const [a, b, c] = [Number(m[1]), Number(m[2]), Number(m[3])];
  switch (format) {
    case 'DD/MM/YYYY':
      return valid(c, b, a);
    case 'DD/MM/YY':
      return valid(2000 + c, b, a);
    case 'YYYY-MM-DD':
      return valid(a, b, c);
    case 'MM/DD/YYYY':
      return valid(c, a, b);
  }
}

/**
 * Picks the date format that reads every sample. Day-first wins on ambiguity (Brazilian exports);
 * month-first only when a sample's second field is above 12.
 */
export function detectDateFormat(samples: string[]): CsvDateFormat | null {
  const values = samples.map((s) => s.trim()).filter(Boolean);
  if (values.length === 0) return null;
  const order: CsvDateFormat[] = ['YYYY-MM-DD', 'DD/MM/YYYY', 'DD/MM/YY', 'MM/DD/YYYY'];
  for (const format of order) {
    if (values.every((v) => parseDate(v, format) !== null)) return format;
  }
  return null;
}

/** OFX date-time (`20261001`, `20261001120000.000[-3:BRT]`): the calendar date as written (local to the file). */
export function parseOfxDate(text: string | null | undefined): ISODate | null {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(String(text ?? '').trim());
  return m ? valid(Number(m[1]), Number(m[2]), Number(m[3])) : null;
}
