// Transaction notes are encrypted with the workspace key. Series templates store the same
// ciphertext (same AAD), so materialized occurrences copy it without re-encrypting.

import { getCipher } from '../../lib/crypto/keyring';

const TABLE = 'transactions';
const COLUMN = 'notes';

/** `undefined` (field not sent) passes through untouched. */
export async function encryptNotes<T extends string | null | undefined>(workspaceId: string, notes: T): Promise<T> {
  if (notes === undefined || notes === null) return notes;
  return (await (await getCipher(workspaceId)).encrypt(TABLE, COLUMN, notes)) as T;
}

export async function decryptNotes(workspaceId: string, notes: string | null): Promise<string | null> {
  if (notes === null) return null;
  return (await getCipher(workspaceId)).decrypt(TABLE, COLUMN, notes);
}
