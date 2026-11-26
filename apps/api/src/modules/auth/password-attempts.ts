// Per-account budget of wrong passwords (login and re-authentication: change password, delete account,
// enable 2FA), counted in the audit log like the 2FA code budget. The per-IP route limits alone let
// many IPs guess one account's password without end (NIST SP 800-63B §5.2.2, CWE-307).
// A password change or reset starts a fresh budget, so the owner of an account someone keeps locking
// can always get back in through "Esqueci a senha". Browser-safe (the demo runs it on PGlite).

import { and, count, eq, gt, inArray, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/client';
import { auditLogs, type UserRow } from '../../db/schema';
import { audit, type AuditContext } from '../../lib/audit';
import { TooManyRequestsError } from '../../lib/errors';
import { verifyPassword } from '../../lib/password';

/** Wrong passwords allowed per account within the window, whatever the source IP. */
export const PASSWORD_MAX_FAILURES = 10;
export const LOGIN_FAILED_ACTION = 'auth.login_failed';
/** Wrong current password on a re-authentication (change password, delete account, enable 2FA). */
export const PASSWORD_FAILED_ACTION = 'auth.password_failed';

type PasswordOwner = Pick<UserRow, 'id' | 'passwordHash' | 'passwordChangedAt'>;

/** 429 once the account used up its wrong passwords in the last 15 minutes (since the last password change). */
export async function assertPasswordAttemptsLeft(db: DbExecutor, user: Pick<UserRow, 'id' | 'passwordChangedAt'>): Promise<void> {
  // greatest() ignores NULL: accounts that never changed their password just use the window.
  // ISO text: raw Date parameters are not portable across drivers (postgres-js, PGlite in the demo).
  const changedAt = user.passwordChangedAt ? user.passwordChangedAt.toISOString() : null;
  const since = sql`greatest(now() - interval '15 minutes', ${changedAt}::timestamptz)`;
  const [row] = await db
    .select({ n: count() })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.userId, user.id),
        inArray(auditLogs.action, [LOGIN_FAILED_ACTION, PASSWORD_FAILED_ACTION]),
        gt(auditLogs.createdAt, since),
      ),
    );
  if ((row?.n ?? 0) >= PASSWORD_MAX_FAILURES) {
    throw new TooManyRequestsError('Muitas tentativas de senha nesta conta. Aguarde 15 minutos ou use "Esqueci a senha".');
  }
}

/**
 * Checks the account's password within its attempt budget (throws 429 when exhausted, before
 * hashing: no answer about the password once locked). A wrong password is recorded under `action`.
 */
export async function verifyAccountPassword(
  db: DbExecutor,
  user: PasswordOwner,
  password: string,
  ctx: AuditContext = {},
  action: typeof LOGIN_FAILED_ACTION | typeof PASSWORD_FAILED_ACTION = PASSWORD_FAILED_ACTION,
): Promise<boolean> {
  await assertPasswordAttemptsLeft(db, user);
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) await audit(db, { ...ctx, action, userId: user.id });
  return ok;
}
