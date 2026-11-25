// app://effinance/… serves the web build (apps/web/dist-desktop). A standard, secure scheme gives the
// page a real origin: IndexedDB (the database), fetch of its own assets and WebAssembly all work,
// which file:// would not allow.

import { readFile } from 'node:fs/promises';
import { extname, normalize, relative, resolve, sep } from 'node:path';

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

/** Absolute file for a request URL, or null when it is outside the renderer folder. */
export function resolveAsset(root: string, url: string): string | null {
  const { host, pathname } = new URL(url);
  if (host !== HOST) return null;
  const path = decodeURIComponent(pathname) === '/' ? '/index.html' : decodeURIComponent(pathname);
  const file = resolve(root, `.${normalize(path)}`);
  const rel = relative(root, file);
  if (!rel || rel.startsWith('..') || rel.includes(`..${sep}`)) return null;
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
