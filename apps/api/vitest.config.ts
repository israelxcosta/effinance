import { defineConfig } from 'vitest/config';

// Keep in sync with test/db-roles.ts (the config is loaded before TS path handling).
const ADMIN_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/effinance_test';
const appUrl = new URL(ADMIN_URL);
appUrl.username = 'effinance_api_test';
appUrl.password = 'effinance_api_test';

export default defineConfig({
  test: {
    // All files share one database, so they run one at a time.
    fileParallelism: false,
    globalSetup: ['./test/global-setup.ts'],
    testTimeout: 20_000,
    hookTimeout: 30_000,
    env: {
      NODE_ENV: 'test',
      // The app connects with a least-privileged role (see test/global-setup.ts); tests use
      // ADMIN_DATABASE_URL for resets and raw checks.
      DATABASE_URL: appUrl.toString(),
      ADMIN_DATABASE_URL: ADMIN_URL,
      JWT_SECRET: 'test-secret-with-at-least-32-characters!!',
      LOG_LEVEL: 'silent',
      EFFINANCE_TODAY: '2026-10-20',
    },
  },
});
