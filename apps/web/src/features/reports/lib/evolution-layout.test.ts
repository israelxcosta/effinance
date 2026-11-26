import { describe, expect, it } from 'vitest';
import { evolutionLayout } from './evolution-layout';

describe('evolutionLayout', () => {
  it('shows every period with cents on a wide screen', () => {
    expect(evolutionLayout(1400, 12)).toEqual({ categoryWidth: 190, showAverage: true, cents: true, visible: 12 });
  });

  it('drops the cents before dropping periods', () => {
    expect(evolutionLayout(1200, 12)).toMatchObject({ cents: false, visible: 12 });
  });

  it('keeps only the most recent periods that fit when even that is too tight', () => {
    const l = evolutionLayout(900, 12);
    expect(l.visible).toBeLessThan(12);
    expect(l.categoryWidth + 96 + 104 + l.visible * 62).toBeLessThanOrEqual(900);
  });

  it('phones: no average column, a couple of periods, never zero', () => {
    const l = evolutionLayout(340, 12);
    expect(l).toMatchObject({ showAverage: false, cents: false });
    expect(l.visible).toBeGreaterThanOrEqual(1);
    expect(evolutionLayout(100, 12).visible).toBe(1);
  });

  it('few periods (yearly) always fit with cents', () => {
    expect(evolutionLayout(900, 2)).toMatchObject({ cents: true, visible: 2 });
  });
});
