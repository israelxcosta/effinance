import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, inlineScriptHashes, PLUGGY_CONNECT_ORIGIN, THEME_SCRIPT_HASH } from './csp';

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
  it('Zod runs without eval: index.html sets its global config before any module loads', async () => {
    expect(indexHtml).toContain('window.__zod_globalConfig = { jitless: true };');
    // The flag only works while Zod keeps reading this global (checked against the installed version).
    const { globalConfig } = await import('zod/v4/core');
    expect(globalConfig).toBe((globalThis as { __zod_globalConfig?: unknown }).__zod_globalConfig);
  });

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
    expect(csp.get('img-src')).toEqual(["'self'", 'data:', 'blob:']);
    // The only external origin: the Open Finance consent widget, and only as a frame.
    expect(csp.get('frame-src')).toEqual([PLUGGY_CONNECT_ORIGIN]);
    const external = [...csp.values()].flat().filter((v) => /^https?:/.test(v));
    expect(external).toEqual([PLUGGY_CONNECT_ORIGIN]);
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
    // Simulated Open Finance provider in the demo: no third-party frame at all.
    expect(csp.get('frame-src')).toEqual(["'none'"]);
  });

  it('frame-src matches the origin the installed Pluggy Connect SDK frames', () => {
    // If the SDK changes where the widget lives, this fails before the widget breaks in production.
    const require = createRequire(import.meta.url);
    const sdk = dirname(require.resolve('pluggy-connect-sdk/package.json'));
    const source = readFileSync(join(sdk, 'dist/module/pluggy-connect.js'), 'utf8');
    expect(source).toContain(`const CONNECT_PRODUCTION_URL = '${PLUGGY_CONNECT_ORIGIN}';`);
    expect(new URL(PLUGGY_CONNECT_ORIGIN).origin).toBe(PLUGGY_CONNECT_ORIGIN);
  });
});
