// Per-request access check: the user must still be a member of the workspace in the token and the
// session must not be revoked. One query, executed on the system connection.

import { and, eq, exists, gt, isNull, sql } from 'drizzle-orm';
import type { MemberRole, SubscriptionSummary, WorkspaceKind } from '@effinance/shared';
import type { DbExecutor } from '../../db/client';
import { sessions, subscriptions, workspaceMembers, workspaces } from '../../db/schema';
import { ForbiddenError, SubscriptionRequiredError } from '../../lib/errors';
import { summarizeSubscription } from '../billing/entitlements';

export interface Access {
  userId: string;
  workspaceId: string;
  /** Session family id (`sid` claim); null in contexts without sessions. */
  sessionId: string | null;
  role: MemberRole;
  workspaceName: string;
  workspaceKind: WorkspaceKind;
  subscription: SubscriptionSummary;
}

export async function loadAccess(
  db: DbExecutor,
  userId: string,
  workspaceId: string,
  sessionId: string | null,
): Promise<Access | null> {
  const now = new Date();
  const conditions = [eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)];
  if (sessionId) {
    conditions.push(
      exists(
        db
          .select({ one: sql`1` })
          .from(sessions)
          .where(
            and(
              eq(sessions.familyId, sessionId),
              eq(sessions.userId, userId),
              isNull(sessions.rotatedAt),
              isNull(sessions.revokedAt),
              gt(sessions.expiresAt, now),
            ),
          ),
      ),
    );
  }
  const [row] = await db
    .select({ role: workspaceMembers.role, workspace: workspaces, subscription: subscriptions })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .leftJoin(subscriptions, eq(subscriptions.workspaceId, workspaceMembers.workspaceId))
    .where(and(...conditions));
  if (!row) return null;
  return {
    userId,
    workspaceId,
    sessionId,
    role: row.role,
    workspaceName: row.workspace.name,
    workspaceKind: row.workspace.kind,
    subscription: summarizeSubscription(row.subscription, now),
  };
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function isMutation(method: string): boolean {
  return MUTATING.has(method.toUpperCase());
}

/** Writes need an editor/owner role and a subscription that allows writing. */
export function assertCanWrite(access: Access): void {
  if (access.role === 'viewer') throw new ForbiddenError('Você tem acesso somente leitura neste espaço');
  if (!access.subscription.canWrite) throw new SubscriptionRequiredError();
}

export function assertOwner(access: Access): void {
  if (access.role !== 'owner') throw new ForbiddenError('Somente o proprietário do espaço pode fazer isso');
}
