import { formatDocument } from '@effinance/shared';

/**
 * Masks a CPF for listings (LGPD data minimization): `***.456.789-**`, the pattern used by the
 * Brazilian government portals. The full number stays available in the edit form. CNPJs identify
 * companies (public registry), so they are only formatted.
 */
export function maskDocument(value: string | null | undefined): string {
  if (!value) return '';
  const digits = value.replace(/\D/g, '');
  if (digits.length === 11) return `***.${digits.slice(3, 6)}.${digits.slice(6, 9)}-**`;
  if (digits.length === 14) return formatDocument(digits);
  // Unknown shape: never echo it in full.
  return digits.length > 4 ? `${'*'.repeat(digits.length - 4)}${digits.slice(-4)}` : '****';
}
