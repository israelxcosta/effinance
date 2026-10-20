import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { dashboardQuerySchema } from '@effinance/shared';
import { getDashboard } from './service';

export const dashboardRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.authenticate);
  app.get('/', { schema: { querystring: dashboardQuerySchema } }, async (req) =>
    getDashboard(app.db, req.userId, req.query.month),
  );
};
