// Google Drive backups: OAuth for installed apps (system browser + loopback redirect + PKCE) and the
// Drive REST API. Scope `drive.file`: the app sees only the files it created (the
// "Effinance Backups" folder), never the rest of the person's Drive.

import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dayOfFile } from './backup-file';
import type { Store } from './store';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
export const DRIVE_SCOPES = 'openid email https://www.googleapis.com/auth/drive.file';
export const FOLDER_NAME = 'Effinance Backups';
const SIGN_IN_TIMEOUT_MS = 5 * 60_000;

export interface DriveStatus {
  configured: boolean;
  connected: boolean;
  email: string | null;
}

export interface DriveFile {
  id: string;
  name: string;
  day: string;
  size: number;
}

export interface DriveDeps {
  store: Store;
  fetch?: typeof fetch;
  openExternal: (url: string) => Promise<void>;
  /** OAuth client baked in at build time (GitHub secrets), used when none was typed in the app. */
  defaultClient?: { id: string; secret: string } | null;
}

export class DriveError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'DriveError';
  }
}

const base64Url = (b: Buffer) => b.toString('base64url');

/** A string literal for a Drive `q` query: backslashes and single quotes escaped. */
export function driveQueryLiteral(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** Email claim of a Google id_token (display only; the token came straight from Google over TLS). */
export function emailFromIdToken(idToken: string | undefined): string | null {
  try {
    const payload = JSON.parse(Buffer.from(idToken!.split('.')[1]!, 'base64url').toString('utf8')) as { email?: string };
    return payload.email ?? null;
  } catch {
    return null;
  }
}

export function buildAuthUrl(clientId: string, redirectUri: string, challenge: string, state: string): string {
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: DRIVE_SCOPES,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    access_type: 'offline',
    prompt: 'consent',
  });
  return `${AUTH_URL}?${q}`;
}

const DONE_PAGE = `<!doctype html><meta charset="utf-8"><title>Effinance</title>
<body style="font:16px system-ui;display:grid;place-items:center;height:90vh;color:#16181d">
<div><h1 style="font-size:22px">Google Drive conectado</h1><p>Pode fechar esta aba e voltar ao Effinance.</p></div>`;

export class GoogleDrive {
  private readonly fetch: typeof fetch;
  private accessToken: { value: string; expiresAt: number } | null = null;

  constructor(private readonly deps: DriveDeps) {
    this.fetch = deps.fetch ?? fetch;
  }

  private client(): { id: string; secret: string } | null {
    const s = this.deps.store.secrets();
    if (s.driveClientId && s.driveClientSecret) return { id: s.driveClientId, secret: s.driveClientSecret };
    return this.deps.defaultClient ?? null;
  }

  status(): DriveStatus {
    const s = this.deps.store.secrets();
    return { configured: this.client() !== null, connected: Boolean(s.driveRefreshToken), email: s.driveEmail ?? null };
  }

