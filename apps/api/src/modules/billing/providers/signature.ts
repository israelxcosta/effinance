// Mercado Pago webhook signature: header `x-signature: ts=<ts>,v1=<hmac>` where hmac =
// HMAC-SHA256(secret, "id:<data.id>;request-id:<x-request-id>;ts:<ts>;") in hex. Parts whose value
// is absent are left out of the manifest.

import { timingSafeEqualStr, toHex, utf8 } from '../../../lib/crypto/encoding';

export const SIGNATURE_TOLERANCE_MS = 5 * 60_000;

export function parseSignatureHeader(header: string | undefined): { ts: string; v1: string } | null {
  if (!header) return null;
  const parts = Object.fromEntries(
    header.split(',').map((p) => {
      const [k, ...v] = p.trim().split('=');
      return [k?.trim(), v.join('=').trim()];
    }),
  );
  return parts.ts && parts.v1 ? { ts: parts.ts, v1: parts.v1 } : null;
}

export function signatureManifest(dataId: string | null, requestId: string | null, ts: string): string {
  // Alphanumeric ids are lower-cased by Mercado Pago before signing.
  const id = dataId && /^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId;
  return `${id ? `id:${id};` : ''}${requestId ? `request-id:${requestId};` : ''}ts:${ts};`;
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey('raw', utf8(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  return toHex(new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', key, utf8(message))));
}

export async function verifySignature(options: {
  header: string | undefined;
  requestId: string | null;
  dataId: string | null;
  secret: string;
  now?: number;
}): Promise<boolean> {
  const parsed = parseSignatureHeader(options.header);
  if (!parsed || !/^\d+$/.test(parsed.ts)) return false;
  const tsNumber = Number(parsed.ts);
  const tsMs = tsNumber < 1e12 ? tsNumber * 1000 : tsNumber;
  if (Math.abs((options.now ?? Date.now()) - tsMs) > SIGNATURE_TOLERANCE_MS) return false;
  const expected = await hmacSha256Hex(options.secret, signatureManifest(options.dataId, options.requestId, parsed.ts));
  return timingSafeEqualStr(expected, parsed.v1.toLowerCase());
}
