// Refresh-token sessions. Each row is one refresh token; a login starts a family. Refreshing rotates
// the token (old row → rotatedAt, new row in the same family). Presenting a rotated token again
// means it was copied: the whole family is revoked. Only SHA-256 hashes are stored.

import { and, desc, eq, gt, isNull, ne } from 'drizzle-orm';
import type { SessionInfo } from '@effinance/shared';
import type { DbExecutor } from '../../db/client';
import { sessions } from '../../db/schema';
import { randomToken, sha256Hex } from '../../lib/crypto/encoding';
import { maskIp, shortUserAgent } from '../../lib/ip';

export const REFRESH_TTL_MS = 30 * 86_400_000;
/** Absolute lifetime of a session (login), however often it is refreshed: then sign in again. */
export const SESSION_MAX_AGE_MS = 90 * 86_400_000;
/** A token rotated this recently may still arrive from a concurrent request of the same browser. */
const ROTATION_GRACE_MS = 10_000;

export interface SessionContext {
  userAgent?: string | null;
  ip?: string | null;
}

export interface IssuedSession {
  familyId: string;
  userId: string;
  workspaceId: string | null;
  refreshToken: string;
  expiresAt: Date;
}

/** Sliding refresh window, capped by the session's absolute lifetime. */
function refreshExpiry(now: Date, sessionStartedAt: Date): Date {
  return new Date(Math.min(now.getTime() + REFRESH_TTL_MS, sessionStartedAt.getTime() + SESSION_MAX_AGE_MS));
}

export async function createSession(
  db: DbExecutor,
  input: { userId: string; workspaceId: string | null } & SessionContext,
): Promise<IssuedSession> {
  const refreshToken = randomToken();
  const now = new Date();
  const id = globalThis.crypto.randomUUID();
  const expiresAt = refreshExpiry(now, now);
  await db.insert(sessions).values({
    id,
    familyId: id,
    userId: input.userId,
    workspaceId: input.workspaceId,
    tokenHash: await sha256Hex(refreshToken),
    userAgent: shortUserAgent(input.userAgent),
    ip: maskIp(input.ip),
    sessionStartedAt: now,
    lastUsedAt: now,
    expiresAt,
  });
  return { familyId: id, userId: input.userId, workspaceId: input.workspaceId, refreshToken, expiresAt };
}

export type RotateResult =
  | { status: 'rotated'; session: IssuedSession }
  /** Concurrent refresh: the browser already received the new cookies. */
  | { status: 'grace' }
  | { status: 'reuse'; userId: string; familyId: string }
  | { status: 'invalid' };

export async function rotateSession(db: DbExecutor, refreshToken: string, ctx: SessionContext): Promise<RotateResult> {
  const now = new Date();
  const [row] = await db.select().from(sessions).where(eq(sessions.tokenHash, await sha256Hex(refreshToken)));
  if (!row || row.revokedAt || row.expiresAt <= now) return { status: 'invalid' };
  if (row.sessionStartedAt.getTime() + SESSION_MAX_AGE_MS <= now.getTime()) {
    await revokeFamily(db, row.familyId);
    return { status: 'invalid' };
  }
  if (row.rotatedAt) {
    if (now.getTime() - row.rotatedAt.getTime() <= ROTATION_GRACE_MS) return { status: 'grace' };
    await revokeFamily(db, row.familyId);
    return { status: 'reuse', userId: row.userId, familyId: row.familyId };
  }

  const next = randomToken();
  const expiresAt = refreshExpiry(now, row.sessionStartedAt);
  // Conditional update: two requests racing on the same token cannot both rotate it.
  const rotated = await db
    .update(sessions)
    .set({ rotatedAt: now })
    .where(and(eq(sessions.id, row.id), isNull(sessions.rotatedAt)))
    .returning({ id: sessions.id });
  if (rotated.length === 0) return { status: 'grace' };
  await db.insert(sessions).values({
    familyId: row.familyId,
    userId: row.userId,
    workspaceId: row.workspaceId,
    tokenHash: await sha256Hex(next),
    userAgent: shortUserAgent(ctx.userAgent) ?? row.userAgent,
    ip: maskIp(ctx.ip) ?? row.ip,
    sessionStartedAt: row.sessionStartedAt,
    lastUsedAt: now,
    expiresAt,
  });
  return {
    status: 'rotated',
    session: { familyId: row.familyId, userId: row.userId, workspaceId: row.workspaceId, refreshToken: next, expiresAt },
  };
}

export async function revokeFamily(db: DbExecutor, familyId: string): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.familyId, familyId), isNull(sessions.revokedAt)));
}

/** Revokes every session of the user, optionally keeping one (the current). */
export async function revokeUserSessions(db: DbExecutor, userId: string, exceptFamilyId?: string | null): Promise<void> {
  const conditions = [eq(sessions.userId, userId), isNull(sessions.revokedAt)];
  if (exceptFamilyId) conditions.push(ne(sessions.familyId, exceptFamilyId));
  await db.update(sessions).set({ revokedAt: new Date() }).where(and(...conditions));
}

export async function setSessionWorkspace(db: DbExecutor, familyId: string, workspaceId: string): Promise<void> {
  await db.update(sessions).set({ workspaceId }).where(eq(sessions.familyId, familyId));
}

export async function listSessions(db: DbExecutor, userId: string, currentFamilyId: string | null): Promise<SessionInfo[]> {
  const rows = await db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, userId),
        isNull(sessions.rotatedAt),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(sessions.lastUsedAt));
  return rows.map((r) => ({
    id: r.familyId,
    userAgent: r.userAgent,
    ip: r.ip,
    createdAt: r.sessionStartedAt.toISOString(),
    lastUsedAt: r.lastUsedAt.toISOString(),
    current: r.familyId === currentFamilyId,
  }));
}

/** Revokes one of the user's sessions; returns false when it does not exist. */
export async function revokeUserSession(db: DbExecutor, userId: string, familyId: string): Promise<boolean> {
  const rows = await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.familyId, familyId), eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  return rows.length > 0;
}
