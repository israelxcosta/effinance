import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildAuthUrl, DRIVE_SCOPES, emailFromIdToken, FOLDER_NAME, GoogleDrive } from './drive';
import { Store, type Encryptor } from './store';

const enc: Encryptor = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(s).reverse(),
  decryptString: (b) => Buffer.from(b).reverse().toString(),
};
const CLIENT_ID = '123-abc.apps.googleusercontent.com';
const idToken = (email: string) => `x.${Buffer.from(JSON.stringify({ email })).toString('base64url')}.y`;

/** A tiny Google: token endpoint + Drive files API kept in memory. */
function fakeGoogle() {
  const calls: { method: string; url: string; body?: string }[] = [];
  const files = new Map<string, { name: string; parents?: string[]; mimeType?: string; text?: string }>();
  let seq = 0;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const fakeFetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? init.body : undefined;
    calls.push({ method, url: url.toString(), body });
    if (url.href === 'https://oauth2.googleapis.com/token') {
      const form = new URLSearchParams(body);
      if (form.get('grant_type') === 'authorization_code') {
        expect(form.get('code')).toBe('the-code');
        expect(form.get('code_verifier')).toHaveLength(43);
        return json({ access_token: 'at-1', expires_in: 3600, refresh_token: 'rt-1', id_token: idToken('eu@gmail.com') });
      }
      return json({ access_token: 'at-2', expires_in: 3600 });
    }
    if (url.href.startsWith('https://oauth2.googleapis.com/revoke')) return new Response(null, { status: 200 });
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^Bearer at-/);
    const fileId = url.pathname.split('/files/')[1];
    const isUpload = url.pathname.startsWith('/upload/');
    if (url.pathname.endsWith('/drive/v3/files') && method === 'GET') {
      const q = url.searchParams.get('q')!;
      const parent = /'([^']+)' in parents/.exec(q)?.[1];
      const list = [...files.entries()]
        .filter(([, f]) => (parent ? f.parents?.includes(parent) : q.includes(`name = '${f.name}'`) && f.mimeType?.includes('folder')))
        .map(([id, f]) => ({ id, name: f.name, size: String(f.text?.length ?? 0) }));
      return json({ files: list });
    }
    if (!isUpload && url.pathname.endsWith('/drive/v3/files') && method === 'POST') {
      const id = `f${++seq}`;
      files.set(id, JSON.parse(body!));
      return json({ id });
    }
    if (url.pathname.endsWith('/upload/drive/v3/files') && method === 'POST') {
      const [, meta, text] = /\r\n\r\n(\{.*?\})\r\n--[^\r]+\r\nContent-Type: text\/plain; charset=UTF-8\r\n\r\n([\s\S]*)\r\n--/.exec(body!)!;
      const id = `f${++seq}`;
      files.set(id, { ...JSON.parse(meta!), text });
      return json({ id });
    }
    if (fileId && method === 'PATCH') {
      files.get(fileId)!.text = body;
      return json({ id: fileId });
    }
    if (fileId && method === 'GET') return new Response(files.get(fileId)?.text ?? '', { status: files.has(fileId) ? 200 : 404 });
    if (fileId && method === 'DELETE') return new Response(null, { status: files.delete(fileId) ? 204 : 404 });
    return json({ error: 'unexpected' }, 500);
  }) as typeof globalThis.fetch;
  return { fetch: fakeFetch, calls, files };
}

describe('Google Drive', () => {
  it('builds a PKCE consent URL with the narrow drive.file scope', () => {
    const url = new URL(buildAuthUrl(CLIENT_ID, 'http://127.0.0.1:5000', 'chal', 'st'));
    expect(url.searchParams.get('scope')).toBe(DRIVE_SCOPES);
    expect(DRIVE_SCOPES).toContain('/auth/drive.file');
    expect(DRIVE_SCOPES).not.toMatch(/auth\/drive( |$)/);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(emailFromIdToken(idToken('a@b.com'))).toBe('a@b.com');
    expect(emailFromIdToken('lixo')).toBeNull();
  });

  it('signs in through the browser, then backs up into its own folder and revokes on disconnect', async () => {
    const google = fakeGoogle();
    const store = new Store(mkdtempSync(join(tmpdir(), 'effinance-drive-')), enc);
    const drive = new GoogleDrive({
      store,
      fetch: google.fetch,
      // The "browser": Google redirects back to the local port with the code and the same state.
      openExternal: async (consent) => {
        const u = new URL(consent);
        const back = new URL(u.searchParams.get('redirect_uri')!);
        expect(back.hostname).toBe('127.0.0.1');
        back.searchParams.set('code', 'the-code');
        back.searchParams.set('state', u.searchParams.get('state')!);
        const page = await fetch(back);
        expect(await page.text()).toContain('Google Drive conectado');
      },
    });
    expect(drive.status()).toEqual({ configured: false, connected: false, email: null });
    expect(() => drive.configure('nao-e-um-id', 'segredo-123456')).toThrow('apps.googleusercontent.com');
    drive.configure(CLIENT_ID, 'GOCSPX-segredo');

    expect(await drive.connect()).toEqual({ configured: true, connected: true, email: 'eu@gmail.com' });
    expect(store.secrets().driveRefreshToken).toBe('rt-1');

    expect(await drive.list()).toEqual([]);
    const folder = [...google.files.entries()].find(([, f]) => f.mimeType === 'application/vnd.google-apps.folder');
    expect(folder?.[1].name).toBe(FOLDER_NAME);

    const id = await drive.upload('effinance-backup-2026-11-25.txt', 'EFFINANCE-BACKUP 1\nabc', []);
    const listed = await drive.list();
    expect(listed).toEqual([{ id, name: 'effinance-backup-2026-11-25.txt', day: '2026-11-25', size: 22 }]);
    // Same day again: the file is updated in place, not duplicated.
    expect(await drive.upload('effinance-backup-2026-11-25.txt', 'novo', listed)).toBe(id);
    expect(await drive.download(id)).toBe('novo');
    await drive.remove(id);
    expect(await drive.list()).toEqual([]);

    expect(await drive.disconnect()).toEqual({ configured: true, connected: false, email: null });
    expect(google.calls.some((c) => c.url.startsWith('https://oauth2.googleapis.com/revoke?token=rt-1'))).toBe(true);
  });

  it('uses the OAuth client built into the installer when none was typed', () => {
    const store = new Store(mkdtempSync(join(tmpdir(), 'effinance-drive-')), enc);
    const drive = new GoogleDrive({ store, openExternal: async () => undefined, defaultClient: { id: CLIENT_ID, secret: 's' } });
    expect(drive.status()).toEqual({ configured: true, connected: false, email: null });
  });
});
