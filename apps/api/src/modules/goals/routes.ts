import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { goalContributionInputSchema, goalInputSchema } from '@effinance/shared';
import { contributionParams, idParams } from '../common/params';
import {
  addContribution,
  createGoal,
  deleteContribution,
  deleteGoal,
  listContributions,
  listGoals,
  updateGoal,
} from './service';

export const goalRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.authenticate);

  app.get('/', async (req) => listGoals(app.db, req.userId));

  app.post('/', { schema: { body: goalInputSchema } }, async (req, reply) =>
    reply.code(201).send(await createGoal(app.db, req.userId, req.body)),
  );

  app.put('/:id', { schema: { params: idParams, body: goalInputSchema } }, async (req) =>
    updateGoal(app.db, req.userId, req.params.id, req.body),
  );

  app.delete('/:id', { schema: { params: idParams } }, async (req, reply) => {
    await deleteGoal(app.db, req.userId, req.params.id);
    return reply.code(204).send();
  });

  app.get('/:id/contributions', { schema: { params: idParams } }, async (req) =>
    listContributions(app.db, req.userId, req.params.id),
  );

  app.post(
    '/:id/contributions',
    { schema: { params: idParams, body: goalContributionInputSchema } },
    async (req, reply) => reply.code(201).send(await addContribution(app.db, req.userId, req.params.id, req.body)),
  );

  app.delete('/:id/contributions/:contributionId', { schema: { params: contributionParams } }, async (req, reply) => {
    await deleteContribution(app.db, req.userId, req.params.id, req.params.contributionId);
    return reply.code(204).send();
  });
};
