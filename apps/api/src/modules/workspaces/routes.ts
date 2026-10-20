// Workspaces, members, invites, export and audit. Shared by the API and the browser demo, so it
// relies only on app decorations (db, platform, authenticate, switchSession), never on env.

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  auditQuerySchema,
  deleteWorkspaceSchema,
  idSchema,
  inviteInputSchema,
  memberRoleSchema,
  workspaceInputSchema,
  workspaceUpdateSchema,
  WORKSPACE_KIND_LABELS,
} from '@effinance/shared';
import { audit } from '../../lib/audit';
import { ValidationError } from '../../lib/errors';
import { requestContext } from '../../lib/request-context';
import { cancelForDeletion } from '../billing/service';
import { assertCanWrite, assertOwner } from './access';
import { exportWorkspace } from './export';
import {
  acceptInvite,
  changeMemberRole,
  createInvite,
  createSharedWorkspace,
  deleteWorkspaceRow,
  getMe,
  inviteUrl,
  listAudit,
  listInvites,
  listMembers,
  listWorkspaceSummaries,
  previewInvite,
  removeMember,
  renameWorkspace,
  resolveWorkspaceFor,
  revokeInvite,
} from './service';

const userParams = z.object({ userId: idSchema });
const tokenParams = z.object({ token: z.string().min(20).max(200) });

