ALTER TABLE "accounts" DROP CONSTRAINT "accounts_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "categories" DROP CONSTRAINT "categories_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "contacts" DROP CONSTRAINT "contacts_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "credit_cards" DROP CONSTRAINT "credit_cards_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "goal_contributions" DROP CONSTRAINT "goal_contributions_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "goals" DROP CONSTRAINT "goals_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "recurrences" DROP CONSTRAINT "recurrences_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_user_id_users_id_fk";
--> statement-breakpoint
DROP INDEX "accounts_user_idx";--> statement-breakpoint
DROP INDEX "categories_user_idx";--> statement-breakpoint
DROP INDEX "contacts_user_idx";--> statement-breakpoint
DROP INDEX "credit_cards_user_idx";--> statement-breakpoint
DROP INDEX "goals_user_idx";--> statement-breakpoint
DROP INDEX "recurrences_pending_idx";--> statement-breakpoint
DROP INDEX "transactions_user_date_idx";--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "categories" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_cards" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "goal_contributions" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "goals" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "recurrences" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" DROP COLUMN "user_id";--> statement-breakpoint
ALTER TABLE "categories" DROP COLUMN "user_id";--> statement-breakpoint
ALTER TABLE "contacts" DROP COLUMN "user_id";--> statement-breakpoint
ALTER TABLE "credit_cards" DROP COLUMN "user_id";--> statement-breakpoint
ALTER TABLE "goal_contributions" DROP COLUMN "user_id";--> statement-breakpoint
ALTER TABLE "goals" DROP COLUMN "user_id";--> statement-breakpoint
ALTER TABLE "recurrences" DROP COLUMN "user_id";--> statement-breakpoint
ALTER TABLE "transactions" DROP COLUMN "user_id";--> statement-breakpoint
-- Row Level Security on every financial table. Tenant requests run, inside their transaction,
-- `SET LOCAL ROLE effinance_app` (NOLOGIN, no BYPASSRLS, not the table owner) and
-- `set_config('app.workspace_id', <active workspace>, true)`. Without the setting no row matches.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'effinance_app') THEN
    CREATE ROLE effinance_app NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;--> statement-breakpoint
GRANT effinance_app TO CURRENT_USER;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO effinance_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "categories", "accounts", "credit_cards", "goals", "goal_contributions", "contacts", "recurrences", "transactions" TO effinance_app;--> statement-breakpoint
ALTER TABLE "categories" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "categories" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "categories_tenant_isolation" ON "categories" USING ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "accounts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "accounts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "accounts_tenant_isolation" ON "accounts" USING ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "credit_cards" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "credit_cards" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "credit_cards_tenant_isolation" ON "credit_cards" USING ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "goals" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "goals" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "goals_tenant_isolation" ON "goals" USING ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "goal_contributions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "goal_contributions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "goal_contributions_tenant_isolation" ON "goal_contributions" USING ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "contacts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "contacts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "contacts_tenant_isolation" ON "contacts" USING ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "recurrences" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "recurrences" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "recurrences_tenant_isolation" ON "recurrences" USING ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "transactions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "transactions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "transactions_tenant_isolation" ON "transactions" USING ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
