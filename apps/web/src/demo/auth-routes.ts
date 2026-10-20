// Demo counterpart of apps/api/src/modules/auth/routes.ts: the same services (accounts, sessions,
// MFA, password reset), with the session kept in localStorage instead of cookies/JWT.

import {
  changePasswordSchema,
  deleteAccountSchema,
  forgotPasswordSchema,
  loginSchema,
  mfaCodeSchema,
  mfaVerifySchema,
  registerSchema,
  resetPasswordSchema,
  switchWorkspaceSchema,
  updateProfileSchema,
} from '@effinance/shared';
import type { Database } from '@api/db/client';
import type { UserRow } from '@api/db/schema';
import { audit } from '@api/lib/audit';
import { randomToken } from '@api/lib/crypto/encoding';
import { UnauthorizedError } from '@api/lib/errors';
import type { Platform } from '@api/lib/platform';
import { requestContext } from '@api/lib/request-context';
import { disableMfa, enableMfa, setupMfa, verifyMfaCode } from '@api/modules/auth/mfa';
import {
  changePassword,
  checkPassword,
  deleteAccount,
  register,
  requestPasswordReset,
  resetPassword,
  toUser,
  updateProfile,
} from '@api/modules/auth/service';
import { createSession, listSessions, revokeFamily, revokeUserSession, setSessionWorkspace } from '@api/modules/auth/sessions';
import { cancelForDeletion } from '@api/modules/billing/service';
import { getMe, getUserRow, resolveWorkspaceFor, switchWorkspace } from '@api/modules/workspaces/service';
import type { DemoReply, DemoRequest, DemoScope } from './fake-fastify';
import { getSession, setSession } from './session';

type Scope = DemoScope & {
  db: Database;
  platform: Platform;
  authenticate: (req: DemoRequest) => Promise<void>;
  switchSession: (req: DemoRequest, reply: DemoReply, workspaceId: string) => Promise<void>;
};

const MFA_TTL_MS = 5 * 60_000;
/** Pending second factor: token → user (stands in for the API's short-lived MFA JWT). */
const mfaChallenges = new Map<string, { userId: string; expires: number }>();

