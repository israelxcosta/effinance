import { describe, expect, it } from 'vitest';
import { evolutionRange, monthSpan } from './evolution-range';

describe('evolution periods', () => {
  it('past, around and future presets', () => {
    expect(evolutionRange('past12', '2026-11')).toEqual({ from: '2025-12', to: '2026-11', months: 12 });
    expect(evolutionRange('around6', '2026-11')).toEqual({ from: '2026-05', to: '2027-05', months: 13 });
    expect(evolutionRange('next6', '2026-11')).toEqual({ from: '2026-11', to: '2027-04', months: 6 });
    expect(evolutionRange('next12', '2026-11')).toEqual({ from: '2026-11', to: '2027-10', months: 12 });
  });

  it('custom ranges: ordered, inclusive and capped at 36 months (keeping the end)', () => {
    expect(evolutionRange('custom', '2026-11', { from: '2027-03', to: '2026-12' })).toEqual({ from: '2026-12', to: '2027-03', months: 4 });
    expect(evolutionRange('custom', '2026-11', { from: '2020-01', to: '2026-12' })).toEqual({ from: '2024-01', to: '2026-12', months: 36 });
    expect(monthSpan('2026-11', '2026-11')).toBe(1);
    expect(monthSpan('2026-11', '2027-02')).toBe(4);
  });
});
