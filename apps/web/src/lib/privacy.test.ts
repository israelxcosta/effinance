import { describe, expect, it } from 'vitest';
import { maskDocument } from './privacy';

describe('maskDocument', () => {
  it('masks CPFs in listings (formatted or digits only)', () => {
    expect(maskDocument('123.456.789-09')).toBe('***.456.789-**');
    expect(maskDocument('12345678909')).toBe('***.456.789-**');
  });

  it('keeps CNPJs (company registry) formatted', () => {
    expect(maskDocument('11222333000181')).toBe('11.222.333/0001-81');
  });

  it('never echoes unknown shapes in full', () => {
    expect(maskDocument('123456789')).toBe('*****6789');
    expect(maskDocument('123')).toBe('****');
    expect(maskDocument(null)).toBe('');
  });
});
