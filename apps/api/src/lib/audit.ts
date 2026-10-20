// Audit trail of security, membership, billing and data-protection events. Entries carry ids, the
// masked IP and the user agent — never names, e-mails, documents or amounts.

import type { DbExecutor } from '../db/client';
import { auditLogs } from '../db/schema';
import { maskIp, shortUserAgent } from './ip';

export interface AuditContext {
  ip?: string | null;
  userAgent?: string | null;
}

export interface AuditEntry extends AuditContext {
  action: string;
  workspaceId?: string | null;
  userId?: string | null;
  entity?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function audit(db: DbExecutor, entry: AuditEntry): Promise<void> {
  await db.insert(auditLogs).values({
    action: entry.action,
    workspaceId: entry.workspaceId ?? null,
    userId: entry.userId ?? null,
    entity: entry.entity ?? null,
    entityId: entry.entityId ?? null,
    ip: maskIp(entry.ip),
    userAgent: shortUserAgent(entry.userAgent),
    metadata: entry.metadata ?? null,
  });
}