export const workspaceRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', app.authenticate);

  const summaryOf = async (userId: string, workspaceId: string) =>
    (await listWorkspaceSummaries(app.db, userId)).find((w) => w.id === workspaceId)!;

  app.get('/', async (req) => listWorkspaceSummaries(app.db, req.userId));

  app.post('/', { schema: { body: workspaceInputSchema } }, async (req, reply) => {
    const id = await createSharedWorkspace(app.db, req.userId, req.body);
    await audit(app.db, { ...requestContext(req), action: 'workspace.created', workspaceId: id, userId: req.userId, entity: 'workspace', entityId: id, metadata: { kind: req.body.kind } });
    return reply.code(201).send(await summaryOf(req.userId, id));
  });

  app.put('/current', { schema: { body: workspaceUpdateSchema } }, async (req) => {
    assertOwner(req.access);
    await renameWorkspace(app.db, req.access, req.body.name);
    await audit(app.db, { ...requestContext(req), action: 'workspace.renamed', workspaceId: req.workspaceId, userId: req.userId, entity: 'workspace', entityId: req.workspaceId });
    return summaryOf(req.userId, req.workspaceId);
  });

  app.delete('/current', { schema: { body: deleteWorkspaceSchema } }, async (req, reply) => {
    assertOwner(req.access);
    if (req.access.workspaceKind === 'personal') {
      throw new ValidationError('O espaço pessoal só pode ser excluído junto com a sua conta');
    }
    if (req.body.confirmName.trim() !== req.access.workspaceName.trim()) {
      throw new ValidationError('Digite o nome do espaço exatamente como aparece para confirmar');
    }
    await cancelForDeletion(app.db, app.platform, [req.workspaceId]);
    await deleteWorkspaceRow(app.db, req.workspaceId);
    await audit(app.db, { ...requestContext(req), action: 'workspace.deleted', userId: req.userId, entity: 'workspace', entityId: req.workspaceId });
    const next = await resolveWorkspaceFor(app.db, req.userId);
    if (next) await app.switchSession(req, reply, next);
    return reply.code(204).send();
  });

  // ------------------------------------------------------------------ members

  app.get('/current/members', async (req) => listMembers(app.db, req.access));

  app.patch('/current/members/:userId', { schema: { params: userParams, body: memberRoleSchema } }, async (req) => {
    assertOwner(req.access);
    const member = await changeMemberRole(app.db, req.access, req.params.userId, req.body.role);
    await audit(app.db, { ...requestContext(req), action: 'member.role_changed', workspaceId: req.workspaceId, userId: req.userId, entity: 'user', entityId: req.params.userId, metadata: { role: req.body.role } });
    return member;
  });

  app.delete('/current/members/:userId', { schema: { params: userParams } }, async (req, reply) => {
    const result = await removeMember(app.db, req.access, req.params.userId);
    await audit(app.db, { ...requestContext(req), action: result === 'left' ? 'member.left' : 'member.removed', workspaceId: req.workspaceId, userId: req.userId, entity: 'user', entityId: req.params.userId });
    if (result === 'left') {
      const next = await resolveWorkspaceFor(app.db, req.userId);
      if (next) await app.switchSession(req, reply, next);
    }
    return reply.code(204).send();
  });

  // ------------------------------------------------------------------ invites

  app.get('/current/invites', async (req) => {
    assertOwner(req.access);
    return listInvites(app.db, req.access);
  });

  app.post('/current/invites', { schema: { body: inviteInputSchema } }, async (req, reply) => {
    assertOwner(req.access);
    assertCanWrite(req.access);
    const { invite, token } = await createInvite(app.db, req.access, req.body);
    const url = inviteUrl(app.platform.appUrl, token);
    const kind = WORKSPACE_KIND_LABELS[req.access.workspaceKind].toLowerCase();
    await app.platform.mailer.send({
      to: invite.email,
      subject: `Convite para o espaço "${req.access.workspaceName}" no Effinance`,
      text: `Você foi convidado(a) para participar do espaço ${kind} "${req.access.workspaceName}" no Effinance.\n\nPara aceitar, acesse (válido por 7 dias):\n${url}`,
    });
    await audit(app.db, { ...requestContext(req), action: 'member.invited', workspaceId: req.workspaceId, userId: req.userId, entity: 'invite', entityId: invite.id, metadata: { role: invite.role } });
    // Without real e-mail delivery the owner shares the link by hand.
    return reply.code(201).send(app.platform.mailer.delivers ? invite : { ...invite, inviteUrl: url });
  });

  app.delete('/current/invites/:id', { schema: { params: z.object({ id: idSchema }) } }, async (req, reply) => {
    assertOwner(req.access);
    await revokeInvite(app.db, req.access, req.params.id);
    await audit(app.db, { ...requestContext(req), action: 'invite.revoked', workspaceId: req.workspaceId, userId: req.userId, entity: 'invite', entityId: req.params.id });
    return reply.code(204).send();
  });

  // ------------------------------------------------------------------ data protection

  app.get('/current/export', async (req, reply) => {
    assertOwner(req.access);
    const data = await exportWorkspace(app.db, req.access);
    await audit(app.db, { ...requestContext(req), action: 'data.exported', workspaceId: req.workspaceId, userId: req.userId, entity: 'workspace', entityId: req.workspaceId });
    reply.header('content-disposition', `attachment; filename="effinance-${data.exportedAt.slice(0, 10)}.json"`);
    reply.header('cache-control', 'no-store');
    return data;
  });

  app.get('/current/audit', { schema: { querystring: auditQuerySchema } }, async (req) => {
    assertOwner(req.access);
    return listAudit(app.db, req.workspaceId, req.query.page, req.query.pageSize);
  });
};

/** Public preview + accept (the accept needs a signed-in user with the invited e-mail). */
export const inviteRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/:token', { schema: { params: tokenParams }, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) =>
    previewInvite(app.db, req.params.token),
  );

  app.post('/:token/accept', { schema: { params: tokenParams }, onRequest: [app.authenticate] }, async (req, reply) => {
    const workspaceId = await acceptInvite(app.db, req.userId, req.params.token);
    await app.switchSession(req, reply, workspaceId);
    await audit(app.db, { ...requestContext(req), action: 'member.joined', workspaceId, userId: req.userId, entity: 'user', entityId: req.userId });
    return getMe(app.db, req.userId, workspaceId);
  });
};
