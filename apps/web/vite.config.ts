import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { contentSecurityPolicy, inlineScriptHashes } from './src/lib/csp.js';

const apiProxy = {
  '/api': {
    target: process.env.VITE_API_URL ?? 'http://localhost:3333',
    changeOrigin: true,
  },
};

/**
 * Emits PGlite's filesystem bundle as gzip+base64 text (assets/pglite-fs.txt). It is ~2.5 MB instead
 * of 6 MB and can be served by static hosts that refuse `.data` files. Loaded by src/demo/server.ts.
 */
function pgliteFsBundle(): Plugin {
  return {
    name: 'effinance:pglite-fs-bundle',
    apply: 'build',
    generateBundle() {
      const data = readFileSync(
        fileURLToPath(new URL('../api/node_modules/@electric-sql/pglite/dist/pglite.data', import.meta.url)),
      );
      this.emitFile({
        type: 'asset',
        fileName: 'assets/pglite-fs.txt',
        source: gzipSync(data, { level: 9 }).toString('base64'),
      });
    },
  };
}

/**
 * Production build: a CSP <meta> right after the charset, with the hashes of the inline scripts.
 * The CDN sends the same policy as a header plus frame-ancestors (not allowed in <meta>). The demo
 * build gets none: its host embeds the page in its own HTML, where a <meta> CSP would also bind
 * the host's scripts.
 */
function cspMeta(): Plugin {
  return {
    name: 'effinance:csp-meta',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      async handler(html) {
        const policy = contentSecurityPolicy({ scriptHashes: await inlineScriptHashes(html) });
        const charset = /<meta charset="UTF-8" \/>/i;
        if (!charset.test(html)) throw new Error('index.html: <meta charset> not found, CSP not injected');
        return html.replace(charset, (tag) => `${tag}\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`);
      },
    },
  };
}

// `--mode demo` builds a self-contained app: the API route plugins run in the browser on PGlite.
export default defineConfig(({ mode }) => {
  const demo = mode === 'demo';
  return {
    base: demo ? './' : '/',
    plugins: [react(), tailwindcss(), ...(demo ? [pgliteFsBundle()] : [cspMeta()])],
    resolve: {
      alias: [
        { find: '@api', replacement: fileURLToPath(new URL('../api/src', import.meta.url)) },
        { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
        // API services hash passwords with node:crypto; the browser build swaps in WebCrypto.
        {
          find: /^\.\.\/\.\.\/lib\/password$/,
          replacement: fileURLToPath(new URL('./src/demo/password.ts', import.meta.url)),
        },
      ],
    },
    define: {
      'import.meta.env.VITE_DEMO': JSON.stringify(demo ? 'true' : 'false'),
      // Only read by the API clock (test pinning); never set in the browser.
      'process.env.EFFINANCE_TODAY': 'undefined',
    },
    optimizeDeps: {
      exclude: ['@electric-sql/pglite'],
    },
    server: { port: 5173, proxy: apiProxy },
    preview: { port: 4173, proxy: apiProxy },
    build: {
      outDir: demo ? 'dist-demo' : 'dist',
      // Never publish source maps (they would expose the full source and comments).
      sourcemap: false,
      // Fonts stay files: inlined as data: URLs they would need `font-src data:` in the CSP.
      assetsInlineLimit: (file: string) => (/\.(woff2?|ttf|otf)$/i.test(file) ? false : undefined),
      chunkSizeWarningLimit: 900,
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-')) return 'charts';
            if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')) return 'react';
            return undefined;
          },
        },
      },
    },
  };
});
