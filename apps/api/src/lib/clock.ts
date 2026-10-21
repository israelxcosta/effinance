import { todayISO, type ISODate } from '@effinance/shared';

/**
 * Current calendar date. `EFFINANCE_TODAY` (YYYY-MM-DD) pins it — used by tests for
 * deterministic results; never set it in production.
 */
export function today(): ISODate {
  // `process` does not exist in the browser demo; production never honors the pin.
  const vars = typeof process === 'undefined' ? undefined : process.env;
  const pinned = vars?.NODE_ENV === 'production' ? undefined : vars?.EFFINANCE_TODAY;
  return pinned && /^\d{4}-\d{2}-\d{2}$/.test(pinned) ? pinned : todayISO();
}
