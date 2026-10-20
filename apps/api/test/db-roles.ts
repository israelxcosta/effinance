/** Superuser connection: migrations, resets and raw assertions in tests. */
export const ADMIN_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/effinance_test';

/** Login role the app uses in tests (mirrors `effinance_api` in production; also in vitest.config.ts). */
export const API_ROLE = 'effinance_api_test';
export const API_ROLE_PASSWORD = 'effinance_api_test';

/** Tables outside RLS that the API reads/writes with its own login role. */
export const IDENTITY_TABLES = [
  'users',
  'workspaces',
  'workspace_members',
  'workspace_invites',
  'subscriptions',
  'billing_events',
  'sessions',
  'password_resets',
  'audit_logs',
] as const;
