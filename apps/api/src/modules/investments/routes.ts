import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { investmentPurchaseInputSchema } from '@effinance/shared';
import { idParams } from '../common/params';
import { createPurchase, deletePurchase, getPortfolio, updatePurchase } from './service';

export const investmentRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/', async (req) => getPortfolio(req.db, req.workspaceId));

  app.post('/purchases', { schema: { body: investmentPurchaseInputSchema } }, async (req, reply) =>
    reply.code(201).send(await createPurchase(req.db, req.workspaceId, req.body)),
  );

  app.put('/purchases/:id', { schema: { params: idParams, body: investmentPurchaseInputSchema } }, async (req) =>
    updatePurchase(req.db, req.workspaceId, req.params.id, req.body),
  );

  app.delete('/purchases/:id', { schema: { params: idParams } }, async (req, reply) => {
    await deletePurchase(req.db, req.workspaceId, req.params.id);
    return reply.code(204).send();
  });
};
