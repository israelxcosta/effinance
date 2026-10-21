// Tenant boundary for route plugins whose requests need more than one database phase: calls to an
// external provider between phases (Open Finance — never while holding a transaction: production
// sets idle_in_transaction_session_timeout) or reads of identity tables (member names) that the
// tenant role cannot see. Same guarantees as lib/tenant-routes.ts, made explicit:
// - every request is authenticated, and mutations need an editor/owner role and a subscription that
//   allows writing (`tenantGuards`);
// - financial tables are only touched inside `inTenant` (role effinance_app + RLS setting); the
//   system connection has no grants on them, so a slip fails closed;
// - handlers answer after the last `inTenant` resolved, i.e. after COMMIT.

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { DbExecutor } from '../db/client';
import { assertCanWrite, isMutation } from '../modules/workspaces/access';
import { getCipher } from './crypto/keyring';
import { withTenant } from './tenant';

type Hooks = Pick<FastifyInstance, 'addHook' | 'authenticate'>;

/** Registers authentication and the write check (role + subscription) for every route of the plugin. */
export function tenantGuards(app: Hooks): void {
  app.addHook('onRequest', app.authenticate);
  app.addHook('onRequest', async (req: FastifyRequest) => {
    if (isMutation(req.method)) assertCanWrite(req.access);
  });
}

/**
 * One tenant transaction. The workspace data key is unwrapped first, outside the transaction: no
 * key-provider (KMS) call while holding a connection, and no system-connection lookup from inside
 * it (the browser demo has a single PGlite connection).
 */
export async function inTenant<T>(db: DbExecutor, workspaceId: string, fn: (tx: DbExecutor) => Promise<T>): Promise<T> {
  await getCipher(workspaceId);
  return withTenant(db, workspaceId, fn);
}
