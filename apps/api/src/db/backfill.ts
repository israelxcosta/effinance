// Encrypts data written before field encryption existed (contacts, notes) and gives every workspace
// a data key. Idempotent: values already in the `v1.` format are skipped. Runs after migrations.

import { eq, isNull, sql } from 'drizzle-orm';
import type { DbExecutor } from './client';
import { contacts, goalContributions, goals, recurrences, transactions, workspaces } from './schema';
import { getCipher } from '../lib/crypto/keyring';
import { isEncrypted } from '../lib/crypto/field-cipher';
import { withTenant } from '../lib/tenant';
import { CONTACT_ENCRYPTED_FIELDS, encryptContactInput } from '../modules/contacts/service';

export async function backfillEncryption(db: DbExecutor): Promise<{ workspaces: number; rows: number }> {
  const all = await db.select({ id: workspaces.id }).from(workspaces);
  let rows = 0;
  for (const { id } of all) {
    const cipher = await getCipher(id); // generates the key of migrated workspaces
    rows += await withTenant(db, id, async (tx) => {
      let n = 0;
      const plain = (v: string | null) => v !== null && v !== '' && !isEncrypted(v);

      for (const c of await tx.select().from(contacts)) {
        if (!CONTACT_ENCRYPTED_FIELDS.some((f) => plain(c[f])) && (c.documentHash || !c.document)) continue;
        const decrypted = { ...c };
        for (const f of CONTACT_ENCRYPTED_FIELDS) {
          if (isEncrypted(c[f])) decrypted[f] = await cipher.decrypt('contacts', f, c[f]);
        }
        const { id: contactId, workspaceId: _w, createdAt: _c, documentHash: _h, ...input } = decrypted;
        await tx.update(contacts).set(await encryptContactInput(cipher, { ...input, name: c.name })).where(eq(contacts.id, contactId));
        n++;
      }
      for (const t of await tx.select({ id: transactions.id, notes: transactions.notes }).from(transactions)) {
        if (!plain(t.notes)) continue;
        await tx.update(transactions).set({ notes: await cipher.encrypt('transactions', 'notes', t.notes) }).where(eq(transactions.id, t.id));
        n++;
      }
      for (const r of await tx.select().from(recurrences)) {
        if (!plain(r.template.notes)) continue;
        const notes = await cipher.encrypt('transactions', 'notes', r.template.notes);
        await tx.update(recurrences).set({ template: { ...r.template, notes } }).where(eq(recurrences.id, r.id));
        n++;
      }
      for (const g of await tx.select({ id: goals.id, notes: goals.notes }).from(goals)) {
        if (!plain(g.notes)) continue;
        await tx.update(goals).set({ notes: await cipher.encrypt('goals', 'notes', g.notes) }).where(eq(goals.id, g.id));
        n++;
      }
      for (const c of await tx.select({ id: goalContributions.id, note: goalContributions.note }).from(goalContributions)) {
        if (!plain(c.note)) continue;
        await tx
          .update(goalContributions)
          .set({ note: await cipher.encrypt('goal_contributions', 'note', c.note) })
          .where(eq(goalContributions.id, c.id));
        n++;
      }
      return n;
    });
  }
  return { workspaces: all.length, rows };
}

/** True when some workspace still lacks a data key (cheap check before a full backfill). */
export async function needsBackfill(db: DbExecutor): Promise<boolean> {
  const [row] = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(workspaces).where(isNull(workspaces.wrappedKey));
  return (row?.n ?? 0) > 0;
}
