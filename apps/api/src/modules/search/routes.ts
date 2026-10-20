import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { searchQuerySchema } from '@effinance/shared';
import { search } from './service';

export const searchRoutes: FastifyPluginAsyncZod = async (app) => {  app.get('/', { schema: { querystring: searchQuerySchema } }, async (req) => search(req.db, req.workspaceId, req.query.q));
};
