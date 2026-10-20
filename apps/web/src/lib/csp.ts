// Content Security Policy of the production build. Imported by vite.config.ts (a <meta> tag in
// dist/index.html) and by the tests; the CDN must send the same policy as a header, plus the
// directives a <meta> cannot carry (frame-ancestors, report-to) — see docs/deploy-aws.md.

/**
 * sha256 of the inline theme script in index.html (applies the saved theme before first paint).
 * Changing that script changes the hash: update this constant and the CDN header (a test fails
 * until they match).
 */
export const THEME_SCRIPT_HASH = "'sha256-1RAEjxRbXn1nFd1C4BtquRjKkwKE4vDUkRZRzxN1WPc='";

export interface CspOptions {
  /** `'sha256-…'` sources of the inline scripts of index.html. */
  scriptHashes: string[];
  /** Header-only directives (ignored in <meta>): frame-ancestors, upgrade-insecure-requests. */
  header?: boolean;
  /** Demo build: PGlite compiles WebAssembly in the page. */
  demo?: boolean;
}

export function contentSecurityPolicy({ scriptHashes, header = false, demo = false }: CspOptions): string {
  const directives: [string, ...string[]][] = [
    ['default-src', "'self'"],
    ['script-src', "'self'", ...(demo ? ["'wasm-unsafe-eval'"] : []), ...scriptHashes],
    // Radix (Select/ScrollArea) and sonner inject <style> elements at runtime; React's `style` prop
    // goes through CSSOM and needs no allowance. Scripts stay strict.
    ['style-src', "'self'", "'unsafe-inline'"],
    ['img-src', "'self'", 'data:', 'blob:'],
    ['font-src', "'self'"],
    ['connect-src', "'self'"],
    ['worker-src', "'self'", 'blob:'],
    ['manifest-src', "'self'"],
    ['frame-src', "'none'"],
    ['object-src', "'none'"],
    ['base-uri', "'self'"],
    ['form-action', "'self'"],
  ];
  if (header) directives.push(['frame-ancestors', "'none'"], ['upgrade-insecure-requests']);
  return directives.map((d) => d.join(' ')).join('; ');
}

/** Inline (non-`src`) scripts of an HTML document, as CSP hash sources. */
export async function inlineScriptHashes(html: string): Promise<string[]> {
  const bodies = [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]!);
  return Promise.all(
    bodies.map(async (body) => {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
      return `'sha256-${btoa(String.fromCharCode(...new Uint8Array(digest)))}'`;
    }),
  );
}
