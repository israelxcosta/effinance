// Money is always an integer amount of cents. Formatting happens only at the edges.

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const decimal = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 123456 → "R$ 1.234,56" (uses a regular space instead of NBSP for predictable rendering). */
export function formatBRL(cents: number): string {
  return brl.format(cents / 100).replace(/ /g, ' ');
}

/** 123456 → "1.234,56" */
export function formatDecimal(cents: number): string {
  return decimal.format(cents / 100);
}

/** Compact axis label: 1234567 → "R$ 12,3 mil" */
export function formatCompactBRL(cents: number): string {
  const value = cents / 100;
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}R$ ${(abs / 1_000_000).toFixed(1).replace('.', ',')} mi`;
  if (abs >= 1_000) return `${sign}R$ ${(abs / 1_000).toFixed(1).replace('.', ',')} mil`;
  return `${sign}R$ ${abs.toFixed(0)}`;
}

/** Parses "1.234,56", "1234.56", "R$ 10" → cents. Returns null when not a number. */
export function parseMoney(input: string): number | null {
  const cleaned = input.replace(/[^\d,.-]/g, '');
  if (!cleaned) return null;
  const normalized =
    cleaned.includes(',') ? cleaned.replace(/\./g, '').replace(',', '.') : cleaned;
  const value = Number(normalized);
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}

/**
 * Splits a total into `count` installments. The remainder cents go to the first installment so the
 * sum always matches the total exactly (e.g. 100,00 / 3 → 33,34 + 33,33 + 33,33).
 */
export function splitInstallments(total: number, count: number): number[] {
  if (count < 1) throw new Error('count must be >= 1');
  const base = Math.floor(total / count);
  const remainder = total - base * count;
  return Array.from({ length: count }, (_, i) => (i === 0 ? base + remainder : base));
}

/** Percent change from `previous` to `current` (0.25 = +25%). null when there is no base. */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return (current - previous) / Math.abs(previous);
}

export function formatPercent(ratio: number | null | undefined, digits = 1): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return '—';
  return `${(ratio * 100).toFixed(digits).replace('.', ',')}%`;
}
