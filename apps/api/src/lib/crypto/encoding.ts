// Byte helpers on WebCrypto / plain JS (no node:crypto, no Buffer): the same code runs in the
// browser demo.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type Bytes = Uint8Array<ArrayBuffer>;

export function utf8(value: string): Bytes {
  return encoder.encode(value) as Bytes;
}

export function fromUtf8(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

export function randomBytes(length: number): Bytes {
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(value: string): Bytes {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

export function fromBase64(value: string): Bytes {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

export async function sha256Hex(value: string): Promise<string> {
  return toHex(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', utf8(value))));
}

/** Opaque random token (256 bits), safe for URLs and cookies. */
export function randomToken(bytes = 32): string {
  return toBase64Url(randomBytes(bytes));
}

/** Constant-time comparison of two strings of equal length. */
export function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
