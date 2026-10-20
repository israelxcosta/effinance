// Demo counterpart of apps/api/src/modules/auth/routes.ts: same services, session kept locally.

import { loginSchema, registerSchema, updateProfileSchema } from '@effinance/shared';
import { getUser, login, register, updateProfile } from '@api/modules/auth/service';
import type { Database } from '@api/db/client';
import type { DemoReply, DemoRequest, DemoScope } from './fake-fastify';
import { setSessionUserId } from './session';

type Scope = DemoScope & { db: Database; authenticate: (req: DemoRequest) => Promise<void> };

export async function demoAuthRoutes(app: Scope) {
  app.post('/register', { schema: { body: registerSchema } }, async (req: DemoRequest, reply: DemoReply) => {
    const user = await register(app.db, req.body as never);
    setSessionUserId(user.id);
    return reply.code(201).send({ user, token: 'demo' });
  });

  app.post('/login', { schema: { body: loginSchema } }, async (req: DemoRequest) => {
    const user = await login(app.db, req.body as never);
    setSessionUserId(user.id);
    return { user, token: 'demo' };
  });

  app.post('/logout', async (_req: DemoRequest, reply: DemoReply) => {
    setSessionUserId(null);
    return reply.code(204).send();
  });

  app.get('/me', { onRequest: [app.authenticate] }, async (req: DemoRequest) => getUser(app.db, req.userId));

  app.put(
    '/me',
    { onRequest: [app.authenticate], schema: { body: updateProfileSchema } },
    async (req: DemoRequest) => updateProfile(app.db, req.userId, req.body as never),
  );
}