export async function demoAuthRoutes(app: Scope) {
  async function startSession(req: DemoRequest, user: UserRow) {
    const workspaceId = await resolveWorkspaceFor(app.db, user.id);
    if (!workspaceId) throw new UnauthorizedError('Sua conta não participa de nenhum espaço');
    const session = await createSession(app.db, { userId: user.id, workspaceId, ...requestContext(req) });
    setSession({ userId: user.id, workspaceId, sessionId: session.familyId });
    await audit(app.db, { ...requestContext(req), action: 'auth.login', userId: user.id, workspaceId });
    return { user: toUser(user), token: 'demo' };
  }

  app.post('/register', { schema: { body: registerSchema } }, async (req: DemoRequest, reply: DemoReply) => {
    const { user, workspaceId } = await register(app.db, req.body as never);
    const session = await createSession(app.db, { userId: user.id, workspaceId, ...requestContext(req) });
    setSession({ userId: user.id, workspaceId, sessionId: session.familyId });
    await audit(app.db, { ...requestContext(req), action: 'auth.register', userId: user.id, workspaceId });
    return reply.code(201).send({ user: toUser(user), token: 'demo' });
  });

  app.post('/login', { schema: { body: loginSchema } }, async (req: DemoRequest) => {
    const user = await checkPassword(app.db, req.body as never);
    if (user.mfaEnabled) {
      const mfaToken = randomToken();
      mfaChallenges.set(mfaToken, { userId: user.id, expires: Date.now() + MFA_TTL_MS });
      return { mfaRequired: true, mfaToken };
    }
    return startSession(req, user);
  });

  app.post('/mfa/verify', { schema: { body: mfaVerifySchema } }, async (req: DemoRequest) => {
    const { mfaToken, code } = req.body as { mfaToken: string; code: string };
    const challenge = mfaChallenges.get(mfaToken);
    if (!challenge || challenge.expires < Date.now()) throw new UnauthorizedError('A verificação expirou. Entre novamente.');
    const user = await getUserRow(app.db, challenge.userId);
    if (!(await verifyMfaCode(app.db, user, code))) throw new UnauthorizedError('Código inválido');
    mfaChallenges.delete(mfaToken);
    return startSession(req, user);
  });

  // No access token to renew: the session is valid while its row is. Re-picks the workspace when the
  // membership was removed.
  app.post('/refresh', async (_req: DemoRequest, reply: DemoReply) => {
    const session = getSession();
    if (!session) throw new UnauthorizedError();
    const active = (await listSessions(app.db, session.userId, session.sessionId)).some((s) => s.current);
    const workspaceId = active ? await resolveWorkspaceFor(app.db, session.userId, session.workspaceId) : null;
    if (!workspaceId) {
      setSession(null);
      throw new UnauthorizedError();
    }
    if (workspaceId !== session.workspaceId) {
      await setSessionWorkspace(app.db, session.sessionId, workspaceId);
      setSession({ ...session, workspaceId });
    }
    return reply.code(204).send();
  });

  app.post('/logout', async (_req: DemoRequest, reply: DemoReply) => {
    const session = getSession();
    if (session) await revokeFamily(app.db, session.sessionId);
    setSession(null);
    return reply.code(204).send();
  });

  app.post('/password/forgot', { schema: { body: forgotPasswordSchema } }, async (req: DemoRequest, reply: DemoReply) => {
    const result = await requestPasswordReset(app.db, (req.body as { email: string }).email);
    if (result) {
      await app.platform.mailer.send({
        to: result.user.email,
        subject: 'Redefinição de senha — Effinance',
        text: `Link de redefinição (demo): ${app.platform.appUrl}/redefinir-senha?token=${result.token}`,
      });
    }
    return reply.code(204).send();
  });

  app.post('/password/reset', { schema: { body: resetPasswordSchema } }, async (req: DemoRequest, reply: DemoReply) => {
    const { token, password } = req.body as { token: string; password: string };
    await resetPassword(app.db, token, password);
    return reply.code(204).send();
  });

  // ------------------------------------------------------------------ authenticated

  await app.register(async (authed: Scope) => {
    authed.addHook('onRequest', app.authenticate);

    authed.get('/me', async (req: DemoRequest) => getMe(app.db, req.userId, req.workspaceId));

    authed.put('/me', { schema: { body: updateProfileSchema } }, async (req: DemoRequest) =>
      updateProfile(app.db, req.userId, req.body as never),
    );

    authed.delete('/me', { schema: { body: deleteAccountSchema } }, async (req: DemoRequest, reply: DemoReply) => {
      await deleteAccount(app.db, req.userId, (req.body as { password: string }).password, (ids) =>
        cancelForDeletion(app.db, app.platform, ids),
      );
      setSession(null);
      return reply.code(204).send();
    });

    authed.post('/password', { schema: { body: changePasswordSchema } }, async (req: DemoRequest, reply: DemoReply) => {
      await changePassword(app.db, req.userId, req.sessionId, req.body as never);
      await audit(app.db, { ...requestContext(req), action: 'auth.password_changed', userId: req.userId });
      return reply.code(204).send();
    });

    authed.get('/sessions', async (req: DemoRequest) => listSessions(app.db, req.userId, req.sessionId));

    authed.delete('/sessions/:id', async (req: DemoRequest, reply: DemoReply) => {
      const { id } = req.params as { id: string };
      if (!(await revokeUserSession(app.db, req.userId, id))) throw new UnauthorizedError('Sessão não encontrada');
      if (id === req.sessionId) setSession(null);
      return reply.code(204).send();
    });

    authed.post('/mfa/setup', async (req: DemoRequest) => setupMfa(app.db, req.userId));

    authed.post('/mfa/enable', { schema: { body: mfaCodeSchema } }, async (req: DemoRequest) =>
      enableMfa(app.db, req.userId, (req.body as { code: string }).code),
    );

    authed.post('/mfa/disable', { schema: { body: mfaCodeSchema } }, async (req: DemoRequest, reply: DemoReply) => {
      await disableMfa(app.db, req.userId, (req.body as { code: string }).code);
      return reply.code(204).send();
    });

    authed.post('/switch-workspace', { schema: { body: switchWorkspaceSchema } }, async (req: DemoRequest, reply: DemoReply) => {
      const { workspaceId } = req.body as { workspaceId: string };
      await switchWorkspace(app.db, req.userId, workspaceId);
      await app.switchSession(req, reply, workspaceId);
      return getMe(app.db, req.userId, workspaceId);
    });
  });
}
