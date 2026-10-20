import Fastify, { type FastifyError, type FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { Redis } from 'ioredis';
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
import { configureKeyring } from './lib/crypto/keyring';
import { AppError, ForbiddenError } from './lib/errors';
import type { Platform } from './lib/platform';
import { tenantRoutes } from './lib/tenant-routes';
import { authRoutes } from './modules/auth/routes';
import { billingRoutes } from './modules/billing/routes';
import { isMutation } from './modules/workspaces/access';
import { inviteRoutes, workspaceRoutes } from './modules/workspaces/routes';
import { domainRoutes } from './routes';
import { createKeyProvider, createPlatform } from './setup';

declare module 'fastify' {
  interface FastifyInstance {
    /** System connection (owner role). Financial data is only touched through `req.db` (RLS). */
    db: Database;
  }
}

export interface BuildAppOptions {
  logger?: FastifyServerOptions['logger'];
  /** Overrides of the services built from env (tests). */
  platform?: Partial<Platform>;
}

export async function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    logger: options.logger ?? {
      level: env.LOG_LEVEL,
      redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
      ...(env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
    },
    // Only the first N hops (load balancer) may set X-Forwarded-For; a client cannot spoof its IP.
    trustProxy: (_address: string, hop: number) => hop < env.TRUST_PROXY,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const { db, client } = createDb();
  app.decorate('db', db);
  configureKeyring({ provider: await createKeyProvider(env, (m) => app.log.warn(m)), db });
  app.decorate('platform', { ...(await createPlatform(env)), ...options.platform });
  const redis = env.REDIS_URL ? new Redis(env.REDIS_URL, { lazyConnect: false, maxRetriesPerRequest: 1 }) : null;
  app.addHook('onClose', async () => {
    await client.end({ timeout: 5 });
    await redis?.quit();
  });

  // The API only serves JSON: lock everything a browser could render or embed.
  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"], formAction: ["'none'"] },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
    hsts: env.NODE_ENV === 'production' ? { maxAge: 31_536_000, includeSubDomains: true, preload: true } : false,
  });
  await app.register(cors, { origin: env.CORS_ORIGIN, credentials: true });
  await app.register(rateLimit, { global: false, ...(redis ? { redis } : {}) });

  // CSRF: cookies are SameSite, and in addition every state-changing request must come from an
  // allowed origin (when the browser says where it comes from) and carry JSON — a cross-site form
  // or a "simple" text/plain request is rejected.
  app.addHook('onRequest', async (req) => {
    if (!isMutation(req.method)) return;
    const origin = req.headers.origin;
    if (origin && !env.CORS_ORIGIN.includes(origin)) throw new ForbiddenError('Origem não permitida');
    const hasBody = Number(req.headers['content-length'] ?? 0) > 0 || req.headers['transfer-encoding'] !== undefined;
    const type = String(req.headers['content-type'] ?? '').toLowerCase();
    if (hasBody && !type.startsWith('application/json')) {
      throw new AppError(415, 'unsupported_media_type', 'Envie os dados em JSON');
    }
  });

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
      return reply.code(429).send({ error: 'too_many_requests', message: 'Muitas tentativas. Aguarde um pouco.' });
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
      await api.register(workspaceRoutes, { prefix: '/workspaces' });
      await api.register(inviteRoutes, { prefix: '/invites' });
      await api.register(billingRoutes, { prefix: '/billing' });
      await api.register(tenantRoutes, { routes: domainRoutes });
    },
    { prefix: '/api' },
  );

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