  configure(clientId: string, clientSecret: string): DriveStatus {
    if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(clientId)) throw new DriveError('O ID do cliente termina em “.apps.googleusercontent.com”.');
    if (clientSecret.length < 10) throw new DriveError('A chave secreta do cliente parece incompleta.');
    this.deps.store.updateSecrets({ driveClientId: clientId, driveClientSecret: clientSecret, driveRefreshToken: undefined, driveEmail: undefined });
    this.accessToken = null;
    return this.status();
  }

  /** Opens the browser for consent and waits for Google to redirect back to a local port. */
  async connect(): Promise<DriveStatus> {
    const client = this.client();
    if (!client) throw new DriveError('Cadastre primeiro as credenciais do Google Cloud.');
    const verifier = base64Url(randomBytes(32));
    const challenge = base64Url(createHash('sha256').update(verifier).digest());
    const state = base64Url(randomBytes(16));

    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const code = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new DriveError('O login no Google não foi concluído a tempo. Tente de novo.')), SIGN_IN_TIMEOUT_MS);
        server.on('request', (req, res) => {
          const url = new URL(req.url ?? '/', redirectUri);
          if (url.pathname !== '/') return void res.writeHead(404).end();
          const error = url.searchParams.get('error');
          const got = url.searchParams.get('code');
          if (url.searchParams.get('state') !== state || (!got && !error)) return void res.writeHead(400).end('Pedido inválido.');
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(error ? DONE_PAGE.replace('conectado', 'não conectado') : DONE_PAGE);
          clearTimeout(timer);
          if (error) reject(new DriveError(error === 'access_denied' ? 'Você não autorizou o acesso ao Google Drive.' : `O Google recusou o login (${error}).`));
          else resolve(got!);
        });
        void this.deps.openExternal(buildAuthUrl(client.id, redirectUri, challenge, state));
      });
      const tokens = await this.tokenRequest({
        code,
        client_id: client.id,
        client_secret: client.secret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        code_verifier: verifier,
      });
      if (!tokens.refresh_token) throw new DriveError('O Google não devolveu o acesso permanente. Tente conectar de novo.');
      this.deps.store.updateSecrets({ driveRefreshToken: tokens.refresh_token, driveEmail: emailFromIdToken(tokens.id_token) ?? undefined });
      this.deps.store.updateSettings({ driveFolderId: undefined });
      this.remember(tokens);
      return this.status();
    } finally {
      server.close();
    }
  }

  async disconnect(): Promise<DriveStatus> {
    const token = this.deps.store.secrets().driveRefreshToken;
    if (token) await this.fetch(`${REVOKE_URL}?token=${encodeURIComponent(token)}`, { method: 'POST' }).catch(() => undefined);
    this.deps.store.updateSecrets({ driveRefreshToken: undefined, driveEmail: undefined });
    this.deps.store.updateSettings({ driveFolderId: undefined });
    this.accessToken = null;
    return this.status();
  }

  async list(): Promise<DriveFile[]> {
    return this.inFolder(async (folder) => {
    const q = encodeURIComponent(`${driveQueryLiteral(folder)} in parents and trashed = false`);
    const res = await this.api(`${API}/files?q=${q}&fields=files(id,name,size)&pageSize=200&spaces=drive`);
    const { files } = (await res.json()) as { files: { id: string; name: string; size?: string }[] };
    return files
      .map((f) => ({ id: f.id, name: f.name, day: dayOfFile(f.name), size: Number(f.size ?? 0) }))
      .filter((f): f is DriveFile => f.day !== null)
      .sort((a, b) => b.day.localeCompare(a.day));
    });
  }

  /** Creates the file, or replaces the content of the one with the same name (one per day). */
  async upload(name: string, text: string, existing: DriveFile[]): Promise<string> {
    const same = existing.find((f) => f.name === name);
    if (same) {
      await this.api(`${UPLOAD}/files/${encodeURIComponent(same.id)}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: text });
      return same.id;
    }
    return this.inFolder(async (folder) => {
      const boundary = `effinance-${randomBytes(8).toString('hex')}`;
      const metadata = JSON.stringify({ name, parents: [folder], mimeType: 'text/plain' });
      const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${text}\r\n--${boundary}--`;
      const res = await this.api(`${UPLOAD}/files?uploadType=multipart&fields=id`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
      return ((await res.json()) as { id: string }).id;
    });
  }

  /** Runs with the backup folder id; if the folder was deleted in the Drive, finds/creates it again once. */
  private async inFolder<T>(fn: (folder: string) => Promise<T>): Promise<T> {
    try {
      return await fn(await this.folderId());
    } catch (e) {
      if (!(e instanceof DriveError) || e.status !== 404) throw e;
      this.deps.store.updateSettings({ driveFolderId: undefined });
      return fn(await this.folderId());
    }
  }

  async download(id: string): Promise<string> {
    return (await this.api(`${API}/files/${encodeURIComponent(id)}?alt=media`)).text();
  }

  async remove(id: string): Promise<void> {
    await this.api(`${API}/files/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  private async folderId(): Promise<string> {
    const cached = this.deps.store.settings().driveFolderId;
    if (cached) return cached;
    const q = encodeURIComponent(`name = ${driveQueryLiteral(FOLDER_NAME)} and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);
    const found = (await (await this.api(`${API}/files?q=${q}&fields=files(id)&spaces=drive`)).json()) as { files: { id: string }[] };
    let id = found.files[0]?.id;
    if (!id) {
      const res = await this.api(`${API}/files?fields=id`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
      });
      id = ((await res.json()) as { id: string }).id;
    }
    this.deps.store.updateSettings({ driveFolderId: id });
    return id;
  }

  private async api(url: string, init: RequestInit = {}, retried = false): Promise<Response> {
    const token = await this.token();
    const res = await this.fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` } });
    if (res.status === 401 && !retried) {
      this.accessToken = null;
      return this.api(url, init, true);
    }
    if (!res.ok) throw new DriveError(`O Google Drive respondeu com erro (${res.status}).`, res.status);
    return res;
  }

  private async token(): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAt > Date.now() + 30_000) return this.accessToken.value;
    const client = this.client();
    const refresh = this.deps.store.secrets().driveRefreshToken;
    if (!client || !refresh) throw new DriveError('O Google Drive não está conectado.');
    try {
      const tokens = await this.tokenRequest({ client_id: client.id, client_secret: client.secret, refresh_token: refresh, grant_type: 'refresh_token' });
      return this.remember(tokens);
    } catch (e) {
      if (e instanceof DriveError && e.message.includes('invalid_grant')) {
        // Access revoked in the Google account: ask to connect again.
        this.deps.store.updateSecrets({ driveRefreshToken: undefined, driveEmail: undefined });
        throw new DriveError('O acesso ao Google Drive foi revogado. Conecte de novo em Configurações > Backup.');
      }
      throw e;
    }
  }

  private remember(tokens: TokenResponse): string {
    this.accessToken = { value: tokens.access_token, expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000 };
    return tokens.access_token;
  }

  private async tokenRequest(form: Record<string, string>): Promise<TokenResponse> {
    const res = await this.fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() });
    const body = (await res.json().catch(() => ({}))) as TokenResponse & { error?: string };
    if (!res.ok || !body.access_token) throw new DriveError(`O Google recusou as credenciais (${body.error ?? res.status}).`);
    return body;
  }
}

interface TokenResponse {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  id_token?: string;
}
