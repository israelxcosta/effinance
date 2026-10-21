// Two-factor authentication (TOTP). The secret is encrypted with the master key; recovery codes
// are stored salted and stretched (PBKDF2) and work once. Every code check spends from a
// per-account budget (counted in the audit log), so an attacker holding the password cannot
// brute-force the 6-digit code from many IPs, and code consumption is atomic (no replay by racing).

import { and, count, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import type { MfaEnableResponse, MfaSetupResponse } from '@effinance/shared';
import type { DbExecutor } from '../../db/client';
import { auditLogs, sessions, users, type UserRow } from '../../db/schema';
import { audit, type AuditContext } from '../../lib/audit';
import { fromBase64Url, randomBytes, sha256Hex, timingSafeEqualStr, toBase64Url, utf8 } from '../../lib/crypto/encoding';
import { keyProvider } from '../../lib/crypto/keyring';
import { TooManyRequestsError, ValidationError } from '../../lib/errors';
import { verifyPassword } from '../../lib/password';
import { generateTotpSecret, otpauthUrl, verifyTotp } from '../../lib/totp';
import { getUserRow } from '../workspaces/service';

const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const RECOVERY_CODES = 8;
/** Recovery codes carry ~40 bits: stored with a salted, slow KDF so a database dump cannot be brute-forced. */
const RECOVERY_KDF_ITERATIONS = 210_000;
/** Failed code checks allowed per account within the window, whatever the source IP. */
export const MFA_MAX_FAILURES = 10;
/** Enrolling an authenticator without typing the password needs a login at most this old. */
const MFA_ENROLL_FRESH_LOGIN_MS = 15 * 60_000;
export const MFA_FAILED_ACTION = 'auth.mfa_failed';

function secretContext(userId: string) {
  return `mfa:${userId}`;
}

/** 8 chars from a 31-symbol alphabet, without modulo bias (bytes ≥ 248 are discarded). */
function recoveryCode(): string {
  let chars = '';
  while (chars.length < 8) {
    for (const b of randomBytes(16)) {
      if (b < 248 && chars.length < 8) chars += RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length];
    }
  }
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}

function normalizeRecovery(code: string) {
  return code.trim().toLowerCase();
}

async function pbkdf2(code: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey('raw', utf8(code), 'PBKDF2', false, ['deriveBits']);
  const bits = await globalThis.crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return toBase64Url(new Uint8Array(bits));
}

/** Format: `pbkdf2$<iterations>$<salt>$<hash>` (one salt per enrollment, so a check derives once). */
async function hashRecoveryCodes(codes: string[]): Promise<string[]> {
  const salt = randomBytes(16);
  const saltB64 = toBase64Url(salt);
  return Promise.all(
    codes.map(async (c) => `pbkdf2$${RECOVERY_KDF_ITERATIONS}$${saltB64}$${await pbkdf2(normalizeRecovery(c), salt, RECOVERY_KDF_ITERATIONS)}`),
  );
}

/** Returns the stored entry the code matches (PBKDF2, or bare SHA-256 from before the change). */
async function matchRecoveryCode(stored: readonly string[], code: string): Promise<string | null> {
  const normalized = normalizeRecovery(code);
  const derived = new Map<string, string>();
  let legacy: string | null = null;
  let match: string | null = null;
  for (const entry of stored) {
    let candidate: string;
    let expected: string;
    if (entry.startsWith('pbkdf2$')) {
      const [, iterations, salt, hash] = entry.split('$');
      if (!iterations || !salt || !hash) continue;
      const params = `${iterations}$${salt}`;
      if (!derived.has(params)) derived.set(params, await pbkdf2(normalized, fromBase64Url(salt), Number(iterations)));
      candidate = derived.get(params)!;
      expected = hash;
    } else {
      legacy ??= await sha256Hex(normalized);
      candidate = legacy;
      expected = entry;
    }
    if (timingSafeEqualStr(candidate, expected) && match === null) match = entry;
  }
  return match;
}

/** Starts (or restarts) the setup: a new secret, not active until confirmed with a code. */
export async function setupMfa(db: DbExecutor, userId: string): Promise<MfaSetupResponse> {
  const user = await getUserRow(db, userId);
  if (user.mfaEnabled) throw new ValidationError('A verificação em duas etapas já está ativa');
  const secret = generateTotpSecret();
  await db
    .update(users)
    .set({ mfaSecretEnc: await keyProvider().encryptSecret(secret, secretContext(userId)), mfaLastStep: null })
    .where(eq(users.id, userId));
  return { secret, otpauthUrl: otpauthUrl(secret, user.email) };
}

async function secretOf(user: UserRow): Promise<string | null> {
  return user.mfaSecretEnc ? keyProvider().decryptSecret(user.mfaSecretEnc, secretContext(user.id)) : null;
}

export interface Reauthentication {
  /** Current password, when the client asks for it. */
  password?: string | null;
  /** Session (family) of the request: a login made minutes ago counts as re-authentication. */
  sessionId: string | null;
}

