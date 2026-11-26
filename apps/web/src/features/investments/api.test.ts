import { describe, expect, it } from 'vitest';
import { formatQuantity, parseQuantity } from './api';

describe('quantity input', () => {
  it('reads pt-BR and plain decimals', () => {
    expect(parseQuantity('100')).toBe(100);
    expect(parseQuantity('1.500')).toBe(1500); // Brazilian thousands separator
    expect(parseQuantity('1.5')).toBe(1.5);
    expect(parseQuantity('12.000.000')).toBe(12000000);
    expect(parseQuantity('1.500,25')).toBe(1500.25);
    expect(parseQuantity('0,015')).toBe(0.015);
    expect(parseQuantity('0.015')).toBe(0.015);
    expect(parseQuantity('')).toBeNaN();
    expect(parseQuantity('abc')).toBeNaN();
    expect(parseQuantity('1,2,3')).toBeNaN();
  });

  it('formats like Brazilian numbers', () => {
    expect(formatQuantity(1500)).toBe('1.500');
    expect(formatQuantity(0.015)).toBe('0,015');
  });
});
