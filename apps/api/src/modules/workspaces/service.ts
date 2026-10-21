// Workspaces (tenants), members and invites. These tables are not tenant-scoped: the functions take
// the system connection and check membership/role explicitly.

import { and, asc, count, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import {
  TRIAL_DAYS,
  type AuditLogEntry,
  type Invite,
  type InvitePreview,
  type MeResponse,
  type MeUser,
  type Member,
  type MemberRole,
  type Paginated,
  type WorkspaceKind,
  type WorkspaceSummary,
} from '@effinance/shared';
import type { DbExecutor } from '../../db/client';
import {
  auditLogs,
  subscriptions,
  users,
  workspaceInvites,
  workspaceMembers,
  workspaces,
  type UserRow,
} from '../../db/schema';
import { randomToken, sha256Hex } from '../../lib/crypto/encoding';
import { forgetWorkspaceKey, newWorkspaceKey } from '../../lib/crypto/keyring';
import { ConflictError, ForbiddenError, NotFoundError, TooManyRequestsError, ValidationError } from '../../lib/errors';
import { maxMembersFor, summarizeSubscription } from '../billing/entitlements';
import type { Access } from './access';

const DAY_MS = 86_400_000;
export const INVITE_TTL_MS = 7 * DAY_MS;
export const PERSONAL_WORKSPACE_NAME = 'Pessoal';
/** Workspaces a user may own (personal included): each is a new trial and a new KMS data key. */
export const MAX_OWNED_WORKSPACES = 10;
/** Invite e-mails per workspace per hour (re-inviting replaces the pending invite, so no other cap applies). */
export const MAX_INVITES_PER_HOUR = 20;
export const INVITED_ACTION = 'member.invited';

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------

/**
 * Creates a workspace with its data key, the owner membership and a trial subscription.
 * Call inside a transaction.
 */
export async function createWorkspace(
  db: DbExecutor,
  input: { name: string; kind: WorkspaceKind; ownerId: string },
): Promise<string> {
  const id = globalThis.crypto.randomUUID();
  const now = new Date();
  await db.insert(workspaces).values({ id, name: input.name, kind: input.kind, ...(await newWorkspaceKey(id)) });
  await db.insert(workspaceMembers).values({ workspaceId: id, userId: input.ownerId, role: 'owner' });
  await db.insert(subscriptions).values({
    workspaceId: id,
    status: 'trialing',
    trialEndsAt: new Date(now.getTime() + TRIAL_DAYS * DAY_MS),
  });
  return id;
}

export async function listWorkspaceSummaries(db: DbExecutor, userId: string): Promise<WorkspaceSummary[]> {
  const rows = await db
    .select({ role: workspaceMembers.role, workspace: workspaces, subscription: subscriptions })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .leftJoin(subscriptions, eq(subscriptions.workspaceId, workspaces.id))
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(sql`${workspaces.kind} = 'personal' desc`, asc(workspaces.name));
  const now = new Date();
  return rows.map((r) => ({
    id: r.workspace.id,
    name: r.workspace.name,
    kind: r.workspace.kind,
    role: r.role,
    subscription: summarizeSubscription(r.subscription, now),
  }));
}

export function toMeUser(row: UserRow): MeUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    createdAt: row.createdAt.toISOString(),
    mfaEnabled: row.mfaEnabled,
  };
}

export async function getUserRow(db: DbExecutor, userId: string): Promise<UserRow> {
  const [row] = await db.select().from(users).where(eq(users.id, userId));
  if (!row) throw new NotFoundError('Usuário não encontrado');
  return row;
}

export async function getMe(db: DbExecutor, userId: string, workspaceId: string): Promise<MeResponse> {
  const [user, list] = await Promise.all([getUserRow(db, userId), listWorkspaceSummaries(db, userId)]);
  const workspace = list.find((w) => w.id === workspaceId);
  if (!workspace) throw new ForbiddenError('Você não participa deste espaço');
  return { user: toMeUser(user), workspace, workspaces: list };
}

