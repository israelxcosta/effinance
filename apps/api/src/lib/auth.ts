import fp from 'fastify-plugin';
import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../env';
import { UnauthorizedError } from './errors';

export const AUTH_COOKIE = 'effinance_token';
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7;

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string };
    user: { sub: string };
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Authenticated user id (set by `app.authenticate`). */
    userId: string;
  }
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export const authPlugin = fp(async (app) => {
  await app.register(fastifyCookie);
  await app.register(fastifyJwt, {
    secret: env.JWT_SECRET,
    sign: { expiresIn: TOKEN_TTL_SECONDS },
    // Reads the httpOnly cookie when no Authorization header is present.
    cookie: { cookieName: AUTH_COOKIE, signed: false },
  });

  app.decorateRequest('userId', '');
  app.decorate('authenticate', async (request: FastifyRequest) => {
    try {
      const payload = await request.jwtVerify<{ sub: string }>();
      request.userId = payload.sub;
    } catch {
      throw new UnauthorizedError();
    }
  });
});

export function setAuthCookie(reply: FastifyReply, token: string) {
  reply.setCookie(AUTH_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    maxAge: TOKEN_TTL_SECONDS,
  });
}

export function clearAuthCookie(reply: FastifyReply) {
  reply.clearCookie(AUTH_COOKIE, { path: '/' });
}
