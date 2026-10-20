import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  endOfYear,
  formatDateBR,
  MONTH_NAMES,
  parseISODate,
  startOfMonth,
  startOfWeek,
  startOfYear,
  todayISO,
  type ISODate,
} from '@effinance/shared';

export type PeriodMode = 'day' | 'week' | 'month' | 'year';

export interface PeriodValue {
  mode: PeriodMode;
  /** Any date inside the period. */
  anchor: ISODate;
}

export const PERIOD_MODE_LABELS: Record<PeriodMode, string> = {
  day: 'Dia',
  week: 'Semana',
  month: 'Mês',
  year: 'Ano',
};

export function periodRange(value: PeriodValue): { from: ISODate; to: ISODate } {
  const { mode, anchor } = value;
  switch (mode) {
    case 'day':
      return { from: anchor, to: anchor };
    case 'week':
      return { from: startOfWeek(anchor), to: endOfWeek(anchor) };
    case 'month':
      return { from: startOfMonth(anchor), to: endOfMonth(anchor) };
    case 'year':
      return { from: startOfYear(anchor), to: endOfYear(anchor) };
  }
}

export function shiftPeriod(value: PeriodValue, delta: number): PeriodValue {
  const { mode, anchor } = value;
  switch (mode) {
    case 'day':
      return { mode, anchor: addDays(anchor, delta) };
    case 'week':
      return { mode, anchor: addDays(anchor, delta * 7) };
    case 'month':
      return { mode, anchor: addMonths(startOfMonth(anchor), delta) };
    case 'year':
      return { mode, anchor: addMonths(startOfYear(anchor), delta * 12) };
  }
}

const WEEKDAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

export function weekdayName(date: ISODate): string {
  const { year, month, day } = parseISODate(date);
  return WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]!;
}

export function periodLabel(value: PeriodValue): string {
  const { from, to } = periodRange(value);
  const { year, month } = parseISODate(from);
  switch (value.mode) {
    case 'day': {
      const today = todayISO();
      if (from === today) return `Hoje, ${formatDateBR(from)}`;
      if (from === addDays(today, -1)) return `Ontem, ${formatDateBR(from)}`;
      if (from === addDays(today, 1)) return `Amanhã, ${formatDateBR(from)}`;
      return `${capitalize(weekdayName(from))}, ${formatDateBR(from)}`;
    }
    case 'week':
      return `${formatDateBR(from).slice(0, 5)} – ${formatDateBR(to)}`;
    case 'month':
      return `${MONTH_NAMES[month - 1]} ${year}`;
    case 'year':
      return String(year);
  }
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "Hoje", "Ontem", "Terça-feira, 20/10" — used as day headers in lists. */
export function dayHeader(date: ISODate): string {
  const today = todayISO();
  if (date === today) return `Hoje · ${formatDateBR(date)}`;
  if (date === addDays(today, -1)) return `Ontem · ${formatDateBR(date)}`;
  if (date === addDays(today, 1)) return `Amanhã · ${formatDateBR(date)}`;
  return `${capitalize(weekdayName(date))} · ${formatDateBR(date)}`;
}