/**
 * Workspace a session should open: the preferred one if the user is a member, else the last used,
 * else the personal one, else any.
 */
export async function resolveWorkspaceFor(db: DbExecutor, userId: string, preferred?: string | null): Promise<string | null> {
  const memberships = await db
    .select({ workspaceId: workspaceMembers.workspaceId, kind: workspaces.kind, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(asc(workspaceMembers.createdAt));
  if (memberships.length === 0) return null;
  const ids = new Set(memberships.map((m) => m.workspaceId));
  if (preferred && ids.has(preferred)) return preferred;
  const [user] = await db.select({ last: users.lastWorkspaceId }).from(users).where(eq(users.id, userId));
  if (user?.last && ids.has(user.last)) return user.last;
  return (memberships.find((m) => m.kind === 'personal' && m.role === 'owner') ?? memberships[0]!).workspaceId;
}

export async function switchWorkspace(db: DbExecutor, userId: string, workspaceId: string): Promise<void> {
  const [member] = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.userId, userId), eq(workspaceMembers.workspaceId, workspaceId)));
  if (!member) throw new NotFoundError('Espaço não encontrado');
  await db.update(users).set({ lastWorkspaceId: workspaceId }).where(eq(users.id, userId));
}

export async function createSharedWorkspace(
  db: DbExecutor,
  userId: string,
  input: { name: string; kind: 'family' | 'business' },
): Promise<string> {
  const [owned] = await db
    .select({ n: count() })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.userId, userId), eq(workspaceMembers.role, 'owner')));
  if ((owned?.n ?? 0) >= MAX_OWNED_WORKSPACES) {
    throw new ValidationError(
      `Você já é proprietário de ${MAX_OWNED_WORKSPACES} espaços. Exclua um espaço que não usa mais para criar outro.`,
    );
  }
  return db.transaction((tx) => createWorkspace(tx, { name: input.name, kind: input.kind, ownerId: userId }));
}

export async function renameWorkspace(db: DbExecutor, access: Access, name: string): Promise<void> {
  await db.update(workspaces).set({ name }).where(eq(workspaces.id, access.workspaceId));
}

/**
 * Deletes the workspace: rows cascade and the wrapped data key goes with the row, so any copy of the
 * data left in backups can no longer be decrypted (crypto-shredding).
 */
export async function deleteWorkspaceRow(db: DbExecutor, workspaceId: string): Promise<void> {
  await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
  forgetWorkspaceKey(workspaceId);
}

export async function getSubscriptionRow(db: DbExecutor, workspaceId: string) {
  const [row] = await db.select().from(subscriptions).where(eq(subscriptions.workspaceId, workspaceId));
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export async function listMembers(db: DbExecutor, access: Access): Promise<Member[]> {
  const rows = await db
    .select({ member: workspaceMembers, name: users.name, email: users.email })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, access.workspaceId))
    .orderBy(sql`${workspaceMembers.role} = 'owner' desc`, asc(users.name));
  return rows.map((r) => ({
    userId: r.member.userId,
    name: r.name,
    email: r.email,
    role: r.member.role,
    joinedAt: r.member.createdAt.toISOString(),
    isYou: r.member.userId === access.userId,
  }));
}

export async function memberCount(db: DbExecutor, workspaceId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.workspaceId, workspaceId));
  return row?.n ?? 0;
}

export async function changeMemberRole(
  db: DbExecutor,
  access: Access,
  userId: string,
  role: Exclude<MemberRole, 'owner'>,
): Promise<Member> {
  if (userId === access.userId) throw new ValidationError('Você não pode alterar o seu próprio papel');
  const [row] = await db
    .update(workspaceMembers)
    .set({ role })
    .where(
      and(
        eq(workspaceMembers.workspaceId, access.workspaceId),
        eq(workspaceMembers.userId, userId),
        sql`${workspaceMembers.role} <> 'owner'`,
      ),
    )
    .returning();
  if (!row) throw new NotFoundError('Membro não encontrado');
  const member = (await listMembers(db, access)).find((m) => m.userId === userId);
  return member!;
}

