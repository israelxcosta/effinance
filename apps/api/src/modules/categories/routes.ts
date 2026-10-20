import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { categoryInputSchema, categoryQuerySchema, categoryUpdateSchema } from '@effinance/shared';
import { idParams } from '../common/params';
import { createCategory, deleteCategory, listCategories, updateCategory } from './service';

export const categoryRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/', { schema: { querystring: categoryQuerySchema } }, async (req) =>
    listCategories(req.db, req.workspaceId, req.query),
  );

  app.post('/', { schema: { body: categoryInputSchema } }, async (req, reply) =>
    reply.code(201).send(await createCategory(req.db, req.workspaceId, req.body)),
  );

  app.put('/:id', { schema: { params: idParams, body: categoryUpdateSchema } }, async (req) =>
    updateCategory(req.db, req.workspaceId, req.params.id, req.body),
  );

  app.delete('/:id', { schema: { params: idParams } }, async (req, reply) => {
    await deleteCategory(req.db, req.workspaceId, req.params.id);
    return reply.code(204).send();
  });
};
