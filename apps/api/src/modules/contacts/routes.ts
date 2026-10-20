import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { contactInputSchema, contactQuerySchema } from '@effinance/shared';
import { idParams } from '../common/params';
import { createContact, deleteContact, getContact, listContacts, updateContact } from './service';

export const contactRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/', { schema: { querystring: contactQuerySchema } }, async (req) =>
    listContacts(req.db, req.workspaceId, req.query),
  );

  app.get('/:id', { schema: { params: idParams } }, async (req) => getContact(req.db, req.workspaceId, req.params.id));

  app.post('/', { schema: { body: contactInputSchema } }, async (req, reply) =>
    reply.code(201).send(await createContact(req.db, req.workspaceId, req.body)),
  );

  app.put('/:id', { schema: { params: idParams, body: contactInputSchema } }, async (req) =>
    updateContact(req.db, req.workspaceId, req.params.id, req.body),
  );

  app.delete('/:id', { schema: { params: idParams } }, async (req, reply) => {
    await deleteContact(req.db, req.workspaceId, req.params.id);
    return reply.code(204).send();
  });
};
