import { and, asc, eq, ilike, or } from 'drizzle-orm';
import {
  onlyDigits,
  type Contact,
  type Paginated,
  type contactInputSchema,
  type contactQuerySchema,
} from '@effinance/shared';
import type { z } from 'zod';
import type { DbExecutor } from '../../db/client';
import { contacts, type ContactRow } from '../../db/schema';
import { getCipher } from '../../lib/crypto/keyring';
import type { FieldCipher } from '../../lib/crypto/field-cipher';
import { countAll, likePattern } from '../../lib/sql';
import { getContactOrThrow } from '../common/ownership';

type ContactInput = z.output<typeof contactInputSchema>;
type ContactQuery = z.output<typeof contactQuerySchema>;

/** Personal data stored encrypted with the workspace key. Name, city and state stay searchable. */
export const CONTACT_ENCRYPTED_FIELDS = [
  'document',
  'email',
  'phone',
  'zipCode',
  'street',
  'number',
  'complement',
  'district',
  'notes',
] as const satisfies readonly (keyof ContactRow & keyof ContactInput)[];

const TABLE = 'contacts';

/** Blind index of a CPF/CNPJ (digits only) for exact search. */
export function documentIndex(cipher: FieldCipher, digits: string): Promise<string> {
  return cipher.blindIndex(`document:${digits}`);
}

export async function toContact(cipher: FieldCipher, row: ContactRow): Promise<Contact> {
  const plain = await cipher.decryptFields(TABLE, row, CONTACT_ENCRYPTED_FIELDS);
  return {
    id: plain.id,
    name: plain.name,
    document: plain.document,
    email: plain.email,
    phone: plain.phone,
    zipCode: plain.zipCode,
    street: plain.street,
    number: plain.number,
    complement: plain.complement,
    district: plain.district,
    city: plain.city,
    state: plain.state,
    notes: plain.notes,
    createdAt: plain.createdAt.toISOString(),
  };
}

/** Encrypted columns (+ document blind index) for an insert/update. */
export async function encryptContactInput(cipher: FieldCipher, input: ContactInput) {
  const encrypted = await cipher.encryptFields(TABLE, input, CONTACT_ENCRYPTED_FIELDS);
  const digits = input.document ? onlyDigits(input.document) : '';
  return { ...encrypted, documentHash: digits ? await documentIndex(cipher, digits) : null };
}

/**
 * Search: name (partial) or CPF/CNPJ (exact, through the blind index). Encrypted fields such as
 * e-mail and phone are not searchable.
 */
export async function listContacts(db: DbExecutor, workspaceId: string, q: ContactQuery): Promise<Paginated<Contact>> {
  const cipher = await getCipher(workspaceId);
  let search;
  if (q.search) {
    const digits = onlyDigits(q.search);
    search = or(
      ilike(contacts.name, likePattern(q.search)),
      digits.length === 11 || digits.length === 14
        ? eq(contacts.documentHash, await documentIndex(cipher, digits))
        : undefined,
    );
  }
  const where = and(eq(contacts.workspaceId, workspaceId), search);
  const [rows, [count]] = await Promise.all([
    db
      .select()
      .from(contacts)
      .where(where)
      .orderBy(asc(contacts.name))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    db.select({ total: countAll() }).from(contacts).where(where),
  ]);
  return {
    items: await Promise.all(rows.map((r) => toContact(cipher, r))),
    total: count?.total ?? 0,
    page: q.page,
    pageSize: q.pageSize,
  };
}

export async function getContact(db: DbExecutor, workspaceId: string, id: string) {
  return toContact(await getCipher(workspaceId), await getContactOrThrow(db, workspaceId, id));
}

export async function createContact(db: DbExecutor, workspaceId: string, input: ContactInput) {
  const cipher = await getCipher(workspaceId);
  const [row] = await db
    .insert(contacts)
    .values({ workspaceId, ...(await encryptContactInput(cipher, input)) })
    .returning();
  return toContact(cipher, row!);
}

export async function updateContact(db: DbExecutor, workspaceId: string, id: string, input: ContactInput) {
  await getContactOrThrow(db, workspaceId, id);
  const cipher = await getCipher(workspaceId);
  const [row] = await db
    .update(contacts)
    .set(await encryptContactInput(cipher, input))
    .where(eq(contacts.id, id))
    .returning();
  return toContact(cipher, row!);
}

/** Transactions keep existing without the contact (FK is ON DELETE SET NULL). */
export async function deleteContact(db: DbExecutor, workspaceId: string, id: string) {
  await getContactOrThrow(db, workspaceId, id);
  await db.delete(contacts).where(eq(contacts.id, id));
}
