// Mounts the financial route plugins inside the tenant boundary: authentication, write
// permissions (role + subscription) and a per-request RLS transaction exposed as `req.db`.
// Works with Fastify and with the browser demo's router (it only uses addHook/register).

import type { FastifyPluginAsync, FastifyReply, FastifyRequest, RouteOptions } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { assertCanWrite, isMutation } from '../modules/workspaces/access';
import { getCipher } from './crypto/keyring';
import { withTenant } from './tenant';

export interface TenantRoutesOptions {
  routes: { prefix: string; plugin: FastifyPluginAsyncZod }[];
}

type Handler = (this: unknown, req: FastifyRequest, reply: FastifyReply) => unknown;

/** What the deferred `reply.send` hands back to the route handler (not the reply, see below). */
const DEFERRED = Object.freeze({ deferredUntilCommit: true });

export const tenantRoutes: FastifyPluginAsync<TenantRoutesOptions> = async (app, { routes }) => {
  app.addHook('onRequest', app.authenticate);
  app.addHook('onRequest', async (req: FastifyRequest) => {
    if (isMutation(req.method)) assertCanWrite(req.access);
  });
  app.addHook('onRoute', (route: RouteOptions) => {
    const handler = route.handler as Handler;
    route.handler = async function tenantHandler(this: unknown, req: FastifyRequest, reply: FastifyReply) {
      // Unwrap the data key before opening the transaction: no key-provider call (KMS) while holding
      // a connection, and no lookup on the system connection from inside it (single-connection PGlite).
      await getCipher(req.workspaceId);
      // Nothing reaches the client before COMMIT. Handlers call `reply.code(201).send(x)` inside the
      // transaction: sending right away would answer before the commit (the client's next request
      // may not see the row yet) and a later failure would roll back a write already reported as
      // done. So `send` only records the payload until the transaction ends, and the reply stops
      // being a thenable meanwhile (`return reply` would otherwise wait for a response not sent yet).
      const shadow = reply as unknown as Record<string, unknown>;
      let deferred: { payload: unknown } | null = null;
      const result = await withTenant(app.db, req.workspaceId, async (tx) => {
        req.db = tx;
        shadow.send = (payload?: unknown) => {
          deferred = { payload };
          return DEFERRED;
        };
        shadow.then = undefined;
        try {
          const out = await handler.call(this, req, reply);
          // Never let the reply itself flow out as a value: once it is a thenable again, resolving
          // a promise with it would wait for the (deferred) response.
          return out === reply ? DEFERRED : out;
        } finally {
          delete shadow.send;
          delete shadow.then;
        }
      });
      const pending = deferred as { payload: unknown } | null;
      if (pending) return reply.send(pending.payload);
      return result === DEFERRED ? undefined : result;
    } as RouteOptions['handler'];
  });
  for (const { plugin, prefix } of routes) await app.register(plugin, { prefix });
};
