import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { accountQuerySchema, creditCardInputSchema, payInvoiceSchema } from '@effinance/shared';
import { idParams, invoiceParams, invoiceRangeQuery } from '../common/params';
import {
  createCreditCard,
  deleteCreditCard,
  getInvoice,
  listCreditCards,
  listInvoices,
  payInvoice,
  updateCreditCard,
} from './service';

export const creditCardRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.authenticate);

  app.get('/', { schema: { querystring: accountQuerySchema } }, async (req) =>
    listCreditCards(app.db, req.userId, req.query.includeArchived ?? false),
  );

  app.post('/', { schema: { body: creditCardInputSchema } }, async (req, reply) =>
    reply.code(201).send(await createCreditCard(app.db, req.userId, req.body)),
  );

  app.put('/:id', { schema: { params: idParams, body: creditCardInputSchema } }, async (req) =>
    updateCreditCard(app.db, req.userId, req.params.id, req.body),
  );

  app.delete('/:id', { schema: { params: idParams } }, async (req, reply) => {
    await deleteCreditCard(app.db, req.userId, req.params.id);
    return reply.code(204).send();
  });

  app.get('/:id/invoices', { schema: { params: idParams, querystring: invoiceRangeQuery } }, async (req) =>
    listInvoices(app.db, req.userId, req.params.id, req.query),
  );

  app.get('/:id/invoices/:month', { schema: { params: invoiceParams } }, async (req) =>
    getInvoice(app.db, req.userId, req.params.id, req.params.month),
  );

  app.post('/:id/invoices/:month/pay', { schema: { params: invoiceParams, body: payInvoiceSchema } }, async (req) =>
    payInvoice(app.db, req.userId, req.params.id, req.params.month, req.body),
  );
};
