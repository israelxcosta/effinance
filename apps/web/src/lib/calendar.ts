// Pure helpers behind <DateInput>: the month grid, the dd/mm/aaaa text mask and range checks.
// Dates stay ISO strings (YYYY-MM-DD), like everywhere else in the app.
import { addDays, formatDateBR, isISODate, startOfWeek, type ISODate, type MonthKey } from '@effinance/shared';

/** Six full weeks (42 days, Sunday first) covering the month, so the grid never changes height. */
export function monthGrid(key: MonthKey): ISODate[] {
  const first = startOfWeek(`${key}-01`);
  return Array.from({ length: 42 }, (_, i) => addDays(first, i));
}

/** Progressive mask while typing: "2911" → "29/11", "29112026" → "29/11/2026". */
export function maskDateText(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

/** "29/11/2026" → "2026-11-29"; anything incomplete or impossible (31/02) → null. */
export function parseDateText(text: string): ISODate | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text.trim());
  if (!m) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  return isISODate(iso) && Number(m[3]) >= 1900 ? iso : null;
}

export function formatDateText(value: string | null | undefined): string {
  return value && isISODate(value) ? formatDateBR(value) : '';
}

export function isOutOfRange(value: ISODate, min?: string, max?: string): boolean {
  return (!!min && value < min) || (!!max && value > max);
}

/** Keeps a keyboard-moved focus inside [min, max]. */
export function clampDate(value: ISODate, min?: string, max?: string): ISODate {
  if (min && value < min) return min;
  if (max && value > max) return max;
  return value;
}

/** "29 de novembro de 2026", for screen readers. */
export function spokenDate(value: ISODate, monthNames: readonly string[]): string {
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  return `${d} de ${monthNames[m - 1]!.toLowerCase()} de ${y}`;
}
