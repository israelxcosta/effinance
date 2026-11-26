// Regression tests of the security audit (docs/seguranca/auditoria-desktop.md).

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createCipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BackupFileError, backupFileName, openBackup, sealBackup } from './backup-file';
import { driveQueryLiteral } from './drive';
import { LocalBackups, readBackupText } from './local-backups';
import { resolveAsset } from './protocol';
import { externalUrl, isAppUrl, isPermissionAllowed, isTrustedSender, parseRestoreSource, stringArg } from './security';

const tmp = () => mkdtempSync(join(tmpdir(), 'effinance-sec-'));
const KEY = 'ab'.repeat(32);

describe('DESK-01: restore source and backup day are never a path', () => {
  it('refuses a local "day" that climbs out of the backups folder', () => {
    const root = tmp();
    const local = new LocalBackups(join(root, 'Documentos', 'Effinance', 'Backups'));
    local.list(); // creates Documentos/Effinance/Backups
    // A .txt two levels up: before the fix, read() joined the "day" into the path and opened it.
    writeFileSync(join(root, 'Documentos', 'segredo.txt'), 'conteúdo pessoal');
    expect(() => local.read('x/../../../segredo')).toThrow(BackupFileError);
    expect(() => local.read('..\\..\\segredo')).toThrow(BackupFileError);
    expect(() => backupFileName('2026-11-25/../../x')).toThrow('inválida');
    expect(backupFileName('2026-11-25')).toBe('effinance-backup-2026-11-25.txt');
  });

  it('validates what the page sends to backup:read', () => {
    expect(parseRestoreSource({ kind: 'local', date: '2026-11-25' })).toEqual({ kind: 'local', date: '2026-11-25' });
    expect(parseRestoreSource({ kind: 'drive', id: '1AbC_d-9' })).toEqual({ kind: 'drive', id: '1AbC_d-9' });
    // `text` is never taken from the page: the file is read by the main process after the picker.
    expect(parseRestoreSource({ kind: 'file', text: 'EFFINANCE-BACKUP 1…' })).toEqual({ kind: 'file' });
    for (const bad of [
      { kind: 'local', date: '../../../../Windows/win' },
      { kind: 'local', date: '2026-11-25\\..\\x' },
      { kind: 'drive', id: '../about' },
      { kind: 'drive', id: 'a?alt=media&x' },
      { kind: 'outro' },
      null,
      'local',
    ]) {
      expect(() => parseRestoreSource(bad)).toThrow('inválida');
    }
    expect(() => stringArg(123, 10)).toThrow();
    expect(() => stringArg('x'.repeat(11), 10)).toThrow();
    expect(stringArg('senha-forte', 64)).toBe('senha-forte');
  });
});

describe('DESK-02: IPC answers only the top-level app page', () => {
  it('trusts app://effinance/ main frames only', () => {
    expect(isTrustedSender({ url: 'app://effinance/index.html#/configuracoes', parent: null })).toBe(true);
    expect(isTrustedSender({ url: 'app://effinance/index.html', parent: {} })).toBe(false); // a sub-frame
    expect(isTrustedSender({ url: 'https://evil.example/', parent: null })).toBe(false);
    expect(isTrustedSender({ url: 'app://outro/index.html', parent: null })).toBe(false);
    expect(isTrustedSender({ url: 'file:///C:/x.html', parent: null })).toBe(false);
    expect(isTrustedSender({ url: 'app://user:pw@effinance/', parent: null })).toBe(false);
    expect(isTrustedSender(null)).toBe(false);
    expect(isAppUrl('app://effinance')).toBe(true);
    expect(isAppUrl('lixo')).toBe(false);
  });
});

describe('DESK-03: browser permissions are denied except the clipboard write', () => {
  it('denies camera, microphone, location, notifications and devices', () => {
    const page = 'app://effinance/index.html';
    expect(isPermissionAllowed('clipboard-sanitized-write', page)).toBe(true);
    for (const p of ['media', 'geolocation', 'notifications', 'clipboard-read', 'display-capture', 'openExternal', 'hid', 'usb', 'serial', 'fullscreen']) {
      expect(isPermissionAllowed(p, page)).toBe(false);
    }
    expect(isPermissionAllowed('clipboard-sanitized-write', 'https://evil.example/')).toBe(false);
  });
});

describe('DESK-04: only https links leave the app', () => {
  it('opens https in the browser and nothing else', () => {
    expect(externalUrl('https://efficio.com.br/privacidade')).toBe('https://efficio.com.br/privacidade');
    for (const bad of [
      'http://example.com/',
      'file:///C:/Windows/System32/calc.exe',
      'smb://attacker/share',
      '\\\\attacker\\share\\x.exe',
      'ms-msdt:/id PCWDiagnostic',
      'search-ms:query=x',
      'javascript:alert(1)',
      'https://user:pw@example.com/',
      'app://effinance/index.html',
    ]) {
      expect(externalUrl(bad)).toBeNull();
    }
  });
});

describe('DESK-05: Electron fuses in the installer', () => {
  it('turns off running as Node, NODE_OPTIONS and --inspect; loads only the validated asar', () => {
    const yml = readFileSync(new URL('../electron-builder.yml', import.meta.url), 'utf8');
    const block = /^electronFuses:\n((?: {2}.+\n)+)/m.exec(yml)?.[1] ?? '';
    const fuses = Object.fromEntries([...block.matchAll(/^ {2}(\w+): (true|false)/gm)].map((m) => [m[1], m[2] === 'true']));
    expect(fuses).toMatchObject({
      runAsNode: false,
      enableNodeOptionsEnvironmentVariable: false,
      enableNodeCliInspectArguments: false,
      onlyLoadAppFromAsar: true,
      enableEmbeddedAsarIntegrityValidation: true,
      enableCookieEncryption: true,
      grantFileProtocolExtraPrivileges: false,
    });
  });
});

