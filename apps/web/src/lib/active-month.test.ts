import { describe, expect, it } from 'vitest';
import { periodLabel, periodRange } from './period';
import { parsePeriodParams } from './active-month';

describe('period from the URL (`modo`, `data`)', () => {
  it('keeps the known modes and real dates', () => {
    expect(parsePeriodParams(new URLSearchParams('modo=week&data=2026-11-26'))).toEqual({ mode: 'week', date: '2026-11-26' });
    expect(parsePeriodParams(new URLSearchParams('modo=year&data=2026-01-01'))).toEqual({ mode: 'year', date: '2026-01-01' });
    expect(parsePeriodParams(new URLSearchParams(''))).toEqual({ mode: 'month', date: null });
  });

  // A crafted link (`/contas-a-pagar?modo=x`) used to crash the screen (periodRange → undefined)
  // and show the router's default error page with the stack trace.
  it('falls back to the month view for unknown modes and invalid dates', () => {
    for (const query of ['modo=x', 'modo=__proto__', 'modo=constructor', 'data=lixo', 'data=2026-02-31', 'modo=day&data=<img>']) {
      const { mode, date } = parsePeriodParams(new URLSearchParams(query));
      expect(['day', 'week', 'month', 'year']).toContain(mode);
      expect(date === null || /^\d{4}-\d{2}-\d{2}$/.test(date)).toBe(true);
      const period = { mode, anchor: date ?? '2026-11-01' };
      expect(() => periodLabel(period)).not.toThrow();
      expect(periodRange(period).from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
