import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { accountInputSchema, accountQuerySchema } from '@effinance/shared';
import { idParams } from '../common/params';
import { createAccount, deleteAccount, getAccountWithBalance, listAccounts, updateAccount } from './service';

export const accountRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/', { schema: { querystring: accountQuerySchema } }, async (req) =>
    listAccounts(req.db, req.workspaceId, req.query.includeArchived ?? false),
  );

  app.get('/:id', { schema: { params: idParams } }, async (req) =>
    getAccountWithBalance(req.db, req.workspaceId, req.params.id),
  );

  app.post('/', { schema: { body: accountInputSchema } }, async (req, reply) =>
    reply.code(201).send(await createAccount(req.db, req.workspaceId, req.body)),
  );

  app.put('/:id', { schema: { params: idParams, body: accountInputSchema } }, async (req) =>
    updateAccount(req.db, req.workspaceId, req.params.id, req.body),
  );

  app.delete('/:id', { schema: { params: idParams } }, async (req, reply) => {
    await deleteAccount(req.db, req.workspaceId, req.params.id);
    return reply.code(204).send();
  });
};
