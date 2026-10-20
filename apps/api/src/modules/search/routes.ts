import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { searchQuerySchema } from '@effinance/shared';
import { search } from './service';

export const searchRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.authenticate);
  app.get('/', { schema: { querystring: searchQuerySchema } }, async (req) => search(app.db, req.userId, req.query.q));
};
