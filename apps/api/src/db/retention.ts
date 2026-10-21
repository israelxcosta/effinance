// Retention of security rows that are useless once expired (LGPD: data minimization). Every refresh
// inserts a session row and rotated rows were never removed; reset links and invites (which hold an
// e-mail address) stayed forever. Runs with the migrator/owner connection: `db:migrate` calls it on
// every deploy; schedule it as well (e.g. a daily task running `dist/migrate.js`).

import { and, isNotNull, lt, or } from 'drizzle-orm';
import type { DbExecutor } from './client';
import { openFinanceEvents, passwordResets, sessions, workspaceInvites } from './schema';

const DAY_MS = 86_400_000;
/** Accepted/expired invites stay visible this long (support questions), then go. */
export const INVITE_RETENTION_DAYS = 30;
/** Webhook event ids are kept this long for idempotency (aggregators retry for hours, not weeks). */
export const WEBHOOK_EVENT_RETENTION_DAYS = 30;

export interface PurgeResult {
  sessions: number;
  passwordResets: number;
  invites: number;
  webhookEvents: number;
}

export async function purgeExpiredSecurityRows(db: DbExecutor, now: Date = new Date()): Promise<PurgeResult> {
  // A refresh row past `expires_at` is rejected by `rotateSession` before reuse detection, so it no
  // longer protects anything.
  const deletedSessions = await db
    .delete(sessions)
    .where(lt(sessions.expiresAt, now))
    .returning({ id: sessions.id });
  const deletedResets = await db
    .delete(passwordResets)
    .where(or(isNotNull(passwordResets.usedAt), lt(passwordResets.expiresAt, now)))
    .returning({ id: passwordResets.id });
  const cutoff = new Date(now.getTime() - INVITE_RETENTION_DAYS * DAY_MS);
  const deletedInvites = await db
    .delete(workspaceInvites)
    .where(
      or(
        lt(workspaceInvites.expiresAt, cutoff),
        and(isNotNull(workspaceInvites.acceptedAt), lt(workspaceInvites.acceptedAt, cutoff)),
      ),
    )
    .returning({ id: workspaceInvites.id });
  const deletedEvents = await db
    .delete(openFinanceEvents)
    .where(lt(openFinanceEvents.createdAt, new Date(now.getTime() - WEBHOOK_EVENT_RETENTION_DAYS * DAY_MS)))
    .returning({ id: openFinanceEvents.id });
  return {
    sessions: deletedSessions.length,
    passwordResets: deletedResets.length,
    invites: deletedInvites.length,
    webhookEvents: deletedEvents.length,
  };
}
