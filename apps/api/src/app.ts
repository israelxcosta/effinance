import Fastify, { type FastifyError, type FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import {
  hasZodFastifySchemaValidationErrors,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { ApiError } from '@effinance/shared';
import { env } from './env';
import { createDb, type Database } from './db/client';
import { authPlugin } from './lib/auth';
import { AppError } from './lib/errors';
import { authRoutes } from './modules/auth/routes';
import { domainRoutes } from './routes';

declare module 'fastify' {
  interface FastifyInstance {
    db: Database;
  }
}

export interface BuildAppOptions {
  logger?: FastifyServerOptions['logger'];
}

export async function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    logger: options.logger ?? {
      level: env.LOG_LEVEL,
      redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
      ...(env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
    },
    trustProxy: true,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const { db, client } = createDb();
  app.decorate('db', db);
  app.addHook('onClose', async () => {
    await client.end({ timeout: 5 });
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: env.CORS_ORIGIN, credentials: true });
  await app.register(rateLimit, { global: false });
  await app.register(authPlugin);

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      const body: ApiError = {
        error: 'validation_error',
        message: error.validation[0]?.message ?? 'Dados inválidos',
        details: error.validation.map((v) => ({
          path: v.instancePath.replace(/^\//, '').replace(/\//g, '.'),
          message: v.message,
        })),
      };
      return reply.code(400).send(body);
    }
    if (error instanceof AppError) {
      const body: ApiError = { error: error.code, message: error.message, details: error.details };
      return reply.code(error.statusCode).send(body);
    }
    if (error.statusCode === 429) {
      return reply.code(429).send({ error: 'too_many_requests', message: 'Muitas tentativas. Aguarde um minuto.' });
    }
    if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
      return reply.code(error.statusCode).send({ error: error.code ?? 'bad_request', message: error.message });
    }
    request.log.error({ err: error }, 'unhandled error');
    const body: ApiError = { error: 'internal_error', message: 'Erro inesperado. Tente novamente.' };
    return reply.code(500).send(body);
  });

  app.setNotFoundHandler((_req, reply) => {
    reply.code(404).send({ error: 'not_found', message: 'Rota não encontrada' } satisfies ApiError);
  });

  await app.register(
    async (api) => {
      api.get('/health', async () => ({ status: 'ok' }));
      await api.register(authRoutes, { prefix: '/auth' });
      for (const { plugin, prefix } of domainRoutes) await api.register(plugin, { prefix });
    },
    { prefix: '/api' },
  );

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
