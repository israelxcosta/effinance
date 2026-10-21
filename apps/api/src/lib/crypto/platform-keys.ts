// Platform-wide keys for data that has no workspace context — e.g. the Open Finance webhook index,
// keyed by the aggregator's item id. Each key is 32 random bytes wrapped by the key provider
// (`encryptSecret`: KMS in production) and stored in `platform_keys`; the first instance to need it
// creates it (concurrent creators converge on the stored one). Use from the system connection, never
// inside a tenant transaction.

import { eq } from 'drizzle-orm';
import type { DbExecutor } from '../../db/client';
import { platformKeys } from '../../db/schema';
import { fromBase64Url, randomBytes, toBase64Url, toHex, utf8 } from './encoding';
import type { KeyProvider } from './key-provider';
import { keyProvider } from './keyring';

const cache = new WeakMap<KeyProvider, Map<string, Promise<CryptoKey>>>();

async function load(db: DbExecutor, provider: KeyProvider, name: string): Promise<CryptoKey> {
  const context = `platform-key:${name}`;
  const read = async () => (await db.select({ wrapped: platformKeys.wrappedKey }).from(platformKeys).where(eq(platformKeys.name, name)))[0];
  let row = await read();
  if (!row) {
    const wrapped = await provider.encryptSecret(toBase64Url(randomBytes(32)), context);
    await db.insert(platformKeys).values({ name, wrappedKey: wrapped }).onConflictDoNothing();
    row = await read();
    if (!row) throw new Error(`platform key ${name} could not be stored`);
  }
  const raw = fromBase64Url(await provider.decryptSecret(row.wrapped, context));
  return globalThis.crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

function platformKey(db: DbExecutor, name: string): Promise<CryptoKey> {
  const provider = keyProvider();
  let keys = cache.get(provider);
  if (!keys) cache.set(provider, (keys = new Map()));
  let key = keys.get(name);
  if (!key) {
    key = load(db, provider, name);
    keys.set(name, key);
    key.catch(() => keys.delete(name));
  }
  return key;
}

/** HMAC-SHA-256 (hex) of `value` with the platform key `name`. */
export async function platformHmac(db: DbExecutor, name: string, value: string): Promise<string> {
  const mac = await globalThis.crypto.subtle.sign('HMAC', await platformKey(db, name), utf8(value));
  return toHex(new Uint8Array(mac));
}
