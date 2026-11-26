import { describe, expect, it } from 'vitest';
import {
  addMonths,
  enumeratePeriods,
  getInvoiceForPurchase,
  isValidCPF,
  occurrenceDate,
  splitInstallments,
  startOfWeek,
  formatBRL,
  parseMoney,
  transactionInputSchema,
  buildPositions,
  investmentPurchaseInputSchema,
  positionAfterPurchase,
  purchaseTotal,
} from '../src';

describe('dates', () => {
  it('keeps the anchor day across short months', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(occurrenceDate('2026-01-31', 'monthly', 2)).toBe('2026-03-31');
    expect(occurrenceDate('2024-02-29', 'annual', 1)).toBe('2025-02-28');
    expect(occurrenceDate('2026-01-10', 'semiannual', 1)).toBe('2026-07-10');
    expect(occurrenceDate('2026-01-10', 'weekly', 3)).toBe('2026-01-31');
  });

  it('starts weeks on Sunday', () => {
    expect(startOfWeek('2026-10-20')).toBe('2026-10-18');
  });

  it('enumerates periods', () => {
    const months = enumeratePeriods('2026-01-15', '2026-03-02', 'month');
    expect(months.map((p) => p.key)).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(months[1]).toMatchObject({ start: '2026-02-01', end: '2026-02-28', label: 'Fev/26' });
  });
});

describe('money', () => {
  it('splits installments keeping the total', () => {
    expect(splitInstallments(10000, 3)).toEqual([3334, 3333, 3333]);
    expect(splitInstallments(10000, 3).reduce((a, b) => a + b, 0)).toBe(10000);
  });

  it('formats and parses BRL', () => {
    expect(formatBRL(123456)).toBe('R$ 1.234,56');
    expect(parseMoney('1.234,56')).toBe(123456);
    expect(parseMoney('R$ 10')).toBe(1000);
  });
});

describe('invoice', () => {
  it('assigns purchases to the right invoice (closing 5, due 12)', () => {
    expect(getInvoiceForPurchase('2026-10-04', 5, 12)).toEqual({
      month: '2026-10',
      closingDate: '2026-10-05',
      dueDate: '2026-10-12',
    });
    // on the closing day → next invoice
    expect(getInvoiceForPurchase('2026-10-05', 5, 12).month).toBe('2026-11');
  });

  it('handles due day before closing day (closing 28, due 5)', () => {
    expect(getInvoiceForPurchase('2026-10-27', 28, 5)).toEqual({
      month: '2026-11',
      closingDate: '2026-10-28',
      dueDate: '2026-11-05',
    });
    expect(getInvoiceForPurchase('2026-10-28', 28, 5).month).toBe('2026-12');
  });

  it('clamps closing day 31 in short months', () => {
    expect(getInvoiceForPurchase('2026-02-27', 31, 10)).toMatchObject({
      month: '2026-03',
      closingDate: '2026-02-28',
    });
  });
});

describe('documents', () => {
  it('validates CPF', () => {
    expect(isValidCPF('529.982.247-25')).toBe(true);
    expect(isValidCPF('111.111.111-11')).toBe(false);
    expect(isValidCPF('529.982.247-24')).toBe(false);
  });
});

describe('schemas', () => {
  it('rejects card on income and requires installments', () => {
    const base = { description: 'x', amount: 100, date: '2026-10-20' };
    expect(
      transactionInputSchema.safeParse({ ...base, type: 'income', creditCardId: '0198f1d2-7a3b-7c4d-8e5f-0a1b2c3d4e5f' }).success,
    ).toBe(false);
    expect(transactionInputSchema.safeParse({ ...base, type: 'expense', recurrenceKind: 'installment' }).success).toBe(false);
    const ok = transactionInputSchema.parse({ ...base, type: 'expense' });
    expect(ok).toMatchObject({ paid: false, recurrenceKind: 'single', frequency: 'monthly', accountId: null });
  });
});

describe('portfolio (average price)', () => {
  const p = (ticker: string, date: string, quantity: number, unitPrice: number, fees = 0) => ({
    ticker,
    name: null,
    assetType: 'stock' as const,
    date,
    quantity,
    unitPrice,
    fees,
  });

  it('computes the average price across purchases, fees included', () => {
    // 100 × 15,00 + 4,90 fees, then 50 × 18,00 → 150 shares for 2.404,90
    const [pos] = buildPositions([p('PETR4', '2026-11-26', 100, 1500, 490), p('PETR4', '2026-12-03', 50, 1800)]);
    expect(pos).toMatchObject({ ticker: 'PETR4', quantity: 150, totalInvested: 240490, averagePrice: 1603, purchases: 2 });
    expect(pos!.firstDate).toBe('2026-11-26');
    expect(pos!.lastDate).toBe('2026-12-03');
  });

  it('groups by ticker, biggest first, with shares of the total', () => {
    const list = buildPositions([p('HGLG11', '2026-10-01', 10, 16000), p('PETR4', '2026-10-02', 100, 1500), p('HGLG11', '2026-10-05', 5, 15500)]);
    expect(list.map((x) => [x.ticker, x.quantity, x.totalInvested])).toEqual([
      ['HGLG11', 15, 237500],
      ['PETR4', 100, 150000],
    ]);
    expect(list[0]!.share + list[1]!.share).toBeCloseTo(1);
  });

  it('handles fractional quantities without float noise', () => {
    const [btc] = buildPositions([p('BTC', '2026-01-01', 0.1, 50000000), p('BTC', '2026-02-01', 0.2, 60000000)]);
    expect(btc!.quantity).toBe(0.3);
    expect(btc!.totalInvested).toBe(5000000 + 12000000);
    expect(btc!.averagePrice).toBe(56666667);
    expect(purchaseTotal(3, 1999, 10)).toBe(6007);
  });

  it('previews the position after buying more', () => {
    expect(positionAfterPurchase({ quantity: 100, totalInvested: 150000 }, 100, 1700)).toEqual({ quantity: 200, totalInvested: 320000, averagePrice: 1600 });
    expect(positionAfterPurchase(null, 10, 1000, 100)).toEqual({ quantity: 10, totalInvested: 10100, averagePrice: 1010 });
  });

  it('validates purchases: ticker upper case, positive quantity, up to 8 decimals', () => {
    const ok = investmentPurchaseInputSchema.parse({ assetType: 'stock', ticker: ' petr4 ', date: '2026-11-26', quantity: 100, unitPrice: 1500 });
    expect(ok).toMatchObject({ ticker: 'PETR4', fees: 0, accountId: null, name: null });
    expect(investmentPurchaseInputSchema.safeParse({ assetType: 'stock', ticker: 'X', date: '2026-11-26', quantity: 0, unitPrice: 1 }).success).toBe(false);
    expect(investmentPurchaseInputSchema.safeParse({ assetType: 'crypto', ticker: 'BTC', date: '2026-11-26', quantity: 0.123456789, unitPrice: 1 }).success).toBe(false);
    expect(investmentPurchaseInputSchema.safeParse({ assetType: 'crypto', ticker: 'BTC', date: '2026-11-26', quantity: 0.12345678, unitPrice: 1 }).success).toBe(true);
  });
});
