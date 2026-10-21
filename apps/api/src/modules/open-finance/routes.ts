// Open Finance (read-only bank connections). The authenticated routes use lib/tenant-scope.ts: provider
// calls happen between tenant transactions, never inside one. The webhook route is public (no
// session): authenticated by the secret in its path, idempotent per event id, answered before the
// processing, which re-reads everything from the provider. Shared with the browser demo (fake provider).

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { connectTokenSchema, createConnectionSchema, fakeConnectSchema, linkAccountsSchema } from '@effinance/shared';
import { audit } from '../../lib/audit';
import { rateLimited } from '../../lib/platform';
import { requestContext } from '../../lib/request-context';
import { tenantGuards } from '../../lib/tenant-scope';
import { idParams } from '../common/params';
import {
  createConnectToken,
  createConnection,
  deleteConnection,
  fakeConnect,
  fakeInstitutions,
  linkAccounts,
  listConnections,
  openFinanceStatus,
  syncConnection,
  type LogLike,
  type OpenFinanceContext,
} from './service';
import { receiveWebhook, runInBackground } from './webhooks';

const quietLog: LogLike = { warn: () => {} };

export const openFinanceRoutes: FastifyPluginAsyncZod = async (app) => {
  tenantGuards(app);
  const ctx = (req: { log?: LogLike }): OpenFinanceContext => ({ db: app.db, of: app.platform.openFinance, log: req.log ?? quietLog });

  app.get('/status', async () => openFinanceStatus(app.platform.openFinance));

  app.post('/connect-token', { schema: { body: connectTokenSchema }, config: rateLimited(app.platform, 20, '1 minute') }, async (req) =>
    createConnectToken(ctx(req), req.workspaceId, req.body.connectionId),
  );

  // Simulated consent widget (fake provider only; 404 otherwise).
  app.get('/dev/institutions', async () => fakeInstitutions(app.platform.openFinance));
  app.post('/dev/connect', { schema: { body: fakeConnectSchema } }, async (req) =>
    fakeConnect(app.platform.openFinance, req.workspaceId, req.body.institutionId),
  );

  app.get('/connections', async (req) => listConnections(app.db, req.workspaceId));

  app.post('/connections', { schema: { body: createConnectionSchema }, config: rateLimited(app.platform, 20, '1 minute') }, async (req, reply) => {
    const { connection, created } = await createConnection(ctx(req), req.workspaceId, req.userId, req.body.itemId);
    await audit(app.db, {
      ...requestContext(req),
      action: 'open_finance.connected',
      workspaceId: req.workspaceId,
      userId: req.userId,
      entity: 'bank_connection',
      entityId: connection.id,
      metadata: { provider: connection.provider, accounts: connection.accounts.length, reconnected: !created },
    });
    return reply.code(created ? 201 : 200).send(connection);
  });

  app.put('/connections/:id/accounts', { schema: { params: idParams, body: linkAccountsSchema } }, async (req) =>
    linkAccounts(app.db, req.workspaceId, req.params.id, req.body),
  );

  app.post('/connections/:id/sync', { schema: { params: idParams }, config: rateLimited(app.platform, 10, '1 minute') }, async (req) => {
    const result = await syncConnection(ctx(req), req.workspaceId, req.params.id, { userId: req.userId });
    await audit(app.db, {
      ...requestContext(req),
      action: 'open_finance.synced',
      workspaceId: req.workspaceId,
      userId: req.userId,
      entity: 'bank_connection',
      entityId: req.params.id,
      metadata: { trigger: 'manual', created: result.created, updated: result.updated, skipped: result.skipped },
    });
    return result;
  });

  app.delete('/connections/:id', { schema: { params: idParams }, config: rateLimited(app.platform, 20, '1 minute') }, async (req, reply) => {
    await deleteConnection(ctx(req), req.workspaceId, req.params.id);
    await audit(app.db, {
      ...requestContext(req),
      action: 'open_finance.disconnected',
      workspaceId: req.workspaceId,
      userId: req.userId,
      entity: 'bank_connection',
      entityId: req.params.id,
    });
    return reply.code(204).send();
  });
};

const webhookParams = z.object({ provider: z.string().max(20), secret: z.string().max(200) });

/** `POST /api/open-finance/webhooks/:provider/:secret` (production: `/webhooks/pluggy/<secret>`). */
export const openFinanceWebhookRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/:provider/:secret',
    { bodyLimit: 64 * 1024, schema: { params: webhookParams }, config: rateLimited(app.platform, 300, '1 minute') },
    async (req) => {
      const context: OpenFinanceContext = { db: app.db, of: app.platform.openFinance, log: req.log ?? quietLog };
      const { duplicate, job } = await receiveWebhook(context, req.params.provider, req.params.secret, req.body);
      // Answer now (the aggregator expects a 2xx within seconds); the sync runs afterwards.
      if (job) runInBackground(job);
      return { received: true, duplicate };
    },
  );
};
