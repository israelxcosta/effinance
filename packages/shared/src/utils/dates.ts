// Calendar-date helpers working on ISO strings (YYYY-MM-DD) with no timezone drift.
// All arithmetic is done in UTC so a date never shifts by a day.

import type { Frequency, Granularity } from '../constants';

export type ISODate = string;

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const MONTH_NAMES = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
] as const;

export const MONTH_SHORT = [
  'Jan',
  'Fev',
  'Mar',
  'Abr',
  'Mai',
  'Jun',
  'Jul',
  'Ago',
  'Set',
  'Out',
  'Nov',
  'Dez',
] as const;

/** Weeks start on Sunday (pt-BR calendar convention, same as date-fns ptBR). */
export const WEEK_STARTS_ON = 0;

export function isISODate(value: string): boolean {
  const m = ISO_RE.exec(value);
  if (!m) return false;
  const [, y, mo, d] = m;
  const month = Number(mo);
  const day = Number(d);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(Number(y), month);
}

export function parseISODate(value: ISODate): { year: number; month: number; day: number } {
  const m = ISO_RE.exec(value);
  if (!m) throw new Error(`Invalid ISO date: ${value}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

export function toISODate(year: number, month: number, day: number): ISODate {
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.toISOString().slice(0, 10);
}

function toUTC(value: ISODate): Date {
  const { year, month, day } = parseISODate(value);
  return new Date(Date.UTC(year, month - 1, day));
}

function fromUTC(date: Date): ISODate {
  return date.toISOString().slice(0, 10);
}

/** Today in the runtime's local timezone. */
export function todayISO(now: Date = new Date()): ISODate {
  return toISODate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function addDays(value: ISODate, days: number): ISODate {
  const d = toUTC(value);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUTC(d);
}

/**
 * Adds months keeping the day-of-month anchored (clamped to the month length).
 * `anchorDay` lets a series keep "day 31" across short months (Jan 31 → Feb 28 → Mar 31).
 */
export function addMonths(value: ISODate, months: number, anchorDay?: number): ISODate {
  const { year, month, day } = parseISODate(value);
  const total = year * 12 + (month - 1) + months;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  const target = anchorDay ?? day;
  return toISODate(y, m, Math.min(target, daysInMonth(y, m)));
}

export function diffInDays(a: ISODate, b: ISODate): number {
  return Math.round((toUTC(a).getTime() - toUTC(b).getTime()) / 86_400_000);
}

export function compareISO(a: ISODate, b: ISODate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function minISO(a: ISODate, b: ISODate): ISODate {
  return a <= b ? a : b;
}

export function maxISO(a: ISODate, b: ISODate): ISODate {
  return a >= b ? a : b;
}

export function dayOfWeek(value: ISODate): number {
  return toUTC(value).getUTCDay();
}

export function startOfWeek(value: ISODate): ISODate {
  const dow = dayOfWeek(value);
  return addDays(value, -((dow - WEEK_STARTS_ON + 7) % 7));
}

export function endOfWeek(value: ISODate): ISODate {
  return addDays(startOfWeek(value), 6);
}

export function startOfMonth(value: ISODate): ISODate {
  const { year, month } = parseISODate(value);
  return toISODate(year, month, 1);
}

export function endOfMonth(value: ISODate): ISODate {
  const { year, month } = parseISODate(value);
  return toISODate(year, month, daysInMonth(year, month));
}

export function startOfYear(value: ISODate): ISODate {
  return `${value.slice(0, 4)}-01-01`;
}

export function endOfYear(value: ISODate): ISODate {
  return `${value.slice(0, 4)}-12-31`;
}

/** 'YYYY-MM' */
export type MonthKey = string;

export function monthKey(value: ISODate): MonthKey {
  return value.slice(0, 7);
}

export function monthRange(key: MonthKey): { from: ISODate; to: ISODate } {
  const from = `${key}-01`;
  return { from, to: endOfMonth(from) };
}

export function addMonthKey(key: MonthKey, months: number): MonthKey {
  return monthKey(addMonths(`${key}-01`, months));
}

export function formatMonthKey(key: MonthKey, style: 'long' | 'short' = 'long'): string {
  const { year, month } = parseISODate(`${key}-01`);
  const names = style === 'long' ? MONTH_NAMES : MONTH_SHORT;
  return style === 'long' ? `${names[month - 1]} de ${year}` : `${names[month - 1]}/${String(year).slice(2)}`;
}

/** dd/MM/yyyy */
export function formatDateBR(value: ISODate | null | undefined): string {
  if (!value) return '';
  const { year, month, day } = parseISODate(value);
  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
}

/** Date of the n-th (0-based) occurrence of a series starting at `start`. */
export function occurrenceDate(start: ISODate, frequency: Frequency, index: number): ISODate {
  const anchor = parseISODate(start).day;
  switch (frequency) {
    case 'weekly':
      return addDays(start, index * 7);
    case 'monthly':
      return addMonths(start, index, anchor);
    case 'semiannual':
      return addMonths(start, index * 6, anchor);
    case 'annual':
      return addMonths(start, index * 12, anchor);
  }
}

export interface Period {
  /** Stable key: day 'YYYY-MM-DD', week = start date 'YYYY-MM-DD', month 'YYYY-MM', year 'YYYY'. */
  key: string;
  start: ISODate;
  end: ISODate;
  label: string;
}

export function periodStart(value: ISODate, granularity: Granularity): ISODate {
  switch (granularity) {
    case 'day':
      return value;
    case 'week':
      return startOfWeek(value);
    case 'month':
      return startOfMonth(value);
    case 'year':
      return startOfYear(value);
  }
}

export function periodKey(value: ISODate, granularity: Granularity): string {
  switch (granularity) {
    case 'day':
      return value;
    case 'week':
      return startOfWeek(value);
    case 'month':
      return monthKey(value);
    case 'year':
      return value.slice(0, 4);
  }
}

function periodEnd(start: ISODate, granularity: Granularity): ISODate {
  switch (granularity) {
    case 'day':
      return start;
    case 'week':
      return addDays(start, 6);
    case 'month':
      return endOfMonth(start);
    case 'year':
      return endOfYear(start);
  }
}

function periodLabel(start: ISODate, granularity: Granularity): string {
  const { year, month, day } = parseISODate(start);
  const dd = String(day).padStart(2, '0');
  const mm = String(month).padStart(2, '0');
  switch (granularity) {
    case 'day':
      return `${dd}/${mm}`;
    case 'week':
      return `Sem ${dd}/${mm}`;
    case 'month':
      return `${MONTH_SHORT[month - 1]}/${String(year).slice(2)}`;
    case 'year':
      return String(year);
  }
}

/** Every period touching [from, to]. Capped to avoid runaway loops. */
export function enumeratePeriods(
  from: ISODate,
  to: ISODate,
  granularity: Granularity,
  max = 400,
): Period[] {
  const periods: Period[] = [];
  let start = periodStart(from, granularity);
  while (start <= to && periods.length < max) {
    const end = periodEnd(start, granularity);
    periods.push({
      key: periodKey(start, granularity),
      start,
      end,
      label: periodLabel(start, granularity),
    });
    start = addDays(end, 1);
  }
  return periods;
}
