import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { loginSchema, registerSchema, updateProfileSchema } from '@effinance/shared';
import { env } from '../../env';
import { clearAuthCookie, setAuthCookie } from '../../lib/auth';
import { getUser, login, register, updateProfile } from './service';

const authRateLimit = {
  rateLimit: { max: env.NODE_ENV === 'test' ? 1000 : 10, timeWindow: '1 minute' },
};

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post('/register', { schema: { body: registerSchema }, config: authRateLimit }, async (req, reply) => {
    const user = await register(app.db, req.body);
    const token = await reply.jwtSign({ sub: user.id });
    setAuthCookie(reply, token);
    return reply.code(201).send({ user, token });
  });

  app.post('/login', { schema: { body: loginSchema }, config: authRateLimit }, async (req, reply) => {
    const user = await login(app.db, req.body);
    const token = await reply.jwtSign({ sub: user.id });
    setAuthCookie(reply, token);
    return { user, token };
  });

  app.post('/logout', async (_req, reply) => {
    clearAuthCookie(reply);
    return reply.code(204).send();
  });

  app.get('/me', { onRequest: [app.authenticate] }, async (req) => getUser(app.db, req.userId));

  app.put('/me', { onRequest: [app.authenticate], schema: { body: updateProfileSchema } }, async (req) =>
    updateProfile(app.db, req.userId, req.body),
  );
};