/**
 * Adding a factor must prove it is the account holder, not just someone holding a session (a stolen
 * session could otherwise enroll the attacker's authenticator and lock the owner out).
 */
async function assertReauthenticated(db: DbExecutor, user: UserRow, reauth: Reauthentication): Promise<void> {
  if (reauth.password) {
    if (!(await verifyPassword(reauth.password, user.passwordHash))) throw new ValidationError('Senha incorreta');
    return;
  }
  if (reauth.sessionId) {
    const [row] = await db
      .select({ startedAt: sessions.sessionStartedAt })
      .from(sessions)
      .where(and(eq(sessions.familyId, reauth.sessionId), eq(sessions.userId, user.id)))
      .limit(1);
    if (row && Date.now() - row.startedAt.getTime() <= MFA_ENROLL_FRESH_LOGIN_MS) return;
  }
  throw new ValidationError('Por segurança, confirme sua senha (ou saia e entre novamente) para ativar a verificação em duas etapas.', {
    reauthRequired: true,
  });
}

export async function enableMfa(
  db: DbExecutor,
  userId: string,
  code: string,
  reauth: Reauthentication,
): Promise<MfaEnableResponse> {
  const user = await getUserRow(db, userId);
  if (user.mfaEnabled) throw new ValidationError('A verificação em duas etapas já está ativa');
  await assertReauthenticated(db, user, reauth);
  const secret = await secretOf(user);
  if (!secret) throw new ValidationError('Gere o QR code antes de ativar');
  const step = await verifyTotp(secret, code);
  if (step === null) throw new ValidationError('Código inválido. Confira o horário do celular e tente de novo.');
  const recoveryCodes = Array.from({ length: RECOVERY_CODES }, recoveryCode);
  await db
    .update(users)
    .set({ mfaEnabled: true, mfaLastStep: step, mfaRecoveryCodes: await hashRecoveryCodes(recoveryCodes) })
    .where(eq(users.id, userId));
  return { recoveryCodes };
}

/** 429 once the account used up its failed attempts in the last 15 minutes (any IP). */
async function assertAttemptsLeft(db: DbExecutor, userId: string): Promise<void> {
  const [row] = await db
    .select({ n: count() })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.userId, userId),
        eq(auditLogs.action, MFA_FAILED_ACTION),
        gt(auditLogs.createdAt, sql`now() - interval '15 minutes'`),
      ),
    );
  if ((row?.n ?? 0) >= MFA_MAX_FAILURES) {
    throw new TooManyRequestsError('Muitas tentativas de código. Aguarde 15 minutos e tente novamente.');
  }
}

async function consumeCode(db: DbExecutor, user: UserRow, code: string): Promise<'totp' | 'recovery' | null> {
  if (/^\d{6}$/.test(code)) {
    const secret = await secretOf(user);
    const step = secret ? await verifyTotp(secret, code, { lastStep: user.mfaLastStep }) : null;
    if (step === null) return null;
    // Conditional update: of two requests racing with the same code, only one advances the step.
    const advanced = await db
      .update(users)
      .set({ mfaLastStep: step })
      .where(and(eq(users.id, user.id), or(isNull(users.mfaLastStep), lt(users.mfaLastStep, step))))
      .returning({ id: users.id });
    return advanced.length > 0 ? 'totp' : null;
  }
  const match = await matchRecoveryCode(user.mfaRecoveryCodes ?? [], code);
  if (!match) return null;
  // Removed in SQL, only if still there: a code works once even under concurrent requests.
  const consumed = await db
    .update(users)
    .set({ mfaRecoveryCodes: sql`${users.mfaRecoveryCodes} - ${match}::text` })
    .where(and(eq(users.id, user.id), sql`${users.mfaRecoveryCodes} @> jsonb_build_array(${match}::text)`))
    .returning({ id: users.id });
  return consumed.length > 0 ? 'recovery' : null;
}

/**
 * Validates a TOTP code (never the same step twice) or consumes a recovery code, within the
 * account's attempt budget (throws 429 when exhausted). Failures are recorded in the audit log.
 * Returns how it was verified, or null.
 */
export async function verifyMfaCode(
  db: DbExecutor,
  user: UserRow,
  code: string,
  ctx: AuditContext = {},
): Promise<'totp' | 'recovery' | null> {
  if (!user.mfaEnabled) return null;
  await assertAttemptsLeft(db, user.id);
  const method = await consumeCode(db, user, code.trim());
  if (!method) await audit(db, { ...ctx, action: MFA_FAILED_ACTION, userId: user.id });
  return method;
}

export async function disableMfa(db: DbExecutor, userId: string, code: string, ctx: AuditContext = {}): Promise<void> {
  const user = await getUserRow(db, userId);
  if (!user.mfaEnabled) throw new ValidationError('A verificação em duas etapas não está ativa');
  if (!(await verifyMfaCode(db, user, code, ctx))) throw new ValidationError('Código inválido');
  await db
    .update(users)
    .set({ mfaEnabled: false, mfaSecretEnc: null, mfaRecoveryCodes: null, mfaLastStep: null })
    .where(eq(users.id, userId));
}
