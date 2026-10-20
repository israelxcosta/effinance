import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { contactInputSchema, contactQuerySchema } from '@effinance/shared';
import { idParams } from '../common/params';
import { createContact, deleteContact, getContact, listContacts, updateContact } from './service';

export const contactRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.authenticate);

  app.get('/', { schema: { querystring: contactQuerySchema } }, async (req) =>
    listContacts(app.db, req.userId, req.query),
  );

  app.get('/:id', { schema: { params: idParams } }, async (req) => getContact(app.db, req.userId, req.params.id));

  app.post('/', { schema: { body: contactInputSchema } }, async (req, reply) =>
    reply.code(201).send(await createContact(app.db, req.userId, req.body)),
  );

  app.put('/:id', { schema: { params: idParams, body: contactInputSchema } }, async (req) =>
    updateContact(app.db, req.userId, req.params.id, req.body),
  );

  app.delete('/:id', { schema: { params: idParams } }, async (req, reply) => {
    await deleteContact(app.db, req.userId, req.params.id);
    return reply.code(204).send();
  });
};
