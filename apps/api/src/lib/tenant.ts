// Tenant isolation. Every request on financial data runs inside a transaction that switches to the
// `effinance_app` role (subject to Row Level Security) and pins `app.workspace_id`; the policies in
// migration 0003 then hide every row of other workspaces, even from a query that forgets the filter.

import { sql } from 'drizzle-orm';
import type { DbExecutor } from '../db/client';

/** Runs `fn` in a transaction scoped to `workspaceId` (role `effinance_app` + RLS setting). */
export async function withTenant<T>(db: DbExecutor, workspaceId: string, fn: (tx: DbExecutor) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('role', 'effinance_app', true), set_config('app.workspace_id', ${workspaceId}, true)`,
    );
    return fn(tx);
  });
}
