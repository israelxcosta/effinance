// LGPD data portability: every record of the workspace, decrypted, as JSON.

import { asc, eq } from 'drizzle-orm';
import type { DbExecutor } from '../../db/client';
import {
  accounts,
  categories,
  contacts,
  creditCards,
  goalContributions,
  goals,
  recurrences,
  transactions,
  workspaces,
} from '../../db/schema';
import { getCipher } from '../../lib/crypto/keyring';
import { withTenant } from '../../lib/tenant';
import { CONTACT_ENCRYPTED_FIELDS } from '../contacts/service';
import { exportOpenFinance } from '../open-finance/service';
import { getSubscriptionRow, listMembers } from './service';
import { summarizeSubscription } from '../billing/entitlements';
import type { Access } from './access';

export async function exportWorkspace(db: DbExecutor, access: Access) {
  const cipher = await getCipher(access.workspaceId);
  const [[workspace], members, subscription] = await Promise.all([
    db
      .select({ id: workspaces.id, name: workspaces.name, kind: workspaces.kind, createdAt: workspaces.createdAt })
      .from(workspaces)
      .where(eq(workspaces.id, access.workspaceId)),
    listMembers(db, access),
    getSubscriptionRow(db, access.workspaceId),
  ]);

  const data = await withTenant(db, access.workspaceId, async (tx) => {
    const [cats, accs, cards, goalRows, contributionRows, contactRows, seriesRows, txRows] = await Promise.all([
      tx.select().from(categories).orderBy(asc(categories.createdAt)),
      tx.select().from(accounts).orderBy(asc(accounts.createdAt)),
      tx.select().from(creditCards).orderBy(asc(creditCards.createdAt)),
      tx.select().from(goals).orderBy(asc(goals.createdAt)),
      tx.select().from(goalContributions).orderBy(asc(goalContributions.date)),
      tx.select().from(contacts).orderBy(asc(contacts.name)),
      tx.select().from(recurrences).orderBy(asc(recurrences.createdAt)),
      tx.select().from(transactions).orderBy(asc(transactions.date), asc(transactions.createdAt)),
    ]);
    const decrypt = (table: string, column: string, value: string | null) => cipher.decrypt(table, column, value);
    // Connections and import batches: metadata only (no aggregator ids, blind indexes or cursors).
    const integrations = await exportOpenFinance(tx);
    return {
      categories: cats,
      accounts: accs,
      creditCards: cards,
      goals: await Promise.all(goalRows.map(async (g) => ({ ...g, notes: await decrypt('goals', 'notes', g.notes) }))),
      goalContributions: await Promise.all(
        contributionRows.map(async (c) => ({ ...c, note: await decrypt('goal_contributions', 'note', c.note) })),
      ),
      contacts: await Promise.all(
        contactRows.map(async ({ documentHash: _hash, ...c }) => cipher.decryptFields('contacts', c, CONTACT_ENCRYPTED_FIELDS)),
      ),
      recurrences: await Promise.all(
        seriesRows.map(async (r) => ({
          ...r,
          template: { ...r.template, notes: await decrypt('transactions', 'notes', r.template.notes) },
        })),
      ),
      // externalId is the source's identifier (FITID / aggregator transaction id): not exported.
      transactions: await Promise.all(
        txRows.map(async ({ externalId: _external, ...t }) => ({ ...t, notes: await decrypt('transactions', 'notes', t.notes) })),
      ),
      ...integrations,
    };
  });

  return {
    format: 'effinance-export/v1',
    exportedAt: new Date().toISOString(),
    workspace,
    subscription: summarizeSubscription(subscription),
    members: members.map(({ isYou: _you, ...m }) => m),
    ...data,
  };
}
