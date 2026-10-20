import type { Frequency } from '../constants';
import { occurrenceDate, type ISODate } from './dates';

/** Dates of the first `count` occurrences of a series. */
export function buildOccurrenceDates(start: ISODate, frequency: Frequency, count: number): ISODate[] {
  return Array.from({ length: count }, (_, i) => occurrenceDate(start, frequency, i));
}

/** Dates of the occurrences with index in [fromIndex, ...) that fall on or before `until`. */
export function occurrenceDatesUntil(
  start: ISODate,
  frequency: Frequency,
  fromIndex: number,
  until: ISODate,
  maxIndex = Number.POSITIVE_INFINITY,
  hardLimit = 1000,
): { index: number; date: ISODate }[] {
  const out: { index: number; date: ISODate }[] = [];
  for (let i = fromIndex; i < maxIndex && out.length < hardLimit; i++) {
    const date = occurrenceDate(start, frequency, i);
    if (date > until) break;
    out.push({ index: i, date });
  }
  return out;
}
