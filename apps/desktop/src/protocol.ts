// app://effinance/… serves the web build (apps/web/dist-desktop). A standard, secure scheme gives the
// page a real origin: IndexedDB (the database), fetch of its own assets and WebAssembly all work,
// which file:// would not allow.

import { readFile } from 'node:fs/promises';
import nodePath, { extname } from 'node:path';

export const SCHEME = 'app';
export const HOST = 'effinance';
export const APP_URL = `${SCHEME}://${HOST}/index.html`;

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * Absolute file for a request URL, or null when it is outside the renderer folder. `paths` is the
 * platform's path module (the tests pass `path.win32` to check backslashes, UNC and drive letters).
 */
export function resolveAsset(root: string, url: string, paths: typeof nodePath = nodePath): string | null {
  const { host, pathname } = new URL(url);
  if (host !== HOST) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null; // malformed %-escape
  }
  // NUL, and `:` (Windows drive letters and NTFS alternate data streams such as `index.html::$DATA`).
  if (/[\0:]/.test(decoded)) return null;
  const path = decoded === '/' ? '/index.html' : decoded;
  const file = paths.resolve(root, `.${paths.normalize(path)}`);
  const rel = paths.relative(root, file);
  if (!rel || paths.isAbsolute(rel) || rel === '..' || rel.startsWith(`..${paths.sep}`) || rel.split(paths.sep).includes('..')) return null;
  return file;
}

export async function serveAsset(root: string, request: Request): Promise<Response> {
  const file = resolveAsset(root, request.url);
  if (!file) return new Response('Not found', { status: 404 });
  try {
    const body = await readFile(file);
    return new Response(body, {
      headers: { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
