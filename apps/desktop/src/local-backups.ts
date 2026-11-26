// Backup files on this computer (Documentos\Effinance\Backups): one per day, last 30 days.

import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BACKUP_LIMITS, BackupFileError, backupFileName, dayOfFile, isExpired } from './backup-file';

/** Reads a backup text file (a picked file or this computer's), refusing anything too large first. */
export function readBackupText(path: string, maxBytes = BACKUP_LIMITS.maxFileBytes): string {
  const stat = statSync(path);
  if (!stat.isFile() || stat.size > maxBytes) throw new BackupFileError('O arquivo é grande demais para ser um backup do Effinance.');
  return readFileSync(path, 'utf8');
}

export interface LocalBackup {
  day: string;
  size: number;
  path: string;
}

export class LocalBackups {
  constructor(readonly folder: string) {}

  list(): LocalBackup[] {
    mkdirSync(this.folder, { recursive: true });
    return readdirSync(this.folder)
      .map((name) => ({ name, day: dayOfFile(name) }))
      .filter((f): f is { name: string; day: string } => f.day !== null)
      .map(({ name, day }) => {
        const path = join(this.folder, name);
        return { day, path, size: statSync(path).size };
      })
      .sort((a, b) => b.day.localeCompare(a.day));
  }

  /** Writes (or replaces) the day's file. */
  write(day: string, text: string): LocalBackup {
    mkdirSync(this.folder, { recursive: true });
    const path = join(this.folder, backupFileName(day));
    writeFileSync(`${path}.tmp`, text);
    renameSync(`${path}.tmp`, path);
    return { day, path, size: Buffer.byteLength(text) };
  }

  read(day: string): string {
    // backupFileName refuses anything but `YYYY-MM-DD`: no `..`, slashes or drive letters.
    return readBackupText(join(this.folder, backupFileName(day)));
  }

  /** Deletes the days outside the retention window; returns them. */
  prune(today: string, retentionDays?: number): string[] {
    const removed: string[] = [];
    for (const b of this.list()) {
      if (!isExpired(b.day, today, retentionDays)) continue;
      unlinkSync(b.path);
      removed.push(b.day);
    }
    return removed;
  }
}
