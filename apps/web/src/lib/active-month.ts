import { useEffect, useSyncExternalStore } from 'react';
import { todayISO, type ISODate } from '@effinance/shared';
import type { PeriodMode, PeriodValue } from './period';

/**
 * The month chosen on the dashboard drives every other screen (lists, statement, transfers,
 * invoices, reports). Changing a single month anywhere updates it; multi-month selections
 * (year, last N months, custom ranges) stay local to the screen/report that made them.
 * Kept per browser tab (sessionStorage), so a reload keeps it and a new tab starts today.
 */
const KEY = 'effinance.activeMonth';
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function currentMonth(): string {
  return todayISO().slice(0, 7);
}

function read(): string | null {
  try {
    const v = sessionStorage.getItem(KEY);
    return v && MONTH.test(v) ? v : null;
  } catch {
    return null;
  }
}

let active = read() ?? currentMonth();
const listeners = new Set<() => void>();

export function getActiveMonth(): string {
  return active;
}

export function setActiveMonth(month: string): void {
  if (!MONTH.test(month) || month === active) return;
  active = month;
  try {
    sessionStorage.setItem(KEY, month);
  } catch {
    // Storage blocked: the month still applies for this page load.
  }
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useActiveMonth(): [string, (month: string) => void] {
  return [useSyncExternalStore(subscribe, getActiveMonth, getActiveMonth), setActiveMonth];
}

/** Default anchor date for a screen opened on `month`: today when it is the current month, else the 1st. */
export function anchorForMonth(month: string): ISODate {
  return month === currentMonth() ? todayISO() : (`${month}-01` as ISODate);
}

export function isCurrentMonth(month: string): boolean {
  return month === currentMonth();
}

/**
 * Period of a list screen (payables, receivables, statement, transfers). The URL (`modo`,
 * `data`) wins when present; otherwise the screen opens on the active month. Day, week and
 * month changes move the active month; a year view stays local to the screen.
 */
export function useScreenPeriod(
  params: URLSearchParams,
  update: (patch: Record<string, string | null>) => void,
): { period: PeriodValue; setPeriod: (next: PeriodValue) => void } {
  const [month] = useActiveMonth();
  const mode = (params.get('modo') as PeriodMode | null) || 'month';
  const urlDate = params.get('data');
  const local = mode === 'year';

  // A date in the URL (link, back button) seeds the active month for the other screens.
  useEffect(() => {
    if (urlDate && !local) setActiveMonth(urlDate.slice(0, 7));
  }, [urlDate, local]);

  const period: PeriodValue = { mode, anchor: urlDate || anchorForMonth(month) };

  function setPeriod(next: PeriodValue) {
    // Leaving the (local) year view returns to the active month instead of January.
    const anchor = mode === 'year' && next.mode !== 'year' ? anchorForMonth(month) : next.anchor;
    if (next.mode !== 'year') setActiveMonth(anchor.slice(0, 7));
    update({
      modo: next.mode === 'month' ? null : next.mode,
      data:
        next.mode === 'year'
          ? anchor
          : next.mode === 'month' || anchor === anchorForMonth(anchor.slice(0, 7))
            ? null
            : anchor,
    });
  }

  return { period, setPeriod };
}