/** Owner removes a member, or a member leaves. The owner cannot leave (delete the workspace). */
export async function removeMember(db: DbExecutor, access: Access, userId: string): Promise<'removed' | 'left'> {
  const leaving = userId === access.userId;
  if (leaving && access.role === 'owner') {
    throw new ValidationError('O proprietário não pode sair do espaço. Exclua o espaço se não for mais usá-lo.');
  }
  if (!leaving && access.role !== 'owner') throw new ForbiddenError('Somente o proprietário pode remover membros');
  const rows = await db
    .delete(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, access.workspaceId),
        eq(workspaceMembers.userId, userId),
        sql`${workspaceMembers.role} <> 'owner'`,
      ),
    )
    .returning({ userId: workspaceMembers.userId });
  if (rows.length === 0) throw new NotFoundError('Membro não encontrado');
  return leaving ? 'left' : 'removed';
}

// ---------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------

function toInvite(row: typeof workspaceInvites.$inferSelect, inviteUrl?: string): Invite {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    ...(inviteUrl ? { inviteUrl } : {}),
  };
}

function pendingInvitesWhere(workspaceId: string) {
  return and(
    eq(workspaceInvites.workspaceId, workspaceId),
    isNull(workspaceInvites.acceptedAt),
    gt(workspaceInvites.expiresAt, new Date()),
  );
}

export async function listInvites(db: DbExecutor, access: Access): Promise<Invite[]> {
  const rows = await db
    .select()
    .from(workspaceInvites)
    .where(pendingInvitesWhere(access.workspaceId))
    .orderBy(desc(workspaceInvites.createdAt));
  return rows.map((r) => toInvite(r));
}

async function assertMemberSlot(db: DbExecutor, workspaceId: string, kind: WorkspaceKind, extra: number) {
  const subscription = await getSubscriptionRow(db, workspaceId);
  const max = maxMembersFor(kind, subscription);
  const members = await memberCount(db, workspaceId);
  if (members + extra > max) {
    throw new ValidationError(
      max === 1
        ? 'Seu plano é individual. Assine o plano Família para convidar pessoas.'
        : `Seu plano permite até ${max} membros. Faça upgrade para convidar mais pessoas.`,
    );
  }
}

/** Returns the invite and the raw token (sent by e-mail; only its hash is stored). */
export async function createInvite(
  db: DbExecutor,
  access: Access,
  input: { email: string; role: Exclude<MemberRole, 'owner'> },
): Promise<{ invite: Invite; token: string }> {
  const [existing] = await db
    .select({ id: users.id })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.workspaceId, access.workspaceId), eq(users.email, input.email)));
  if (existing) throw new ConflictError('Esta pessoa já participa do espaço');

  // Every invite sends an e-mail with a name the owner chose: cap them (spam through our sender).
  const [sent] = await db
    .select({ n: count() })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.workspaceId, access.workspaceId),
        eq(auditLogs.action, INVITED_ACTION),
        gt(auditLogs.createdAt, sql`now() - interval '1 hour'`),
      ),
    );
  if ((sent?.n ?? 0) >= MAX_INVITES_PER_HOUR) {
    throw new TooManyRequestsError('Muitos convites enviados na última hora. Tente novamente mais tarde.');
  }

  // A new invite to the same e-mail replaces the pending one.
  await db
    .delete(workspaceInvites)
    .where(and(eq(workspaceInvites.workspaceId, access.workspaceId), eq(workspaceInvites.email, input.email), isNull(workspaceInvites.acceptedAt)));
  const [pending] = await db.select({ n: count() }).from(workspaceInvites).where(pendingInvitesWhere(access.workspaceId));
  await assertMemberSlot(db, access.workspaceId, access.workspaceKind, 1 + (pending?.n ?? 0));

  const token = randomToken();
  const [row] = await db
    .insert(workspaceInvites)
    .values({
      workspaceId: access.workspaceId,
      email: input.email,
      role: input.role,
      tokenHash: await sha256Hex(token),
      invitedBy: access.userId,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    })
    .returning();
  return { invite: toInvite(row!), token };
}

