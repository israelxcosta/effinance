// RFC 6238 TOTP (HMAC-SHA-1, 6 digits, 30 s steps) on WebCrypto, plus RFC 4648 base32.

import { randomBytes, timingSafeEqualStr, type Bytes } from './crypto/encoding';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_PERIOD = 30;
const DIGITS = 6;

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Bytes {
  const clean = input.toUpperCase().replace(/[\s=]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const idx = ALPHABET.indexOf(char);
    if (idx < 0) throw new Error('Segredo base32 inválido');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

/** New 160-bit secret, base32 encoded. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpStep(timeMs: number = Date.now()): number {
  return Math.floor(timeMs / 1000 / TOTP_PERIOD);
}

export async function totpCode(secretBase32: string, step: number): Promise<string> {
  const counter = new Uint8Array(8);
  let n = step;
  for (let i = 7; i >= 0; i--) {
    counter[i] = n & 0xff;
    n = Math.floor(n / 256);
  }
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    base32Decode(secretBase32),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const mac = new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', key, counter));
  const offset = mac[mac.length - 1]! & 0x0f;
  const binary =
    ((mac[offset]! & 0x7f) << 24) | (mac[offset + 1]! << 16) | (mac[offset + 2]! << 8) | mac[offset + 3]!;
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

/**
 * Checks a code against the current step ±1 (clock drift). Returns the matching step, or null.
 * Steps not greater than `lastStep` are rejected, so an observed code cannot be replayed.
 */
export async function verifyTotp(
  secretBase32: string,
  code: string,
  options: { now?: number; lastStep?: number | null } = {},
): Promise<number | null> {
  if (!/^\d{6}$/.test(code)) return null;
  const current = totpStep(options.now);
  for (const step of [current - 1, current, current + 1]) {
    if (options.lastStep !== null && options.lastStep !== undefined && step <= options.lastStep) continue;
    if (timingSafeEqualStr(await totpCode(secretBase32, step), code)) return step;
  }
  return null;
}

export function otpauthUrl(secretBase32: string, account: string, issuer = 'Effinance'): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({ secret: secretBase32, issuer, algorithm: 'SHA1', digits: '6', period: '30' });
  return `otpauth://totp/${label}?${params.toString()}`;
}
