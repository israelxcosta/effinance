// Plans, subscription, checkout and the Mercado Pago webhook. Shared with the browser demo (fake
// provider): depends only on app decorations.

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { PLANS, checkoutSchema } from '@effinance/shared';
import { NotFoundError } from '../../lib/errors';
import { rateLimited } from '../../lib/platform';
import { requestContext } from '../../lib/request-context';
import { getUserRow } from '../workspaces/service';
import { assertOwner } from '../workspaces/access';
import { cancelSubscription, devActivate, getSubscription, handleWebhook, startCheckout } from './service';

export const billingRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/plans', async () => PLANS);

  app.post('/webhooks/mercadopago', { config: rateLimited(app.platform, 300, '1 minute') }, async (req) => {
    const result = await handleWebhook(app.db, app.platform, {
      headers: req.headers as Record<string, string | string[] | undefined>,
      query: (req.query ?? {}) as Record<string, unknown>,
      body: req.body,
    });
    return { received: true, duplicate: result.duplicate };
  });

  const authenticated: FastifyPluginAsyncZod = async (authed) => {
    authed.addHook('onRequest', app.authenticate);

    authed.get('/subscription', async (req) => getSubscription(app.db, req.access));

    authed.post('/checkout', { schema: { body: checkoutSchema }, config: rateLimited(app.platform, 10, '1 minute') }, async (req) => {
      assertOwner(req.access);
      const user = await getUserRow(app.db, req.userId);
      return startCheckout(app.db, app.platform, req.access, user.email, req.body.planCode, requestContext(req));
    });

    authed.post('/cancel', async (req) => {
      assertOwner(req.access);
      return cancelSubscription(app.db, app.platform, req.access, requestContext(req));
    });

    authed.post('/dev/activate', { schema: { body: checkoutSchema } }, async (req) => {
      if (app.platform.billing.name !== 'fake') throw new NotFoundError('Rota não encontrada');
      assertOwner(req.access);
      return devActivate(app.db, req.access, req.body.planCode, requestContext(req));
    });
  };
  await app.register(authenticated);
};
