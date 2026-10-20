import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { statementQuerySchema } from '@effinance/shared';
import { getStatement } from './service';

export const statementRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.authenticate);
  app.get('/', { schema: { querystring: statementQuerySchema } }, async (req) =>
    getStatement(app.db, req.userId, req.query),
  );
};
