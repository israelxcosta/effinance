// Pure security checks of the Electron shell (no Electron import: they run in the tests as plain
// Node). main.ts applies them to IPC, navigation, new windows and permission requests.

import { HOST, SCHEME } from './protocol';

/** True for app://effinance/… — the only origin the window may show and the only IPC caller. */
export function isAppUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  try {
    // `app:` is not a WHATWG "special" scheme: URL.origin is "null", so compare protocol and host.
    const u = new URL(url);
    return u.protocol === `${SCHEME}:` && u.host === HOST && !u.username && !u.password;
  } catch {
    return false;
  }
}

/** What main.ts needs of `event.senderFrame` (Electron.WebFrameMain). */
export interface SenderFrame {
  url: string;
  parent: unknown;
}

/**
 * IPC comes only from the app's own top-level page. A frame (none today: `frame-src 'none'`) or a
 * page that somehow left app://effinance/ gets nothing: not the master key, not the backups.
 */
export function isTrustedSender(frame: SenderFrame | null | undefined): boolean {
  return Boolean(frame) && frame!.parent === null && isAppUrl(frame!.url);
}

/**
 * Links that may leave the app for the system browser: `https:` only, no credentials in the URL.
 * Never `file:`, `smb:`, `ms-*:` or other schemes Windows would hand to a local program.
 * Returns the normalized URL, or null.
 */
export function externalUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.username || u.password || !u.hostname) return null;
    return u.href;
  } catch {
    return null;
  }
}

/**
 * Browser permissions the page may get. Electron grants every request by default (camera,
 * microphone, location, notifications, USB/HID/serial…); the app only copies text to the clipboard.
 */
const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write']);

export function isPermissionAllowed(permission: string, requestingUrl: string | undefined | null): boolean {
  return ALLOWED_PERMISSIONS.has(permission) && isAppUrl(requestingUrl);
}

// --- IPC arguments -----------------------------------------------------------------------------

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Google Drive file ids: letters, digits, `-` and `_`. */
const DRIVE_ID_RE = /^[A-Za-z0-9_-]{1,256}$/;

export type RestoreRequest = { kind: 'file' } | { kind: 'local'; date: string } | { kind: 'drive'; id: string };

export class IpcArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IpcArgumentError';
  }
}

/** The renderer's restore choice, validated: a day of this computer's folder or a Drive file id. */
export function parseRestoreSource(raw: unknown): RestoreRequest {
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  if (source.kind === 'file') return { kind: 'file' };
  if (source.kind === 'local' && typeof source.date === 'string' && DAY_RE.test(source.date)) return { kind: 'local', date: source.date };
  if (source.kind === 'drive' && typeof source.id === 'string' && DRIVE_ID_RE.test(source.id)) return { kind: 'drive', id: source.id };
  throw new IpcArgumentError('Origem do backup inválida.');
}

/** A string argument from the renderer, with a length cap (passwords, OAuth client fields, keys). */
export function stringArg(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length > max) throw new IpcArgumentError('Valor inválido.');
  return value;
}
