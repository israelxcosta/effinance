import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, inlineScriptHashes, THEME_SCRIPT_HASH } from './csp';

const indexHtml = readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf8');

function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy.split(';').map((d) => {
      const [name, ...values] = d.trim().split(/\s+/);
      return [name!, values];
    }),
  );
}

describe('Content Security Policy', () => {
  it('the documented hash (CDN header) matches the inline theme script of index.html', async () => {
    // If this fails, the theme script changed: update THEME_SCRIPT_HASH and the CloudFront policy.
    expect(await inlineScriptHashes(indexHtml)).toEqual([THEME_SCRIPT_HASH]);
  });

  it('production policy: strict scripts, no plugins, no framing, same-origin network', () => {
    const csp = directives(contentSecurityPolicy({ scriptHashes: [THEME_SCRIPT_HASH], header: true }));
    expect(csp.get('default-src')).toEqual(["'self'"]);
    expect(csp.get('script-src')).toEqual(["'self'", THEME_SCRIPT_HASH]);
    expect(csp.get('object-src')).toEqual(["'none'"]);
    expect(csp.get('base-uri')).toEqual(["'self'"]);
    expect(csp.get('form-action')).toEqual(["'self'"]);
    expect(csp.get('frame-ancestors')).toEqual(["'none'"]);
    expect(csp.get('connect-src')).toEqual(["'self'"]);
    const all = [...csp.values()].flat();
    expect(all).not.toContain("'unsafe-eval'");
    expect(all).not.toContain("'wasm-unsafe-eval'");
    expect(csp.get('script-src')).not.toContain("'unsafe-inline'");
  });

  it('<meta> policy leaves out header-only directives', () => {
    const csp = directives(contentSecurityPolicy({ scriptHashes: [THEME_SCRIPT_HASH] }));
    expect(csp.has('frame-ancestors')).toBe(false);
    expect(csp.has('upgrade-insecure-requests')).toBe(false);
  });

  it('demo policy only adds WebAssembly compilation, never eval', () => {
    const csp = directives(contentSecurityPolicy({ scriptHashes: [THEME_SCRIPT_HASH], demo: true }));
    expect(csp.get('script-src')).toEqual(["'self'", "'wasm-unsafe-eval'", THEME_SCRIPT_HASH]);
  });
});
