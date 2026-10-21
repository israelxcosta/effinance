import { eq } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  changePasswordSchema,
  deleteAccountSchema,
  forgotPasswordSchema,
  idSchema,
  loginSchema,
  mfaCodeSchema,
  mfaVerifySchema,
  registerSchema,
  resetPasswordSchema,
  switchWorkspaceSchema,
  updateProfileSchema,
  type AuthResponse,
  type MfaChallengeResponse,
} from '@effinance/shared';
import { sessions, type UserRow } from '../../db/schema';
import { env } from '../../env';
import { audit } from '../../lib/audit';
import {
  REFRESH_COOKIE,
  clearAuthCookies,
  issueSessionCookies,
  signMfaToken,
  type AccessClaims,
  type MfaClaims,
} from '../../lib/auth';
import { sha256Hex } from '../../lib/crypto/encoding';
import { UnauthorizedError } from '../../lib/errors';
import { requestContext } from '../../lib/request-context';
import { prepareWorkspaceDeletion } from '../workspaces/deletion';
import { getMe, getUserRow, resolveWorkspaceFor, switchWorkspace } from '../workspaces/service';
import { disableMfa, enableMfa, setupMfa, verifyMfaCode } from './mfa';
import {
  changePassword,
  checkPassword,
  deleteAccount,
  register,
  requestPasswordReset,
  resetPassword,
  toUser,
  updateProfile,
} from './service';
import {
  createSession,
  listSessions,
  revokeFamily,
  revokeUserSession,
  rotateSession,
  setSessionWorkspace,
} from './sessions';

