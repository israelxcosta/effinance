import { and, asc, eq, ilike, or } from 'drizzle-orm';
import {
  onlyDigits,
  type Contact,
  type Paginated,
  type contactInputSchema,
  type contactQuerySchema,
} from '@effinance/shared';
import type { z } from 'zod';
import type { Database } from '../../db/client';
import { contacts, type ContactRow } from '../../db/schema';
import { countAll, likePattern } from '../../lib/sql';
import { getContactOrThrow } from '../common/ownership';

type ContactInput = z.output<typeof contactInputSchema>;
type ContactQuery = z.output<typeof contactQuerySchema>;

export function toContact(row: ContactRow): Contact {
  return {
    id: row.id,
    name: row.name,
    document: row.document,
    email: row.email,
    phone: row.phone,
    zipCode: row.zipCode,
    street: row.street,
    number: row.number,
    complement: row.complement,
    district: row.district,
    city: row.city,
    state: row.state,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listContacts(db: Database, userId: string, q: ContactQuery): Promise<Paginated<Contact>> {
  let search;
  if (q.search) {
    const pattern = likePattern(q.search);
    const digits = onlyDigits(q.search);
    search = or(
      ilike(contacts.name, pattern),
      ilike(contacts.email, pattern),
      digits ? ilike(contacts.document, likePattern(digits)) : undefined,
      digits ? ilike(contacts.phone, likePattern(digits)) : undefined,
    );
  }
  const where = and(eq(contacts.userId, userId), search);
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
  return { items: rows.map(toContact), total: count?.total ?? 0, page: q.page, pageSize: q.pageSize };
}

export async function getContact(db: Database, userId: string, id: string) {
  return toContact(await getContactOrThrow(db, userId, id));
}

export async function createContact(db: Database, userId: string, input: ContactInput) {
  const [row] = await db.insert(contacts).values({ userId, ...input }).returning();
  return toContact(row!);
}

export async function updateContact(db: Database, userId: string, id: string, input: ContactInput) {
  await getContactOrThrow(db, userId, id);
  const [row] = await db.update(contacts).set(input).where(eq(contacts.id, id)).returning();
  return toContact(row!);
}

/** Transactions keep existing without the contact (FK is ON DELETE SET NULL). */
export async function deleteContact(db: Database, userId: string, id: string) {
  await getContactOrThrow(db, userId, id);
  await db.delete(contacts).where(eq(contacts.id, id));
}
