import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { dashboardQuerySchema } from '@effinance/shared';
import { getDashboard } from './service';

export const dashboardRoutes: FastifyPluginAsyncZod = async (app) => {  app.get('/', { schema: { querystring: dashboardQuerySchema } }, async (req) =>
    getDashboard(req.db, req.workspaceId, req.query.month),
  );
};
