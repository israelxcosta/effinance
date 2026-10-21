// Tenant isolation. Every request on financial data runs inside a transaction that switches to the
// `effinance_app` role (subject to Row Level Security) and pins `app.workspace_id`; the policies in
// migration 0003 then hide every row of other workspaces, even from a query that forgets the filter.
// Both settings are transaction-local (`set_config(..., true)` = SET LOCAL): they end with the
// transaction and never leak to the next user of a pooled connection.

import { sql } from 'drizzle-orm';
import type { DbExecutor } from '../db/client';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Upper bound of any single statement of a tenant request (abusive filters/ranges, runaway plans). */
export const TENANT_STATEMENT_TIMEOUT = '15s';

/** Runs `fn` in a transaction scoped to `workspaceId` (role `effinance_app` + RLS setting). */
export async function withTenant<T>(db: DbExecutor, workspaceId: string, fn: (tx: DbExecutor) => Promise<T>): Promise<T> {
  // An empty/missing id would silently match no row (the policy fails closed); refuse it loudly so a
  // caller bug cannot look like an empty workspace.
  if (typeof workspaceId !== 'string' || !UUID.test(workspaceId)) {
    throw new Error('withTenant: invalid workspace id');
  }
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('role', 'effinance_app', true), set_config('app.workspace_id', ${workspaceId}, true),
                 set_config('statement_timeout', ${TENANT_STATEMENT_TIMEOUT}, true)`,
    );
    return fn(tx);
  });
}
