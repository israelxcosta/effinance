/** Superuser connection: migrations, resets and raw assertions in tests. */
export const ADMIN_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/effinance_test';

/** Login role the app uses in tests (mirrors `effinance_api` in production; also in vitest.config.ts). */
export const API_ROLE = 'effinance_api_test';
export const API_ROLE_PASSWORD = 'effinance_api_test';

/**
 * Least privilege of the API login on the tables outside RLS (mirror of docs/deploy-aws.md).
 * Only what the code issues: sessions/subscriptions/billing events are never deleted by the API
 * (ON DELETE cascades run as the table owner), and the audit trail is append-only.
 */
export const IDENTITY_GRANTS = {
  users: ['select', 'insert', 'update', 'delete'],
  workspaces: ['select', 'insert', 'update', 'delete'],
  workspace_members: ['select', 'insert', 'update', 'delete'],
  workspace_invites: ['select', 'insert', 'update', 'delete'],
  subscriptions: ['select', 'insert', 'update'],
  billing_events: ['select', 'insert', 'update'],
  sessions: ['select', 'insert', 'update'],
  password_resets: ['select', 'insert', 'update', 'delete'],
  audit_logs: ['select', 'insert'],
  // Open Finance webhooks (migration 0005): platform keys are written once; the webhook index is
  // only inserted (rows go away with the connection, by cascade); events get `processed_at`.
  platform_keys: ['select', 'insert'],
  open_finance_items: ['select', 'insert'],
  open_finance_events: ['select', 'insert', 'update'],
} as const satisfies Record<string, readonly ('select' | 'insert' | 'update' | 'delete')[]>;

/** Tables outside RLS that the API reads/writes with its own login role. */
export const IDENTITY_TABLES = Object.keys(IDENTITY_GRANTS) as (keyof typeof IDENTITY_GRANTS)[];

/** Financial tables: only reachable through `SET LOCAL ROLE effinance_app` (RLS). */
export const TENANT_TABLES = [
  'categories',
  'accounts',
  'credit_cards',
  'goals',
  'goal_contributions',
  'contacts',
  'recurrences',
  'transactions',
  'import_batches',
  'bank_connections',
  'bank_connection_accounts',
  'import_tombstones',
] as const;
