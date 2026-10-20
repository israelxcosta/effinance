// Access tokens (15-min JWT, cookie `effinance_token` or Bearer) and refresh tokens (opaque, rotated,
// cookie `effinance_refresh` restricted to /api/auth). Every authenticated request re-checks that
// the session is alive and the user is still a member of the workspace in the token.

import fp from 'fastify-plugin';
import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { DbExecutor } from '../db/client';
import { env } from '../env';
import { type IssuedSession, REFRESH_TTL_MS, setSessionWorkspace } from '../modules/auth/sessions';
import { type Access, loadAccess } from '../modules/workspaces/access';
import { UnauthorizedError } from './errors';

export const AUTH_COOKIE = 'effinance_token';
export const REFRESH_COOKIE = 'effinance_refresh';
export const ACCESS_TTL_SECONDS = 15 * 60;
const MFA_TTL_SECONDS = 5 * 60;

export interface AccessClaims {
  typ: 'access';
  sub: string;
  /** Active workspace. */
  wid: string;
  /** Session (refresh token family). */
  sid: string;
}

export interface MfaClaims {
  typ: 'mfa';
  sub: string;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AccessClaims | MfaClaims;
    user: AccessClaims | MfaClaims;
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by `app.authenticate`. */
    userId: string;
    workspaceId: string;
    sessionId: string | null;
    access: Access;
    /** Tenant-scoped transaction (RLS) for routes on financial data; see lib/tenant-routes.ts. */
    db: DbExecutor;
  }
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Points the current session at another workspace (new access token). */
    switchSession: (request: FastifyRequest, reply: FastifyReply, workspaceId: string) => Promise<void>;
    /** Forgets the session on the client (cookies). */
    endSession: (request: FastifyRequest, reply: FastifyReply) => void;
  }
}

const secure = env.NODE_ENV === 'production';

export function setAccessCookie(reply: FastifyReply, token: string) {
  reply.setCookie(AUTH_COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax', secure, maxAge: ACCESS_TTL_SECONDS });
}

export function setRefreshCookie(reply: FastifyReply, token: string) {
  reply.setCookie(REFRESH_COOKIE, token, {
    path: '/api/auth',
    httpOnly: true,
    sameSite: 'strict',
    secure,
    maxAge: Math.floor(REFRESH_TTL_MS / 1000),
  });
}

export function clearAuthCookies(reply: FastifyReply) {
  reply.clearCookie(AUTH_COOKIE, { path: '/' });
  reply.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
}

export async function signAccessToken(reply: FastifyReply, claims: Omit<AccessClaims, 'typ'>): Promise<string> {
  return reply.jwtSign({ typ: 'access', ...claims }, { expiresIn: ACCESS_TTL_SECONDS });
}

/** Sets both cookies for a new/rotated session and returns the access token (for Bearer clients). */
export async function issueSessionCookies(reply: FastifyReply, session: IssuedSession, workspaceId: string): Promise<string> {
  const token = await signAccessToken(reply, { sub: session.userId, wid: workspaceId, sid: session.familyId });
  setAccessCookie(reply, token);
  setRefreshCookie(reply, session.refreshToken);
  return token;
}

export async function signMfaToken(reply: FastifyReply, userId: string): Promise<string> {
  return reply.jwtSign({ typ: 'mfa', sub: userId }, { expiresIn: MFA_TTL_SECONDS });
}

export const authPlugin = fp(async (app) => {
  await app.register(fastifyCookie);
  await app.register(fastifyJwt, {
    secret: env.JWT_SECRET,
    sign: { algorithm: 'HS256' },
    verify: { algorithms: ['HS256'] },
    // Reads the httpOnly cookie when no Authorization header is present.
    cookie: { cookieName: AUTH_COOKIE, signed: false },
  });

  app.decorateRequest('userId', '');
  app.decorateRequest('workspaceId', '');
  app.decorateRequest('sessionId', null);
  app.decorateRequest('access', null as never);
  app.decorateRequest('db', null as never);

  app.decorate('authenticate', async (request: FastifyRequest) => {
    let claims: AccessClaims | MfaClaims;
    try {
      claims = await request.jwtVerify<AccessClaims | MfaClaims>();
    } catch {
      throw new UnauthorizedError();
    }
    if (claims.typ !== 'access' || !claims.wid || !claims.sid) throw new UnauthorizedError();
    const access = await loadAccess(app.db, claims.sub, claims.wid, claims.sid);
    // Revoked session or membership removed: the client refreshes (which picks a valid workspace).
    if (!access) throw new UnauthorizedError();
    request.userId = claims.sub;
    request.workspaceId = claims.wid;
    request.sessionId = claims.sid;
    request.access = access;
  });

  app.decorate('switchSession', async (request: FastifyRequest, reply: FastifyReply, workspaceId: string) => {
    if (!request.sessionId) throw new UnauthorizedError();
    await setSessionWorkspace(app.db, request.sessionId, workspaceId);
    const token = await signAccessToken(reply, { sub: request.userId, wid: workspaceId, sid: request.sessionId });
    setAccessCookie(reply, token);
  });

  app.decorate('endSession', (_request: FastifyRequest, reply: FastifyReply) => clearAuthCookies(reply));
});
