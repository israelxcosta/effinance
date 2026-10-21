// Accounts: registration, password login, profile, password change/reset and account deletion.
// Browser-safe (the demo runs these same functions on PGlite).

import { and, count, eq, gt, isNull, sql } from 'drizzle-orm';
import type {
  ChangePasswordInput,
  LoginInput,
  MeUser,
  RegisterInput,
  UpdateProfileInput,
  User,
} from '@effinance/shared';
import type { DbExecutor } from '../../db/client';
import { accounts, auditLogs, passwordResets, users, workspaceMembers, workspaces, type UserRow } from '../../db/schema';
import { audit, type AuditContext } from '../../lib/audit';
import { randomToken, sha256Hex } from '../../lib/crypto/encoding';
import { ConflictError, UnauthorizedError, ValidationError } from '../../lib/errors';
import { hashPassword, verifyPassword } from '../../lib/password';
import { withTenant } from '../../lib/tenant';
import { seedDefaultCategories } from '../categories/service';
import {
  PERSONAL_WORKSPACE_NAME,
  createWorkspace,
  deleteWorkspaceRow,
  getUserRow,
  toMeUser,
} from '../workspaces/service';
import { revokeUserSessions } from './sessions';

export const PASSWORD_RESET_TTL_MS = 30 * 60_000;
/** Reset e-mails per account per hour (the per-IP limit alone lets many IPs flood one inbox). */
export const PASSWORD_RESET_MAX_PER_HOUR = 5;
export const PASSWORD_RESET_REQUESTED_ACTION = 'auth.password_reset_requested';

export function toUser(row: UserRow): User {
  return { id: row.id, name: row.name, email: row.email, createdAt: row.createdAt.toISOString() };
}

// Used to keep login timing similar whether or not the e-mail exists.
let dummyHash: Promise<string> | null = null;
function timingGuardHash() {
  dummyHash ??= hashPassword('effinance-timing-guard-1');
  return dummyHash;
}

function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } } | null;
  return e?.code === '23505' || e?.cause?.code === '23505';
}

/** Creates the user, their personal workspace (in trial), default categories and a wallet. */
export async function register(db: DbExecutor, input: RegisterInput): Promise<{ user: UserRow; workspaceId: string }> {
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email));
  if (existing) throw new ConflictError('Já existe uma conta com este e-mail');

  const passwordHash = await hashPassword(input.password);
  try {
    return await db.transaction(async (tx) => {
      const now = new Date();
      const [user] = await tx
        .insert(users)
        .values({ name: input.name, email: input.email, passwordHash, acceptedTermsAt: now, passwordChangedAt: now })
        .returning();
      const workspaceId = await createWorkspace(tx, { name: PERSONAL_WORKSPACE_NAME, kind: 'personal', ownerId: user!.id });
      const [updated] = await tx.update(users).set({ lastWorkspaceId: workspaceId }).where(eq(users.id, user!.id)).returning();
      // Financial rows go through the tenant role (RLS). Last step: the role lasts until commit.
      await withTenant(tx, workspaceId, async (t) => {
        await seedDefaultCategories(t, workspaceId);
        await t.insert(accounts).values({
          workspaceId,
          name: 'Carteira',
          type: 'wallet',
          color: '#12A150',
          icon: 'wallet',
          initialBalance: 0,
        });
      });
      return { user: updated!, workspaceId };
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError('Já existe uma conta com este e-mail');
    throw error;
  }
}

export async function checkPassword(db: DbExecutor, input: LoginInput): Promise<UserRow> {
  const [row] = await db.select().from(users).where(eq(users.email, input.email));
  const ok = await verifyPassword(input.password, row?.passwordHash ?? (await timingGuardHash()));
  if (!row || !ok) throw new UnauthorizedError('E-mail ou senha incorretos');
  return row;
}

export async function updateProfile(db: DbExecutor, userId: string, input: UpdateProfileInput): Promise<MeUser> {
  const [row] = await db.update(users).set({ name: input.name }).where(eq(users.id, userId)).returning();
  return toMeUser(row ?? (await getUserRow(db, userId)));
}

/** Changes the password and signs out every other session. */
export async function changePassword(
  db: DbExecutor,
  userId: string,
  currentSessionId: string | null,
  input: ChangePasswordInput,
): Promise<void> {
  const user = await getUserRow(db, userId);
  if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
    throw new ValidationError('Senha atual incorreta');
  }
  if (input.currentPassword === input.newPassword) throw new ValidationError('A nova senha deve ser diferente da atual');
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(input.newPassword), passwordChangedAt: new Date() })
    .where(eq(users.id, userId));
  // A reset link requested before the change (maybe by whoever knew the old password) stops working.
  await db.delete(passwordResets).where(and(eq(passwordResets.userId, userId), isNull(passwordResets.usedAt)));
  await revokeUserSessions(db, userId, currentSessionId);
}

