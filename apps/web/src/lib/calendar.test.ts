import { describe, expect, it } from 'vitest';
import { MONTH_NAMES } from '@effinance/shared';
import { clampDate, formatDateText, isOutOfRange, maskDateText, monthGrid, parseDateText, spokenDate } from './calendar';

describe('monthGrid', () => {
  it('always has six weeks starting on Sunday', () => {
    const nov = monthGrid('2026-11'); // 1/11/2026 is a Sunday
    expect(nov).toHaveLength(42);
    expect(nov[0]).toBe('2026-11-01');
    expect(nov[41]).toBe('2026-12-12');
    const oct = monthGrid('2026-10'); // 1/10/2026 is a Thursday
    expect(oct[0]).toBe('2026-09-27');
    expect(oct[4]).toBe('2026-10-01');
  });

  it('handles leap years', () => {
    expect(monthGrid('2028-02')).toContain('2028-02-29');
  });
});

describe('date text', () => {
  it('masks digits progressively as dd/mm/aaaa', () => {
    expect(maskDateText('2')).toBe('2');
    expect(maskDateText('291')).toBe('29/1');
    expect(maskDateText('2911')).toBe('29/11');
    expect(maskDateText('29/11/20269')).toBe('29/11/2026');
    expect(maskDateText('ab29c11')).toBe('29/11');
  });

  it('parses only complete, real dates', () => {
    expect(parseDateText('29/11/2026')).toBe('2026-11-29');
    expect(parseDateText('29/02/2027')).toBeNull();
    expect(parseDateText('29/02/2028')).toBe('2028-02-29');
    expect(parseDateText('29/11/202')).toBeNull();
    expect(parseDateText('00/11/2026')).toBeNull();
    expect(parseDateText('01/01/0026')).toBeNull();
  });

  it('formats ISO values and ignores junk', () => {
    expect(formatDateText('2026-11-05')).toBe('05/11/2026');
    expect(formatDateText('')).toBe('');
    expect(formatDateText('2026-13-01')).toBe('');
    expect(formatDateText(null)).toBe('');
  });
});

describe('range', () => {
  it('checks and clamps against min/max', () => {
    expect(isOutOfRange('2026-01-01', '2026-02-01')).toBe(true);
    expect(isOutOfRange('2026-03-01', undefined, '2026-02-01')).toBe(true);
    expect(isOutOfRange('2026-02-01', '2026-02-01', '2026-02-01')).toBe(false);
    expect(clampDate('2026-01-01', '2026-02-01')).toBe('2026-02-01');
    expect(clampDate('2026-05-01', undefined, '2026-02-01')).toBe('2026-02-01');
  });

  it('spells the date for screen readers', () => {
    expect(spokenDate('2026-11-29', MONTH_NAMES)).toBe('29 de novembro de 2026');
  });
});