const relaxed = env.NODE_ENV === 'test';
const limit = (max: number, timeWindow = '1 minute') => ({ rateLimit: { max: relaxed ? 1000 : max, timeWindow } });

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  /** Opens a session on the user's preferred workspace and sets the cookies. */
  async function startSession(req: FastifyRequest, reply: FastifyReply, user: UserRow, method: string): Promise<AuthResponse> {
    const workspaceId = await resolveWorkspaceFor(app.db, user.id);
    if (!workspaceId) throw new UnauthorizedError('Sua conta não participa de nenhum espaço');
    const session = await createSession(app.db, { userId: user.id, workspaceId, ...requestContext(req) });
    const token = await issueSessionCookies(reply, session, workspaceId);
    await audit(app.db, { ...requestContext(req), action: 'auth.login', userId: user.id, workspaceId, metadata: { method } });
    return { user: toUser(user), token };
  }

  app.post('/register', { schema: { body: registerSchema }, config: limit(5) }, async (req, reply) => {
    const { user, workspaceId } = await register(app.db, req.body);
    const session = await createSession(app.db, { userId: user.id, workspaceId, ...requestContext(req) });
    const token = await issueSessionCookies(reply, session, workspaceId);
    await audit(app.db, { ...requestContext(req), action: 'auth.register', userId: user.id, workspaceId });
    return reply.code(201).send({ user: toUser(user), token } satisfies AuthResponse);
  });

  app.post('/login', { schema: { body: loginSchema }, config: limit(10) }, async (req, reply) => {
    let user: UserRow;
    try {
      user = await checkPassword(app.db, req.body);
    } catch (error) {
      await audit(app.db, { ...requestContext(req), action: 'auth.login_failed' });
      throw error;
    }
    if (user.mfaEnabled) {
      return { mfaRequired: true, mfaToken: await signMfaToken(reply, user.id) } satisfies MfaChallengeResponse;
    }
    return startSession(req, reply, user, 'password');
  });

  app.post('/mfa/verify', { schema: { body: mfaVerifySchema }, config: limit(5) }, async (req, reply) => {
    let claims: MfaClaims;
    try {
      claims = app.jwt.verify<MfaClaims>(req.body.mfaToken);
    } catch {
      throw new UnauthorizedError('A verificação expirou. Entre novamente.');
    }
    if (claims.typ !== 'mfa') throw new UnauthorizedError('A verificação expirou. Entre novamente.');
    const user = await getUserRow(app.db, claims.sub);
    // Per-account attempt budget and failure audit live in verifyMfaCode (429 when exhausted).
    const method = await verifyMfaCode(app.db, user, req.body.code, requestContext(req));
    if (!method) throw new UnauthorizedError('Código inválido');
    return startSession(req, reply, user, method === 'recovery' ? 'mfa_recovery' : 'mfa');
  });

  app.post('/refresh', { config: limit(30) }, async (req, reply) => {
    const token = req.cookies[REFRESH_COOKIE];
    if (!token) throw new UnauthorizedError();
    const result = await rotateSession(app.db, token, requestContext(req));
    if (result.status === 'grace') return reply.code(204).send();
    if (result.status !== 'rotated') {
      clearAuthCookies(reply);
      if (result.status === 'reuse') {
        await audit(app.db, {
          ...requestContext(req),
          action: 'auth.refresh_token_reuse',
          userId: result.userId,
          entity: 'session',
          entityId: result.familyId,
        });
      }
      throw new UnauthorizedError();
    }
    const { session } = result;
    // The membership may have been removed since: fall back to another workspace of the user.
    const workspaceId = await resolveWorkspaceFor(app.db, session.userId, session.workspaceId);
    if (!workspaceId) {
      await revokeFamily(app.db, session.familyId);
      clearAuthCookies(reply);
      throw new UnauthorizedError();
    }
    if (workspaceId !== session.workspaceId) await setSessionWorkspace(app.db, session.familyId, workspaceId);
    await issueSessionCookies(reply, session, workspaceId);
    return reply.code(204).send();
  });

  app.post('/logout', async (req, reply) => {
    const token = req.cookies[REFRESH_COOKIE];
    if (token) {
      const [row] = await app.db.select().from(sessions).where(eq(sessions.tokenHash, await sha256Hex(token)));
      if (row) {
        await revokeFamily(app.db, row.familyId);
        await audit(app.db, { ...requestContext(req), action: 'auth.logout', userId: row.userId, entity: 'session', entityId: row.familyId });
      }
    } else {
      try {
        const claims = await req.jwtVerify<AccessClaims | MfaClaims>();
        if (claims.typ === 'access') await revokeFamily(app.db, claims.sid);
      } catch {
        // already signed out
      }
    }
    clearAuthCookies(reply);
    return reply.code(204).send();
  });

  app.post('/password/forgot', { schema: { body: forgotPasswordSchema }, config: limit(5, '15 minutes') }, async (req, reply) => {
    const result = await requestPasswordReset(app.db, req.body.email, requestContext(req));
    if (result) {
      // In the fragment: never sent to the server/CDN (no access logs) nor leaked in Referer headers.
      const link = `${app.platform.appUrl}/redefinir-senha#token=${result.token}`;
      // Not awaited: the answer must take the same time whether or not the e-mail has an account
      // (waiting for SES/the webhook would reveal it). Delivery failures are logged.
      app.platform.mailer
        .send({
          to: result.user.email,
          subject: 'Redefinição de senha — Effinance',
          text: `Olá, ${result.user.name}.\n\nPara criar uma nova senha, acesse o link abaixo (válido por 30 minutos):\n${link}\n\nSe você não pediu a redefinição, ignore este e-mail.`,
        })
        .catch((err: unknown) => req.log.error({ err }, 'password reset e-mail failed'));
    }
    return reply.code(204).send();
  });

  app.post('/password/reset', { schema: { body: resetPasswordSchema }, config: limit(10, '15 minutes') }, async (req, reply) => {
    const userId = await resetPassword(app.db, req.body.token, req.body.password);
    await audit(app.db, { ...requestContext(req), action: 'auth.password_reset', userId });
    return reply.code(204).send();
  });

  // ------------------------------------------------------------------ authenticated

  const authenticated: FastifyPluginAsyncZod = async (authed) => {
    authed.addHook('onRequest', app.authenticate);

    authed.get('/me', async (req) => getMe(app.db, req.userId, req.workspaceId));

    authed.put('/me', { schema: { body: updateProfileSchema } }, async (req) => updateProfile(app.db, req.userId, req.body));

    authed.delete('/me', { schema: { body: deleteAccountSchema }, config: limit(5) }, async (req, reply) => {
      const deleted = await deleteAccount(app.db, req.userId, req.body.password, (ids) =>
        prepareWorkspaceDeletion(app.db, app.platform, ids, req.log),
      );
      await audit(app.db, {
        ...requestContext(req),
        action: 'account.deleted',
        entity: 'user',
        entityId: req.userId,
        metadata: { deletedWorkspaces: deleted.length },
      });
      clearAuthCookies(reply);
      return reply.code(204).send();
    });

    authed.post('/password', { schema: { body: changePasswordSchema }, config: limit(5) }, async (req, reply) => {
      await changePassword(app.db, req.userId, req.sessionId, req.body);
      await audit(app.db, { ...requestContext(req), action: 'auth.password_changed', userId: req.userId });
      return reply.code(204).send();
    });

    authed.get('/sessions', async (req) => listSessions(app.db, req.userId, req.sessionId));

    authed.delete('/sessions/:id', { schema: { params: z.object({ id: idSchema }) } }, async (req, reply) => {
      if (!(await revokeUserSession(app.db, req.userId, req.params.id))) throw new UnauthorizedError('Sessão não encontrada');
      await audit(app.db, {
        ...requestContext(req),
        action: 'auth.session_revoked',
        userId: req.userId,
        entity: 'session',
        entityId: req.params.id,
      });
      if (req.params.id === req.sessionId) clearAuthCookies(reply);
      return reply.code(204).send();
    });

    authed.post('/mfa/setup', async (req) => setupMfa(app.db, req.userId));

    authed.post('/mfa/enable', { schema: { body: mfaCodeSchema }, config: limit(10) }, async (req) => {
      const result = await enableMfa(app.db, req.userId, req.body.code, {
        password: req.body.password,
        sessionId: req.sessionId,
      });
      await audit(app.db, { ...requestContext(req), action: 'auth.mfa_enabled', userId: req.userId });
      return result;
    });

    authed.post('/mfa/disable', { schema: { body: mfaCodeSchema }, config: limit(10) }, async (req, reply) => {
      await disableMfa(app.db, req.userId, req.body.code, requestContext(req));
      await audit(app.db, { ...requestContext(req), action: 'auth.mfa_disabled', userId: req.userId });
      return reply.code(204).send();
    });

    authed.post('/switch-workspace', { schema: { body: switchWorkspaceSchema } }, async (req, reply) => {
      await switchWorkspace(app.db, req.userId, req.body.workspaceId);
      await app.switchSession(req, reply, req.body.workspaceId);
      return getMe(app.db, req.userId, req.body.workspaceId);
    });
  };
  await app.register(authenticated);
};
