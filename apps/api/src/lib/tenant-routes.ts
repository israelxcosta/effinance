// Mounts the financial route plugins inside the tenant boundary: authentication, write
// permissions (role + subscription) and a per-request RLS transaction exposed as `req.db`.
// Works with Fastify and with the browser demo's router (it only uses addHook/register).

import type { FastifyPluginAsync, FastifyReply, FastifyRequest, RouteOptions } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { assertCanWrite, isMutation } from '../modules/workspaces/access';
import { withTenant } from './tenant';

export interface TenantRoutesOptions {
  routes: { prefix: string; plugin: FastifyPluginAsyncZod }[];
}

type Handler = (this: unknown, req: FastifyRequest, reply: FastifyReply) => unknown;

export const tenantRoutes: FastifyPluginAsync<TenantRoutesOptions> = async (app, { routes }) => {
  app.addHook('onRequest', app.authenticate);
  app.addHook('onRequest', async (req: FastifyRequest) => {
    if (isMutation(req.method)) assertCanWrite(req.access);
  });
  app.addHook('onRoute', (route: RouteOptions) => {
    const handler = route.handler as Handler;
    route.handler = function tenantHandler(this: unknown, req: FastifyRequest, reply: FastifyReply) {
      return withTenant(app.db, req.workspaceId, async (tx) => {
        req.db = tx;
        return handler.call(this, req, reply);
      });
    } as RouteOptions['handler'];
  });
  for (const { plugin, prefix } of routes) await app.register(plugin, { prefix });
};