/**
 * Returns the raw token to e-mail, or null when the e-mail has no account or already received
 * {@link PASSWORD_RESET_MAX_PER_HOUR} links in the last hour (the caller answers 204 anyway).
 */
export async function requestPasswordReset(
  db: DbExecutor,
  email: string,
  ctx: AuditContext = {},
): Promise<{ token: string; user: UserRow } | null> {
  const [user] = await db.select().from(users).where(eq(users.email, email));
  if (!user) return null;
  const [recent] = await db
    .select({ n: count() })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.userId, user.id),
        eq(auditLogs.action, PASSWORD_RESET_REQUESTED_ACTION),
        gt(auditLogs.createdAt, sql`now() - interval '1 hour'`),
      ),
    );
  if ((recent?.n ?? 0) >= PASSWORD_RESET_MAX_PER_HOUR) return null;
  // Only the latest link works.
  await db.delete(passwordResets).where(and(eq(passwordResets.userId, user.id), isNull(passwordResets.usedAt)));
  const token = randomToken();
  await db.insert(passwordResets).values({
    userId: user.id,
    tokenHash: await sha256Hex(token),
    expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
  });
  await audit(db, { ...ctx, action: PASSWORD_RESET_REQUESTED_ACTION, userId: user.id });
  return { token, user };
}

/** Sets a new password from a reset link (single use) and signs out every session. */
export async function resetPassword(db: DbExecutor, token: string, password: string): Promise<string> {
  const now = new Date();
  const [reset] = await db
    .update(passwordResets)
    .set({ usedAt: now })
    .where(and(eq(passwordResets.tokenHash, await sha256Hex(token)), isNull(passwordResets.usedAt), gt(passwordResets.expiresAt, now)))
    .returning();
  if (!reset) throw new ValidationError('Link inválido ou expirado. Peça um novo e-mail de recuperação.');
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(password), passwordChangedAt: now })
    .where(eq(users.id, reset.userId));
  await revokeUserSessions(db, reset.userId);
  return reset.userId;
}

/**
 * LGPD: deletes the account. Workspaces the user owns are deleted with all their data (and keys);
 * memberships in other workspaces disappear with the user row. Returns the deleted workspace ids.
 */
export async function deleteAccount(
  db: DbExecutor,
  userId: string,
  password: string,
  /** Runs after the password check, before anything is deleted (e.g. cancel paid subscriptions). */
  beforeDelete?: (ownedWorkspaceIds: string[]) => Promise<void>,
): Promise<string[]> {
  const user = await getUserRow(db, userId);
  if (!(await verifyPassword(password, user.passwordHash))) throw new ValidationError('Senha incorreta');
  const owned = await db
    .select({ id: workspaces.id })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(and(eq(workspaceMembers.userId, userId), eq(workspaceMembers.role, 'owner')));
  await beforeDelete?.(owned.map((w) => w.id));
  await db.transaction(async (tx) => {
    for (const w of owned) await deleteWorkspaceRow(tx, w.id);
    await tx.delete(users).where(eq(users.id, userId));
  });
  return owned.map((w) => w.id);
}
