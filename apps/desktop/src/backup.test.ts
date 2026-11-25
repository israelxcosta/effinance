import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BackupFileError, backupFileName, dayOfFile, isExpired, localDay, openBackup, sealBackup } from './backup-file';
import { BackupService } from './backup-service';
import type { DriveFile } from './drive';
import { LocalBackups } from './local-backups';
import { resolveAsset } from './protocol';
import { Store, type Encryptor } from './store';

/** Stand-in for Electron safeStorage (DPAPI): reversible, but not plain JSON on disk. */
const fakeEncryptor: Encryptor = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(s).reverse(),
  decryptString: (b) => Buffer.from(b).reverse().toString(),
};

const tmp = () => mkdtempSync(join(tmpdir(), 'effinance-desktop-'));
const KEY = 'ab'.repeat(32);

describe('backup file', () => {
  it('is light text that only the password opens', async () => {
    const snapshot = JSON.stringify({ tables: { transactions: Array.from({ length: 2000 }, (_, i) => ({ id: i, description: 'Mercado' })) } });
    const text = await sealBackup({ masterKey: KEY, snapshot }, 'senha-forte-1');
    expect(text.startsWith('EFFINANCE-BACKUP 1\n')).toBe(true);
    expect(text).not.toContain('Mercado');
    // gzip before encryption: far smaller than the snapshot itself.
    expect(text.length).toBeLessThan(snapshot.length / 4);
    expect(await openBackup(text, 'senha-forte-1')).toEqual({ masterKey: KEY, snapshot });
    await expect(openBackup(text, 'outra-senha')).rejects.toThrow('Senha do backup incorreta');
  });

  it('detects a changed header or body', async () => {
    const text = await sealBackup({ masterKey: KEY, snapshot: '{}' }, 'senha-forte-1');
    const lines = text.split('\n');
    const tamperedHeader = [lines[0], lines[1]!.replace('"createdAt":"', '"createdAt":"1'), lines[2]].join('\n');
    await expect(openBackup(tamperedHeader, 'senha-forte-1')).rejects.toBeInstanceOf(BackupFileError);
    const body = Buffer.from(lines[2]!, 'base64');
    body[0] = body[0]! ^ 1;
    await expect(openBackup([lines[0], lines[1], body.toString('base64')].join('\n'), 'senha-forte-1')).rejects.toThrow('incorreta');
    await expect(openBackup('qualquer coisa', 'x')).rejects.toThrow('não é um backup');
  });

  it('names one file per day and expires after 30 days', () => {
    expect(backupFileName('2026-11-25')).toBe('effinance-backup-2026-11-25.txt');
    expect(dayOfFile('effinance-backup-2026-11-25.txt')).toBe('2026-11-25');
    expect(dayOfFile('outro.txt')).toBeNull();
    expect(isExpired('2026-10-27', '2026-11-25')).toBe(false); // 29 days ago: day 30 of 30
    expect(isExpired('2026-10-26', '2026-11-25')).toBe(true); // 30 days ago: out
    expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});

describe('local backups', () => {
  it('replaces the same day and prunes beyond 30 days', () => {
    const local = new LocalBackups(join(tmp(), 'Backups'));
    local.write('2026-11-25', 'a');
    local.write('2026-11-25', 'b');
    local.write('2026-10-01', 'velho');
    writeFileSync(join(local.folder, 'anotacoes.txt'), 'não é backup');
    expect(local.list().map((b) => b.day)).toEqual(['2026-11-25', '2026-10-01']);
    expect(local.read('2026-11-25')).toBe('b');
    expect(local.prune('2026-11-25')).toEqual(['2026-10-01']);
    expect(readdirSync(local.folder).sort()).toEqual(['anotacoes.txt', 'effinance-backup-2026-11-25.txt']);
  });
});

function fakeDrive(initial: DriveFile[] = [], { fail = false, connected = true } = {}) {
  const files = new Map(initial.map((f) => [f.id, { ...f, text: 'old' }]));
  let seq = 0;
  return {
    files,
    status: () => ({ configured: true, connected, email: 'eu@gmail.com' }),
    list: async () => {
      if (fail) throw new Error('sem internet');
      return [...files.values()].map(({ text: _t, ...f }) => f);
    },
    upload: async (name: string, text: string, existing: DriveFile[]) => {
      const same = existing.find((f) => f.name === name);
      const id = same?.id ?? `new-${++seq}`;
      files.set(id, { id, name, day: dayOfFile(name)!, size: text.length, text });
      return id;
    },
    remove: async (id: string) => void files.delete(id),
    download: async (id: string) => files.get(id)!.text,
  };
}

describe('backup service', () => {
  const now = () => new Date(2026, 10, 25, 18, 0);

  function setup(drive = fakeDrive()) {
    const dir = tmp();
    const store = new Store(dir, fakeEncryptor);
    store.updateSecrets({ masterKey: KEY });
    const local = new LocalBackups(join(dir, 'Backups'));
    const service = new BackupService({ store, local, drive, now, getSnapshot: async () => '{"format":"effinance-snapshot"}' });
    return { store, local, drive, service, dir };
  }

  it('needs a backup password', async () => {
    const { service } = setup();
    expect(() => service.setPassword('curta')).toThrow('pelo menos 8');
    await expect(service.run()).rejects.toThrow('senha do backup');
  });

  it('saves locally and on Drive, replacing today and deleting days beyond 30', async () => {
    const drive = fakeDrive([
      { id: 'd-today', name: 'effinance-backup-2026-11-25.txt', day: '2026-11-25', size: 3 },
      { id: 'd-recent', name: 'effinance-backup-2026-11-01.txt', day: '2026-11-01', size: 3 },
      { id: 'd-old', name: 'effinance-backup-2026-10-20.txt', day: '2026-10-20', size: 3 },
    ]);
    const { service, local, store } = setup(drive);
    service.setPassword('senha-forte-1');
    local.write('2026-09-30', 'antigo');
    const status = await service.run();
    expect(status).toMatchObject({ hasPassword: true, lastError: null, lastBackupAt: now().toISOString(), retentionDays: 30 });
    expect(local.list().map((b) => b.day)).toEqual(['2026-11-25']);
    expect([...drive.files.keys()].sort()).toEqual(['d-recent', 'd-today']);
    // Today's Drive file got the new content (same id), and it opens with the password.
    expect(await openBackup(drive.files.get('d-today')!.text, 'senha-forte-1')).toEqual({ masterKey: KEY, snapshot: '{"format":"effinance-snapshot"}' });
    // Nothing secret in the readable settings file.
    expect(JSON.stringify(store.settings())).not.toContain('senha');
  });

  it('keeps the local copy when the Drive upload fails', async () => {
    const { service, local } = setup(fakeDrive([], { fail: true }));
    service.setPassword('senha-forte-1');
    const status = await service.run();
    expect(local.list()).toHaveLength(1);
    expect(status.lastError).toContain('Google Drive falhou: sem internet');
  });

  it('lists both places and restores with the password, keeping it for the next backups', async () => {
    const drive = fakeDrive([{ id: 'd1', name: 'effinance-backup-2026-11-20.txt', day: '2026-11-20', size: 9 }]);
    const { service, store } = setup(drive);
    service.setPassword('senha-forte-1');
    await service.run();
    expect(await service.list()).toEqual([
      { date: '2026-11-25', size: expect.any(Number), local: true, driveId: 'new-1' },
      { date: '2026-11-20', size: 9, local: false, driveId: 'd1' },
    ]);
    const payload = await service.read({ kind: 'drive', id: 'new-1' }, 'senha-forte-1');
    // A backup from another computer: its key replaces this one's, its password becomes this one's.
    service.finishRestore('cd'.repeat(32), 'outra-senha-9');
    expect(payload.masterKey).toBe(KEY);
    expect(store.secrets()).toMatchObject({ masterKey: 'cd'.repeat(32), backupPassword: 'outra-senha-9' });
    expect(() => service.finishRestore('nao-hex', 'x')).toThrow('inválida');
  });
});

describe('app:// protocol', () => {
  it('serves only files inside the renderer folder', () => {
    const root = resolve('/opt/effinance/renderer');
    expect(resolveAsset(root, 'app://effinance/')).toBe(join(root, 'index.html'));
    expect(resolveAsset(root, 'app://effinance/assets/pglite-Djh.wasm')).toBe(join(root, 'assets', 'pglite-Djh.wasm'));
    expect(resolveAsset(root, 'app://effinance/../secrets.bin')).toBe(join(root, 'secrets.bin'));
    // Climbing out is clamped to the folder (that file does not exist there: 404).
    expect(resolveAsset(root, 'app://effinance/%2e%2e/%2e%2e/etc/passwd')).toBe(join(root, 'etc', 'passwd'));
    expect(resolveAsset(root, 'app://outro/index.html')).toBeNull();
  });
});