export function inviteUrl(appUrl: string, token: string): string {
  return `${appUrl}/convite/${token}`;
}

export async function revokeInvite(db: DbExecutor, access: Access, id: string): Promise<void> {
  const rows = await db
    .delete(workspaceInvites)
    .where(and(eq(workspaceInvites.id, id), eq(workspaceInvites.workspaceId, access.workspaceId), isNull(workspaceInvites.acceptedAt)))
    .returning({ id: workspaceInvites.id });
  if (rows.length === 0) throw new NotFoundError('Convite não encontrado');
}

async function findInvite(db: DbExecutor, token: string) {
  const [row] = await db
    .select({ invite: workspaceInvites, workspace: workspaces, invitedBy: users.name })
    .from(workspaceInvites)
    .innerJoin(workspaces, eq(workspaces.id, workspaceInvites.workspaceId))
    .leftJoin(users, eq(users.id, workspaceInvites.invitedBy))
    .where(eq(workspaceInvites.tokenHash, await sha256Hex(token)));
  if (!row || row.invite.acceptedAt) throw new NotFoundError('Convite inválido ou já utilizado');
  return row;
}

export async function previewInvite(db: DbExecutor, token: string): Promise<InvitePreview> {
  const row = await findInvite(db, token);
  return {
    workspaceName: row.workspace.name,
    workspaceKind: row.workspace.kind,
    invitedBy: row.invitedBy ?? 'Um membro',
    email: row.invite.email,
    role: row.invite.role,
    expired: row.invite.expiresAt <= new Date(),
  };
}

/** Adds the signed-in user (whose e-mail must match the invite) to the workspace. */
export async function acceptInvite(db: DbExecutor, userId: string, token: string): Promise<string> {
  const row = await findInvite(db, token);
  if (row.invite.expiresAt <= new Date()) throw new ValidationError('Este convite expirou. Peça um novo convite.');
  const user = await getUserRow(db, userId);
  if (user.email.toLowerCase() !== row.invite.email.toLowerCase()) {
    throw new ForbiddenError(`Este convite foi enviado para ${row.invite.email}. Entre com esse e-mail para aceitar.`);
  }
  const workspaceId = row.workspace.id;
  await db.transaction(async (tx) => {
    const [member] = await tx
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));
    if (!member) {
      await assertMemberSlot(tx, workspaceId, row.workspace.kind, 1);
      await tx.insert(workspaceMembers).values({ workspaceId, userId, role: row.invite.role });
    }
    await tx.update(workspaceInvites).set({ acceptedAt: new Date() }).where(eq(workspaceInvites.id, row.invite.id));
    await tx.update(users).set({ lastWorkspaceId: workspaceId }).where(eq(users.id, userId));
  });
  return workspaceId;
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

export async function listAudit(
  db: DbExecutor,
  workspaceId: string,
  page: number,
  pageSize: number,
): Promise<Paginated<AuditLogEntry>> {
  const where = eq(auditLogs.workspaceId, workspaceId);
  const [rows, [total]] = await Promise.all([
    db
      .select({ log: auditLogs, userName: users.name })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.userId))
      .where(where)
      .orderBy(desc(auditLogs.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ n: count() }).from(auditLogs).where(where),
  ]);
  return {
    items: rows.map((r) => ({
      id: r.log.id,
      action: r.log.action,
      entity: r.log.entity,
      entityId: r.log.entityId,
      userName: r.userName,
      ip: r.log.ip,
      createdAt: r.log.createdAt.toISOString(),
    })),
    total: total?.n ?? 0,
    page,
    pageSize,
  };
}
