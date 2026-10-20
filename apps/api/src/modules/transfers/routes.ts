import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { transferInputSchema, transferQuerySchema } from '@effinance/shared';
import { idParams } from '../common/params';
import { createTransfer, deleteTransfer, listTransfers, updateTransfer } from './service';

export const transferRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.authenticate);

  app.get('/', { schema: { querystring: transferQuerySchema } }, async (req) =>
    listTransfers(app.db, req.userId, req.query),
  );

  app.post('/', { schema: { body: transferInputSchema } }, async (req, reply) =>
    reply.code(201).send(await createTransfer(app.db, req.userId, req.body)),
  );

  app.put('/:id', { schema: { params: idParams, body: transferInputSchema } }, async (req) =>
    updateTransfer(app.db, req.userId, req.params.id, req.body),
  );

  app.delete('/:id', { schema: { params: idParams } }, async (req, reply) => {
    await deleteTransfer(app.db, req.userId, req.params.id);
    return reply.code(204).send();
  });
};
