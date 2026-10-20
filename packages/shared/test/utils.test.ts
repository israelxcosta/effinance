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
