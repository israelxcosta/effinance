// Backup file: plain text, one per day, encrypted with the person's backup password.
//
//   EFFINANCE-BACKUP 1
//   {"createdAt":"…","kdf":"pbkdf2-sha256","iterations":600000,"salt":"…","iv":"…"}
//   <base64 of AES-256-GCM(gzip(JSON {masterKey, snapshot})) + 16-byte tag>
//
// The payload carries the field-encryption master key, so a backup restores on any computer with
// the password alone. Nothing here touches Electron: it runs in the tests as plain Node.

import { createCipheriv, createDecipheriv, pbkdf2, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { gunzipSync, gzipSync } from 'node:zlib';

const MAGIC = 'EFFINANCE-BACKUP 1';
const ITERATIONS = 600_000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Size caps for a backup being restored (it may come from anywhere: a picked file, the Drive). Real
 * backups are a few KB to a few MB; the caps stop a huge file or a gzip bomb from exhausting memory.
 */
export const BACKUP_LIMITS = {
  /** The encrypted text file. */
  maxFileBytes: 64 * 1024 * 1024,
  /** The decompressed JSON payload. */
  maxPayloadBytes: 256 * 1024 * 1024,
};
export type BackupLimits = typeof BACKUP_LIMITS;
const pbkdf2Async = promisify(pbkdf2);

export const RETENTION_DAYS = 30;
export const FILE_PREFIX = 'effinance-backup-';
const FILE_RE = /^effinance-backup-(\d{4}-\d{2}-\d{2})\.txt$/;

export interface BackupPayload {
  masterKey: string;
  snapshot: string;
}

export class BackupFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupFileError';
  }
}

interface Header {
  createdAt: string;
  kdf: 'pbkdf2-sha256';
  iterations: number;
  salt: string;
  iv: string;
}

const deriveKey = (password: string, salt: Buffer, iterations: number) => pbkdf2Async(password, salt, iterations, 32, 'sha256');

export async function sealBackup(payload: BackupPayload, password: string, now = new Date()): Promise<string> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(password, salt, ITERATIONS);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const header: Header = { createdAt: now.toISOString(), kdf: 'pbkdf2-sha256', iterations: ITERATIONS, salt: salt.toString('base64'), iv: iv.toString('base64') };
  // The header is authenticated too: changing it breaks decryption.
  cipher.setAAD(Buffer.from(JSON.stringify(header)));
  const body = Buffer.concat([cipher.update(gzipSync(JSON.stringify(payload))), cipher.final(), cipher.getAuthTag()]);
  return `${MAGIC}\n${JSON.stringify(header)}\n${body.toString('base64')}\n`;
}

export function backupCreatedAt(text: string): string | null {
  try {
    return (JSON.parse(text.split('\n')[1] ?? '') as Header).createdAt ?? null;
  } catch {
    return null;
  }
}

export async function openBackup(text: string, password: string, limits: BackupLimits = BACKUP_LIMITS): Promise<BackupPayload> {
  if (text.length > limits.maxFileBytes) throw new BackupFileError('O arquivo é grande demais para ser um backup do Effinance.');
  const [magic, headerLine, body] = text.replace(/\r/g, '').split('\n');
  if (magic !== MAGIC || !headerLine || !body) throw new BackupFileError('Este arquivo não é um backup do Effinance.');
  let header: Header;
  try {
    header = JSON.parse(headerLine) as Header;
  } catch {
    throw new BackupFileError('O arquivo de backup está corrompido.');
  }
  if (
    header === null ||
    typeof header !== 'object' ||
    header.kdf !== 'pbkdf2-sha256' ||
    !Number.isInteger(header.iterations) ||
    header.iterations < 100_000 ||
    header.iterations > 5_000_000 ||
    typeof header.salt !== 'string' ||
    typeof header.iv !== 'string'
  ) {
    throw new BackupFileError('O arquivo de backup está corrompido.');
  }
  const data = Buffer.from(body, 'base64');
  if (data.length < 17) throw new BackupFileError('O arquivo de backup está corrompido.');
  const salt = Buffer.from(header.salt, 'base64');
  const iv = Buffer.from(header.iv, 'base64');
  if (salt.length < 16 || iv.length !== 12) throw new BackupFileError('O arquivo de backup está corrompido.');
  const key = await deriveKey(password, salt, header.iterations);
  let plain: Buffer;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
    decipher.setAAD(Buffer.from(headerLine));
    decipher.setAuthTag(data.subarray(data.length - 16));
    plain = Buffer.concat([decipher.update(data.subarray(0, data.length - 16)), decipher.final()]);
  } catch {
    throw new BackupFileError('Senha do backup incorreta, ou arquivo alterado.');
  }
  let json: string;
  try {
    // Bounded: a tiny file must not inflate into gigabytes in the main process.
    json = gunzipSync(plain, { maxOutputLength: limits.maxPayloadBytes }).toString('utf8');
  } catch {
    throw new BackupFileError('O backup é grande demais ou está corrompido.');
  }
  let payload: BackupPayload;
  try {
    payload = JSON.parse(json) as BackupPayload;
  } catch {
    throw new BackupFileError('O arquivo de backup está corrompido.');
  }
  if (payload === null || typeof payload !== 'object' || typeof payload.masterKey !== 'string' || typeof payload.snapshot !== 'string') {
    throw new BackupFileError('O arquivo de backup está corrompido.');
  }
  return payload;
}

/** Local calendar day, `YYYY-MM-DD`. */
export function localDay(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

/** File name of a day's backup; the day must be `YYYY-MM-DD` (never a path). */
export function backupFileName(day: string): string {
  if (!DAY_RE.test(day)) throw new BackupFileError('Data do backup inválida.');
  return `${FILE_PREFIX}${day}.txt`;
}

export function dayOfFile(name: string): string | null {
  return FILE_RE.exec(name)?.[1] ?? null;
}

/** Days older than the retention window (today counts as day 1 of 30). */
export function isExpired(day: string, today: string, retentionDays = RETENTION_DAYS): boolean {
  const ms = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  return (ms(today) - ms(day)) / 86_400_000 >= retentionDays;
}
