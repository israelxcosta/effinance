import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  anticipateInstallmentsSchema,
  seriesScopeQuerySchema,
  setPaidSchema,
  transactionInputSchema,
  transactionQuerySchema,
  transactionUpdateSchema,
} from '@effinance/shared';
import { idParams } from '../common/params';
import {
  anticipateInstallments,
  createTransaction,
  deleteTransaction,
  getTransaction,
  listTransactions,
  setPaid,
  updateTransaction,
} from './service';

export const transactionRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/', { schema: { querystring: transactionQuerySchema } }, async (req) =>
    listTransactions(req.db, req.workspaceId, req.query),
  );

  app.get('/:id', { schema: { params: idParams } }, async (req) =>
    getTransaction(req.db, req.workspaceId, req.params.id),
  );

  app.post('/', { schema: { body: transactionInputSchema } }, async (req, reply) =>
    reply.code(201).send(await createTransaction(req.db, req.workspaceId, req.body)),
  );

  app.put(
    '/:id',
    { schema: { params: idParams, querystring: seriesScopeQuerySchema, body: transactionUpdateSchema } },
    async (req) => updateTransaction(req.db, req.workspaceId, req.params.id, req.body, req.query.scope),
  );

  app.patch('/:id/paid', { schema: { params: idParams, body: setPaidSchema } }, async (req) =>
    setPaid(req.db, req.workspaceId, req.params.id, req.body),
  );

  app.post('/:id/anticipate', { schema: { params: idParams, body: anticipateInstallmentsSchema } }, async (req) =>
    anticipateInstallments(req.db, req.workspaceId, req.params.id, req.body),
  );

  app.delete(
    '/:id',
    { schema: { params: idParams, querystring: seriesScopeQuerySchema } },
    async (req, reply) => {
      await deleteTransaction(req.db, req.workspaceId, req.params.id, req.query.scope);
      return reply.code(204).send();
    },
  );
};
