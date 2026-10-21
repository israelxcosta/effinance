// Content Security Policy of the production build. Imported by vite.config.ts (a <meta> tag in
// dist/index.html) and by the tests; the CDN must send the same policy as a header, plus the
// directives a <meta> cannot carry (frame-ancestors, report-to) — see docs/deploy-aws.md.

/**
 * sha256 of the inline script in index.html (Zod without eval + the saved theme before first paint).
 * Changing that script changes the hash: update this constant and the CDN header (a test fails
 * until they match).
 */
export const THEME_SCRIPT_HASH = "'sha256-Tx3gv5eNbn+Hf+VoVYfVEoj6NuvY41vj9EhirVY+UE4='";

/**
 * Pluggy Connect, the Open Finance consent widget (`pluggy-connect-sdk`), renders an iframe from
 * this origin and exchanges postMessage with the page. It is the only third-party origin of the
 * policy: no external scripts, styles, images or API calls (the widget's own requests run inside
 * its iframe, under Pluggy's policy). Checked against the installed SDK in csp.test.ts.
 */
export const PLUGGY_CONNECT_ORIGIN = 'https://connect.pluggy.ai';

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
    // Only the bank consent widget may be framed (Open Finance). The demo uses the simulated
    // provider (no widget), so it frames nothing.
    ['frame-src', demo ? "'none'" : PLUGGY_CONNECT_ORIGIN],
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
