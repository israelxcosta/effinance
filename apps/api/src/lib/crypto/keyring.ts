// Resolves the FieldCipher of a workspace: loads its wrapped data key with the system connection
// (outside tenant transactions, which cannot read `workspaces`), unwraps it with the KeyProvider
// and keeps it in memory for a short time. Configured once at startup (API, migrations, demo).

import { eq } from 'drizzle-orm';
import type { DbExecutor } from '../../db/client';
import { workspaces } from '../../db/schema';
import { NotFoundError } from '../errors';
import { FieldCipher } from './field-cipher';
import type { KeyProvider } from './key-provider';

interface KeyringConfig {
  provider: KeyProvider;
  /** System connection (not tenant-scoped). */
  db: DbExecutor;
  ttlMs?: number;
}

const MAX_ENTRIES = 1000;
let config: KeyringConfig | null = null;
const cache = new Map<string, { cipher: Promise<FieldCipher>; expires: number }>();

export function configureKeyring(next: KeyringConfig): void {
  config = next;
  cache.clear();
}

function current(): KeyringConfig {
  if (!config) throw new Error('Keyring not configured (call configureKeyring at startup)');
  return config;
}

export function keyProvider(): KeyProvider {
  return current().provider;
}

function remember(workspaceId: string, cipher: Promise<FieldCipher>) {
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  cache.set(workspaceId, { cipher, expires: Date.now() + (current().ttlMs ?? 5 * 60_000) });
  // A failed load must not stay cached.
  cipher.catch(() => cache.delete(workspaceId));
}

async function load(workspaceId: string): Promise<FieldCipher> {
  const { db, provider } = current();
  const [row] = await db
    .select({ wrappedKey: workspaces.wrappedKey, keyId: workspaces.keyId })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));
  if (!row) throw new NotFoundError('Espaço não encontrado');
  if (row.wrappedKey && row.keyId) {
    return FieldCipher.create(workspaceId, await provider.decryptDataKey(workspaceId, row.wrappedKey, row.keyId));
  }
  // Workspaces migrated from the single-user schema get their key on first use.
  const key = await provider.generateDataKey(workspaceId);
  await db.update(workspaces).set({ wrappedKey: key.wrapped, keyId: key.keyId }).where(eq(workspaces.id, workspaceId));
  return FieldCipher.create(workspaceId, key.plaintext);
}

export function getCipher(workspaceId: string): Promise<FieldCipher> {
  const hit = cache.get(workspaceId);
  if (hit && hit.expires > Date.now()) return hit.cipher;
  const cipher = load(workspaceId);
  remember(workspaceId, cipher);
  return cipher;
}

/**
 * Generates the data key of a new workspace. Returns the columns to store with the workspace row
 * and primes the cache, so the key works inside the transaction that creates the workspace.
 */
export async function newWorkspaceKey(workspaceId: string): Promise<{ wrappedKey: string; keyId: string }> {
  const key = await current().provider.generateDataKey(workspaceId);
  remember(workspaceId, FieldCipher.create(workspaceId, key.plaintext));
  return { wrappedKey: key.wrapped, keyId: key.keyId };
}

/** Drops a destroyed workspace key from memory (crypto-shredding). */
export function forgetWorkspaceKey(workspaceId: string): void {
  cache.delete(workspaceId);
}
