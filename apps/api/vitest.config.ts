import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // All files share one database, so they run one at a time.
    fileParallelism: false,
    globalSetup: ['./test/global-setup.ts'],
    testTimeout: 20_000,
    hookTimeout: 30_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/effinance_test',
      JWT_SECRET: 'test-secret-with-at-least-32-characters!!',
      LOG_LEVEL: 'silent',
      EFFINANCE_TODAY: '2026-10-20',
    },
  },
});
