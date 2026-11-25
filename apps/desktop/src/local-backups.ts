// Backup files on this computer (Documentos\Effinance\Backups): one per day, last 30 days.

import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { backupFileName, dayOfFile, isExpired } from './backup-file';

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
    return readFileSync(join(this.folder, backupFileName(day)), 'utf8');
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
