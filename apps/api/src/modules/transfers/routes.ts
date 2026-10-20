import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { transferInputSchema, transferQuerySchema } from '@effinance/shared';
import { idParams } from '../common/params';
import { createTransfer, deleteTransfer, listTransfers, updateTransfer } from './service';

export const transferRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/', { schema: { querystring: transferQuerySchema } }, async (req) =>
    listTransfers(req.db, req.workspaceId, req.query),
  );

  app.post('/', { schema: { body: transferInputSchema } }, async (req, reply) =>
    reply.code(201).send(await createTransfer(req.db, req.workspaceId, req.body)),
  );

  app.put('/:id', { schema: { params: idParams, body: transferInputSchema } }, async (req) =>
    updateTransfer(req.db, req.workspaceId, req.params.id, req.body),
  );

  app.delete('/:id', { schema: { params: idParams } }, async (req, reply) => {
    await deleteTransfer(req.db, req.workspaceId, req.params.id);
    return reply.code(204).send();
  });
};
