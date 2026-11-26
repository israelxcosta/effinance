import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { investmentIncomeInputSchema, investmentPurchaseInputSchema, investmentSaleInputSchema } from '@effinance/shared';
import { idParams } from '../common/params';
import { createIncome, createPurchase, createSale, deleteIncome, deletePurchase, deleteSale, getPortfolio, updatePurchase } from './service';

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

  app.post('/sales', { schema: { body: investmentSaleInputSchema } }, async (req, reply) =>
    reply.code(201).send(await createSale(req.db, req.workspaceId, req.body)),
  );

  app.delete('/sales/:id', { schema: { params: idParams } }, async (req, reply) => {
    await deleteSale(req.db, req.workspaceId, req.params.id);
    return reply.code(204).send();
  });

  app.post('/incomes', { schema: { body: investmentIncomeInputSchema } }, async (req, reply) =>
    reply.code(201).send(await createIncome(req.db, req.workspaceId, req.body)),
  );

  app.delete('/incomes/:id', { schema: { params: idParams } }, async (req, reply) => {
    await deleteIncome(req.db, req.workspaceId, req.params.id);
    return reply.code(204).send();
  });
};
