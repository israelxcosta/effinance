// What the app keeps on this computer, in Electron's userData folder:
// - secrets.bin: master key, backup password and Google tokens, encrypted with the OS keychain
//   (Windows DPAPI via Electron safeStorage — readable only by this Windows user);
// - settings.json: non-secret state (last backup, Drive folder id).

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface Encryptor {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(data: Buffer): string;
}

export interface Secrets {
  masterKey?: string;
  backupPassword?: string;
  driveClientId?: string;
  driveClientSecret?: string;
  driveRefreshToken?: string;
  driveEmail?: string;
}

export interface Settings {
  lastBackupAt?: string;
  lastError?: string | null;
  driveFolderId?: string;
  /** Google Drive for desktop folder: absent = detect it, '' = turned off, path = chosen by the person. */
  syncFolder?: string;
}

/** Atomic write: a crash mid-write never leaves a half file. */
function writeAtomic(file: string, data: Buffer | string): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, data, { mode: 0o600 });
  renameSync(tmp, file);
}

export class Store {
  private readonly secretsFile: string;
  private readonly settingsFile: string;

  constructor(
    dir: string,
    private readonly encryptor: Encryptor,
  ) {
    this.secretsFile = join(dir, 'secrets.bin');
    this.settingsFile = join(dir, 'settings.json');
  }

  secrets(): Secrets {
    if (!existsSync(this.secretsFile)) return {};
    return JSON.parse(this.encryptor.decryptString(readFileSync(this.secretsFile))) as Secrets;
  }

  updateSecrets(patch: Partial<Record<keyof Secrets, string | undefined>>): Secrets {
    if (!this.encryptor.isEncryptionAvailable()) throw new Error('O cofre de senhas do sistema não está disponível.');
    const next = { ...this.secrets(), ...patch };
    for (const k of Object.keys(next) as (keyof Secrets)[]) if (next[k] === undefined) delete next[k];
    writeAtomic(this.secretsFile, this.encryptor.encryptString(JSON.stringify(next)));
    return next;
  }

  settings(): Settings {
    if (!existsSync(this.settingsFile)) return {};
    try {
      return JSON.parse(readFileSync(this.settingsFile, 'utf8')) as Settings;
    } catch {
      return {};
    }
  }

  updateSettings(patch: Partial<Settings>): Settings {
    const next = { ...this.settings(), ...patch };
    writeAtomic(this.settingsFile, JSON.stringify(next, null, 2));
    return next;
  }
}
