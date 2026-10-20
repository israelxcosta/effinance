// Two-factor authentication (TOTP). The secret is encrypted with the master key; recovery codes
// are stored as SHA-256 hashes and work once.

import { eq } from 'drizzle-orm';
import type { MfaEnableResponse, MfaSetupResponse } from '@effinance/shared';
import type { DbExecutor } from '../../db/client';
import { users, type UserRow } from '../../db/schema';
import { randomBytes, sha256Hex } from '../../lib/crypto/encoding';
import { keyProvider } from '../../lib/crypto/keyring';
import { ValidationError } from '../../lib/errors';
import { generateTotpSecret, otpauthUrl, verifyTotp } from '../../lib/totp';
import { getUserRow } from '../workspaces/service';

const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const RECOVERY_CODES = 8;

function secretContext(userId: string) {
  return `mfa:${userId}`;
}

function recoveryCode(): string {
  const bytes = randomBytes(8);
  const chars = [...bytes].map((b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}

function normalizeRecovery(code: string) {
  return code.trim().toLowerCase();
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

export async function enableMfa(db: DbExecutor, userId: string, code: string): Promise<MfaEnableResponse> {
  const user = await getUserRow(db, userId);
  if (user.mfaEnabled) throw new ValidationError('A verificação em duas etapas já está ativa');
  const secret = await secretOf(user);
  if (!secret) throw new ValidationError('Gere o QR code antes de ativar');
  const step = await verifyTotp(secret, code);
  if (step === null) throw new ValidationError('Código inválido. Confira o horário do celular e tente de novo.');
  const recoveryCodes = Array.from({ length: RECOVERY_CODES }, recoveryCode);
  await db
    .update(users)
    .set({
      mfaEnabled: true,
      mfaLastStep: step,
      mfaRecoveryCodes: await Promise.all(recoveryCodes.map((c) => sha256Hex(c))),
    })
    .where(eq(users.id, userId));
  return { recoveryCodes };
}

/**
 * Validates a TOTP code (never the same step twice) or consumes a recovery code.
 * Returns how it was verified, or null.
 */
export async function verifyMfaCode(db: DbExecutor, user: UserRow, code: string): Promise<'totp' | 'recovery' | null> {
  if (!user.mfaEnabled) return null;
  if (/^\d{6}$/.test(code.trim())) {
    const secret = await secretOf(user);
    const step = secret ? await verifyTotp(secret, code.trim(), { lastStep: user.mfaLastStep }) : null;
    if (step === null) return null;
    await db.update(users).set({ mfaLastStep: step }).where(eq(users.id, user.id));
    return 'totp';
  }
  const hash = await sha256Hex(normalizeRecovery(code));
  const remaining = user.mfaRecoveryCodes ?? [];
  if (!remaining.includes(hash)) return null;
  await db
    .update(users)
    .set({ mfaRecoveryCodes: remaining.filter((h) => h !== hash) })
    .where(eq(users.id, user.id));
  return 'recovery';
}

export async function disableMfa(db: DbExecutor, userId: string, code: string): Promise<void> {
  const user = await getUserRow(db, userId);
  if (!user.mfaEnabled) throw new ValidationError('A verificação em duas etapas não está ativa');
  if (!(await verifyMfaCode(db, user, code))) throw new ValidationError('Código inválido');
  await db
    .update(users)
    .set({ mfaEnabled: false, mfaSecretEnc: null, mfaRecoveryCodes: null, mfaLastStep: null })
    .where(eq(users.id, userId));
}
