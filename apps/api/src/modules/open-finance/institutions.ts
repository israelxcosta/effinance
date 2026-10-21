// Maps institution data from the aggregator to the catalogs of the shared contract.

import { getBank, type BankCode, type CardBrand } from '@effinance/shared';

const PATTERNS: [RegExp, BankCode][] = [
  [/\bnu ?bank\b|\bnu pagamentos\b|\bnubank\b/, 'nubank'],
  [/\bitau\b/, 'itau'],
  [/\bbradesco\b/, 'bradesco'],
  [/\bbanco do brasil\b|^bb\b/, 'bb'],
  [/\bcaixa\b/, 'caixa'],
  [/\bsantander\b/, 'santander'],
  [/\binter\b/, 'inter'],
  [/\bc6\b/, 'c6'],
  [/\bbtg\b/, 'btg'],
  [/\bxp\b/, 'xp'],
  [/\bsicoob\b/, 'sicoob'],
  [/\bsicredi\b/, 'sicredi'],
  [/\bpicpay\b/, 'picpay'],
  [/\bmercado ?pago\b/, 'mercadopago'],
  [/\bpag ?bank\b|\bpagseguro\b/, 'pagbank'],
  [/\bneon\b/, 'neon'],
  [/\bsafra\b/, 'safra'],
  [/\bbanrisul\b/, 'banrisul'],
  [/\boriginal\b/, 'original'],
  [/\bnext\b/, 'next'],
  [/\bwill ?bank\b/, 'will'],
  [/\bstone\b/, 'stone'],
];

/** Bank of the catalog (BANKS) for an institution name, when recognizable. */
export function bankFromInstitution(name: string): BankCode | null {
  const n = name
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return PATTERNS.find(([re]) => re.test(n))?.[1] ?? null;
}

export function bankColor(bank: BankCode | null): string {
  return (bank && bank !== 'other' ? getBank(bank)?.color : null) ?? '#152B61';
}

export function cardBrandOf(raw: string | null | undefined): CardBrand | null {
  if (!raw) return null;
  const b = raw.toUpperCase();
  if (b.includes('MASTER')) return 'mastercard';
  if (b.includes('VISA')) return 'visa';
  if (b.includes('ELO')) return 'elo';
  if (b.includes('AMEX') || b.includes('AMERICAN')) return 'amex';
  if (b.includes('HIPER')) return 'hipercard';
  if (b.includes('DINERS')) return 'diners';
  return 'other';
}