describe('DESK-06: restoring a hostile backup cannot exhaust memory', () => {
  /** A validly encrypted backup whose payload is whatever the attacker wants (they chose the password). */
  function craft(plain: Buffer, password: string) {
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const header = JSON.stringify({ createdAt: new Date().toISOString(), kdf: 'pbkdf2-sha256', iterations: 100_000, salt: salt.toString('base64'), iv: iv.toString('base64') });
    const cipher = createCipheriv('aes-256-gcm', pbkdf2Sync(password, salt, 100_000, 32, 'sha256'), iv);
    cipher.setAAD(Buffer.from(header));
    const body = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
    return `EFFINANCE-BACKUP 1\n${header}\n${body.toString('base64')}\n`;
  }

  it('stops a gzip bomb at the payload cap', async () => {
    // 8 MiB of zeros gzips to ~8 KB; with a 1 MiB cap it must be refused, not inflated.
    const bomb = craft(gzipSync(Buffer.alloc(8 * 1024 * 1024)), 'senha-do-atacante');
    expect(bomb.length).toBeLessThan(64 * 1024);
    await expect(openBackup(bomb, 'senha-do-atacante', { maxFileBytes: 1024 * 1024, maxPayloadBytes: 1024 * 1024 })).rejects.toThrow('grande demais');
  });

  it('refuses a file over the size cap before deriving the key', async () => {
    const text = await sealBackup({ masterKey: KEY, snapshot: 'x'.repeat(10_000) }, 'senha-forte-1');
    await expect(openBackup(text, 'senha-forte-1', { maxFileBytes: 100, maxPayloadBytes: 1024 * 1024 })).rejects.toThrow('grande demais');
    expect(await openBackup(text, 'senha-forte-1')).toEqual({ masterKey: KEY, snapshot: 'x'.repeat(10_000) });
    const file = join(tmp(), 'grande.txt');
    writeFileSync(file, 'x'.repeat(2048));
    expect(() => readBackupText(file, 1024)).toThrow('grande demais');
    expect(readBackupText(file, 4096)).toHaveLength(2048);
  });

  it('rejects malformed headers and payloads with a clean error', async () => {
    const valid = await sealBackup({ masterKey: KEY, snapshot: '{}' }, 'senha-forte-1');
    const [magic, , body] = valid.split('\n');
    const header = (h: unknown) => [magic, JSON.stringify(h), body].join('\n');
    await expect(openBackup(header(null), 'x')).rejects.toBeInstanceOf(BackupFileError);
    await expect(openBackup(header({ kdf: 'pbkdf2-sha256', iterations: 600_000 }), 'x')).rejects.toBeInstanceOf(BackupFileError);
    await expect(openBackup(header({ kdf: 'pbkdf2-sha256', iterations: 600_000, salt: 'AA==', iv: 'AA==' }), 'x')).rejects.toBeInstanceOf(BackupFileError);
    const notJson = craft(gzipSync(Buffer.from('não é json')), 'p');
    await expect(openBackup(notJson, 'p')).rejects.toThrow('corrompido');
    const nullPayload = craft(gzipSync(Buffer.from('null')), 'p');
    await expect(openBackup(nullPayload, 'p')).rejects.toThrow('corrompido');
  });
});

describe('app:// protocol on Windows paths', () => {
  const root = 'C:\\Users\\ana\\AppData\\Local\\Programs\\Effinance\\resources\\renderer';
  const win = (url: string) => resolveAsset(root, url, path.win32);

  it('serves files of the renderer folder', () => {
    expect(win('app://effinance/')).toBe(`${root}\\index.html`);
    expect(win('app://effinance/assets/index-abc.js')).toBe(`${root}\\assets\\index-abc.js`);
  });

  it('never leaves the folder with backslashes, UNC, drive letters, streams or NUL', () => {
    for (const url of [
      'app://effinance/%5C..%5Cresources.pak', // "/\..\x": a UNC-looking prefix that climbs one level
      'app://effinance/%5C..%5C..%5C..%5Csecrets.bin',
      'app://effinance/C:%5CWindows%5Cwin.ini',
      'app://effinance/C:/Windows/win.ini',
      'app://effinance/index.html::$DATA',
      'app://effinance/assets/x.js%00.png',
      'app://effinance/%E0%A4%A',
    ]) {
      expect(win(url), url).toBeNull();
    }
    // Climbing with encoded separators is clamped inside the folder (404 there).
    expect(win('app://effinance/..%5C..%5Csecrets.bin')).toBe(`${root}\\secrets.bin`);
    expect(win('app://effinance/%5C%5Cattacker%5Cshare%5Cx')).toBe(`${root}\\attacker\\share\\x`);
  });
});

describe('Drive queries', () => {
  it('escapes quotes and backslashes in q literals', () => {
    expect(driveQueryLiteral('abc123')).toBe("'abc123'");
    expect(driveQueryLiteral("x' or name contains 'a")).toBe("'x\\' or name contains \\'a'");
    expect(driveQueryLiteral('a\\b')).toBe("'a\\\\b'");
  });
});
