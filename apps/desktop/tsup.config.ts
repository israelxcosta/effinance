import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// Electron main and preload as CommonJS (a sandboxed preload must be CJS). Electron is external;
// everything else is bundled, so the installer ships no node_modules.
export default defineConfig({
  entry: { main: 'src/main.ts', preload: 'src/preload.ts' },
  format: ['cjs'],
  outExtension: () => ({ js: '.cjs' }),
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: false,
  external: ['electron'],
  // Google OAuth client for Drive backups, from GitHub secrets at release time (optional: the app
  // also accepts them in Configurações > Backup). Desktop OAuth clients are not confidential.
  env: {
    EFFINANCE_VERSION: version,
    GOOGLE_OAUTH_CLIENT_ID: process.env.GOOGLE_OAUTH_CLIENT_ID ?? '',
    GOOGLE_OAUTH_CLIENT_SECRET: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? '',
  },
});
