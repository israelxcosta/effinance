import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  seriesScopeQuerySchema,
  setPaidSchema,
  transactionInputSchema,
  transactionQuerySchema,
  transactionUpdateSchema,
} from '@effinance/shared';
import { idParams } from '../common/params';
import {
  createTransaction,
  deleteTransaction,
  getTransaction,
  listTransactions,
  setPaid,
  updateTransaction,
} from './service';

export const transactionRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.authenticate);

  app.get('/', { schema: { querystring: transactionQuerySchema } }, async (req) =>
    listTransactions(app.db, req.userId, req.query),
  );

  app.get('/:id', { schema: { params: idParams } }, async (req) =>
    getTransaction(app.db, req.userId, req.params.id),
  );

  app.post('/', { schema: { body: transactionInputSchema } }, async (req, reply) =>
    reply.code(201).send(await createTransaction(app.db, req.userId, req.body)),
  );

  app.put(
    '/:id',
    { schema: { params: idParams, querystring: seriesScopeQuerySchema, body: transactionUpdateSchema } },
    async (req) => updateTransaction(app.db, req.userId, req.params.id, req.body, req.query.scope),
  );

  app.patch('/:id/paid', { schema: { params: idParams, body: setPaidSchema } }, async (req) =>
    setPaid(app.db, req.userId, req.params.id, req.body),
  );

  app.delete(
    '/:id',
    { schema: { params: idParams, querystring: seriesScopeQuerySchema } },
    async (req, reply) => {
      await deleteTransaction(app.db, req.userId, req.params.id, req.query.scope);
      return reply.code(204).send();
    },
  );
};
