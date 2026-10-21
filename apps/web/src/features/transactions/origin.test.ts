import { describe, expect, it } from 'vitest';
import type { Transaction } from '@effinance/shared';
import { originFromParam, transactionOrigin } from './origin';

describe('origin filter and badge', () => {
  it('accepts only known origins from the URL', () => {
    expect(originFromParam('file')).toBe('file');
    expect(originFromParam('open_finance')).toBe('open_finance');
    expect(originFromParam('manual')).toBe('manual');
    // `origem` values (account/card) or garbage never reach the API as `origin`.
    expect(originFromParam('account:123')).toBe('');
    expect(originFromParam('')).toBe('');
    expect(originFromParam(null)).toBe('');
  });

  it('rows without `origin` (older API) count as manual', () => {
    expect(transactionOrigin({ origin: 'open_finance' } as Transaction)).toBe('open_finance');
    expect(transactionOrigin({} as Transaction)).toBe('manual');
  });
});
