// Backup orchestration: snapshot → encrypted text file → this computer + the Google Drive folder of
// Google Drive for desktop (synced by Google's app) + optionally the Drive API, keeping the last 30
// days everywhere. A failure in a copy never loses the local one.

import { RETENTION_DAYS, backupFileName, isExpired, localDay, openBackup, sealBackup, type BackupPayload } from './backup-file';
import type { DriveFile, GoogleDrive } from './drive';
import type { LocalBackups } from './local-backups';
import type { Store } from './store';

export interface BackupStatus {
  hasPassword: boolean;
  lastBackupAt: string | null;
  lastError: string | null;
  retentionDays: number;
  localFolder: string;
}

export interface BackupEntry {
  date: string;
  size: number;
  local: boolean;
  /** In the Google Drive for desktop folder. */
  synced: boolean;
  driveId: string | null;
}

export type RestoreSource =
  | { kind: 'local'; date: string }
  | { kind: 'synced'; date: string }
  | { kind: 'drive'; id: string }
  | { kind: 'file'; text: string };

type Drive = Pick<GoogleDrive, 'status' | 'list' | 'upload' | 'remove' | 'download'>;

export interface BackupDeps {
  store: Store;
  local: LocalBackups;
  /** Backups folder inside Google Drive for desktop, when there is one (resolved at each use). */
  synced?: () => LocalBackups | null;
  drive: Drive;
  /** Asks the app window for the database snapshot (JSON text). */
  getSnapshot: () => Promise<string>;
  now?: () => Date;
}

const MIN_PASSWORD = 8;

export class BackupService {
  private running: Promise<BackupStatus> | null = null;

  constructor(private readonly deps: BackupDeps) {}

  private now() {
    return this.deps.now?.() ?? new Date();
  }

  status(): BackupStatus {
    const settings = this.deps.store.settings();
    return {
      hasPassword: Boolean(this.deps.store.secrets().backupPassword),
      lastBackupAt: settings.lastBackupAt ?? null,
      lastError: settings.lastError ?? null,
      retentionDays: RETENTION_DAYS,
      localFolder: this.deps.local.folder,
    };
  }

  setPassword(password: string): BackupStatus {
    if (password.length < MIN_PASSWORD) throw new Error(`A senha do backup precisa de pelo menos ${MIN_PASSWORD} caracteres.`);
    this.deps.store.updateSecrets({ backupPassword: password });
    return this.status();
  }

  /** One backup at a time (closing the window while "Fazer backup agora" runs reuses it). */
  run(): Promise<BackupStatus> {
    this.running ??= this.doRun().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async doRun(): Promise<BackupStatus> {
    const { store, local, drive } = this.deps;
    const { backupPassword, masterKey } = store.secrets();
    if (!backupPassword) throw new Error('Defina a senha do backup em Configurações > Backup.');
    if (!masterKey) throw new Error('A chave dos dados não foi encontrada.');
    const now = this.now();
    const today = localDay(now);
    let text: string;
    try {
      text = await sealBackup({ masterKey, snapshot: await this.deps.getSnapshot() }, backupPassword, now);
      local.write(today, text);
      local.prune(today);
    } catch (e) {
      store.updateSettings({ lastError: message(e) });
      throw e;
    }
    const errors: string[] = [];
    const synced = this.deps.synced?.() ?? null;
    if (synced) {
      try {
        synced.write(today, text);
        synced.prune(today);
      } catch (e) {
        errors.push(`a cópia na pasta do Google Drive falhou: ${message(e)}`);
      }
    }
    if (drive.status().connected) {
      try {
        const files = await drive.list();
        await drive.upload(backupFileName(today), text, files);
        for (const f of files) if (isExpired(f.day, today)) await drive.remove(f.id);
      } catch (e) {
        errors.push(`o envio ao Google Drive falhou: ${message(e)}`);
      }
    }
    store.updateSettings({ lastBackupAt: now.toISOString(), lastError: errors.length ? `Salvo neste computador, mas ${errors.join('; ')}` : null });
    return this.status();
  }

  /** Days with a backup, newest first, merging this computer and the Drive. */
  async list(): Promise<BackupEntry[]> {
    const byDay = new Map<string, BackupEntry>();
    for (const b of this.deps.local.list()) byDay.set(b.day, { date: b.day, size: b.size, local: true, synced: false, driveId: null });
    const synced = this.deps.synced?.() ?? null;
    let syncedList: { day: string; size: number }[] = [];
    try {
      syncedList = synced?.list() ?? [];
    } catch {
      // folder offline (Google Drive app not running): list what is here
    }
    for (const b of syncedList) {
      const entry = byDay.get(b.day);
      if (entry) entry.synced = true;
      else byDay.set(b.day, { date: b.day, size: b.size, local: false, synced: true, driveId: null });
    }
    let remote: DriveFile[] = [];
    if (this.deps.drive.status().connected) remote = await this.deps.drive.list().catch(() => []);
    for (const f of remote) {
      const entry = byDay.get(f.day);
      if (entry) entry.driveId = f.id;
      else byDay.set(f.day, { date: f.day, size: f.size, local: false, synced: false, driveId: f.id });
    }
    return [...byDay.values()].sort((a, b) => b.date.localeCompare(a.date));
  }

  async read(source: RestoreSource, password: string): Promise<BackupPayload> {
    let text: string;
    if (source.kind === 'local') text = this.deps.local.read(source.date);
    else if (source.kind === 'synced') {
      const synced = this.deps.synced?.();
      if (!synced) throw new Error('A pasta do Google Drive não está disponível.');
      text = synced.read(source.date);
    } else if (source.kind === 'drive') text = await this.deps.drive.download(source.id);
    else text = source.text;
    return openBackup(text, password);
  }

  /**
   * After the restore: the backup's master key decrypts the restored rows; the password that opened
   * the backup keeps backing up on this computer.
   */
  finishRestore(masterKey: string, password: string): void {
    if (!/^[0-9a-f]{64}$/.test(masterKey)) throw new Error('Chave do backup inválida.');
    this.deps.store.updateSecrets({ masterKey, backupPassword: password });
  }
}

function message(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}
