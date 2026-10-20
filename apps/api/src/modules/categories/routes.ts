import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { categoryInputSchema, categoryQuerySchema, categoryUpdateSchema } from '@effinance/shared';
import { idParams } from '../common/params';
import { createCategory, deleteCategory, listCategories, updateCategory } from './service';

export const categoryRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.authenticate);

  app.get('/', { schema: { querystring: categoryQuerySchema } }, async (req) =>
    listCategories(app.db, req.userId, req.query),
  );

  app.post('/', { schema: { body: categoryInputSchema } }, async (req, reply) =>
    reply.code(201).send(await createCategory(app.db, req.userId, req.body)),
  );

  app.put('/:id', { schema: { params: idParams, body: categoryUpdateSchema } }, async (req) =>
    updateCategory(app.db, req.userId, req.params.id, req.body),
  );

  app.delete('/:id', { schema: { params: idParams } }, async (req, reply) => {
    await deleteCategory(app.db, req.userId, req.params.id);
    return reply.code(204).send();
  });
};
