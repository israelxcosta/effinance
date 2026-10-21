-- 0005: imports of bank statements / card invoices (OFX, CSV) and read-only Open Finance connections.
-- Follows 0004: tenant tables carry workspace_id with ENABLE + FORCE RLS, UNIQUE (workspace_id, id),
-- composite foreign keys inside the workspace (SET NULL clears only the reference column), CHECKs
-- with the shared contract values and indexes behind every foreign key. Runs inside the migrator's
-- transaction (drizzle / PGlite demo): no CONCURRENTLY. Re-runnable (IF [NOT] EXISTS everywhere).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'effinance_app') THEN
    RAISE EXCEPTION 'role effinance_app is missing (migration 0003 / docs/deploy-aws.md)';
  END IF;
END
$$;
--> statement-breakpoint

-- 1. Open Finance connections (tenant) ---------------------------------------------------------------
-- provider_item_id / provider_account_id: the aggregator's ids are bearer references to the user's
-- bank data there, so they are stored encrypted with the workspace key (FieldCipher, AAD = workspace
-- + table + column) and looked up through a blind index (HMAC with a key derived from the same key).
CREATE TABLE IF NOT EXISTS "bank_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_item_id" text NOT NULL,
	"provider_item_hash" text NOT NULL,
	"institution_name" text NOT NULL,
	"institution_image_url" text,
	"institution_bank" text,
	"status" text NOT NULL,
	"status_detail" text,
	"consent_expires_at" timestamp with time zone,
	"last_sync_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_connections_workspace_id_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "bank_connections_provider_chk" CHECK ("bank_connections"."provider" in ('pluggy', 'fake')),
	CONSTRAINT "bank_connections_status_chk" CHECK ("bank_connections"."status" in ('syncing', 'active', 'login_error', 'waiting_user_input', 'outdated', 'error')),
	-- Rendered by the web as an <img>: never javascript:/data:/http: URLs from the provider.
	CONSTRAINT "bank_connections_image_url_chk" CHECK ("bank_connections"."institution_image_url" is null or "bank_connections"."institution_image_url" ~ '^https://')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bank_connection_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"provider_account_id" text NOT NULL,
	"provider_account_hash" text NOT NULL,
	"kind" text NOT NULL,
	"account_type" text,
	"name" text NOT NULL,
	"number" text,
	"balance" bigint,
	"credit_limit" bigint,
	"card_brand" text,
	"closing_day" integer,
	"due_day" integer,
	"linked_account_id" uuid,
	"linked_credit_card_id" uuid,
	"sync_from" date,
	"last_sync_at" timestamp with time zone,
	"cursor" text,
	"adjust_initial_balance" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_connection_accounts_workspace_id_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "bank_connection_accounts_kind_chk" CHECK ("bank_connection_accounts"."kind" in ('bank', 'credit_card')),
	CONSTRAINT "bank_connection_accounts_account_type_chk" CHECK ("bank_connection_accounts"."account_type" in ('checking', 'savings')),
	CONSTRAINT "bank_connection_accounts_card_brand_chk" CHECK ("bank_connection_accounts"."card_brand" in ('visa', 'mastercard', 'elo', 'amex', 'hipercard', 'diners', 'other')),
	CONSTRAINT "bank_connection_accounts_days_chk" CHECK (("bank_connection_accounts"."closing_day" is null or "bank_connection_accounts"."closing_day" between 1 and 31) and ("bank_connection_accounts"."due_day" is null or "bank_connection_accounts"."due_day" between 1 and 31)),
	-- A bank account feeds an account, a card feeds a card.
	CONSTRAINT "bank_connection_accounts_link_chk" CHECK (("bank_connection_accounts"."kind" = 'bank' or "bank_connection_accounts"."linked_account_id" is null) and ("bank_connection_accounts"."kind" = 'credit_card' or "bank_connection_accounts"."linked_credit_card_id" is null))
);
--> statement-breakpoint

-- 2. Import batches (tenant) -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"origin" text NOT NULL,
	"format" text,
	"file_name" text,
	"connection_id" uuid,
	"account_id" uuid,
	"credit_card_id" uuid,
	"invoice_month" text,
	"created_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_batches_workspace_id_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "import_batches_origin_chk" CHECK ("import_batches"."origin" in ('file', 'open_finance')),
	CONSTRAINT "import_batches_format_chk" CHECK ("import_batches"."format" in ('ofx', 'csv')),
	CONSTRAINT "import_batches_file_chk" CHECK ("import_batches"."origin" <> 'file' or ("import_batches"."format" is not null and "import_batches"."file_name" is not null)),
	CONSTRAINT "import_batches_counts_chk" CHECK ("import_batches"."created_count" >= 0 and "import_batches"."skipped_count" >= 0),
	CONSTRAINT "import_batches_target_chk" CHECK ("import_batches"."account_id" is null or "import_batches"."credit_card_id" is null),
	CONSTRAINT "import_batches_invoice_month_chk" CHECK ("import_batches"."invoice_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint

-- 3. transactions: origin, batch and external id ----------------------------------------------------------
-- Constant default: metadata-only change, no table rewrite.
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "origin" text DEFAULT 'manual' NOT NULL;
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "import_batch_id" uuid;
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "external_id" text;
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_origin_chk";
--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_origin_chk" CHECK ("transactions"."origin" in ('manual', 'file', 'open_finance'));
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_external_id_chk";
--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_external_id_chk" CHECK ("transactions"."external_id" is null or length("transactions"."external_id") between 1 and 200);
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_import_chk";
--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_import_chk" CHECK ("transactions"."origin" <> 'manual' or ("transactions"."import_batch_id" is null and "transactions"."external_id" is null));
--> statement-breakpoint

-- 4. Foreign keys: workspace of the tenant tables, composite references inside the workspace -------------
ALTER TABLE "bank_connections" DROP CONSTRAINT IF EXISTS "bank_connections_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "bank_connections" ADD CONSTRAINT "bank_connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "bank_connections" DROP CONSTRAINT IF EXISTS "bank_connections_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "bank_connections" ADD CONSTRAINT "bank_connections_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "bank_connection_accounts" DROP CONSTRAINT IF EXISTS "bank_connection_accounts_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "bank_connection_accounts" ADD CONSTRAINT "bank_connection_accounts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "bank_connection_accounts" DROP CONSTRAINT IF EXISTS "bank_connection_accounts_connection_fk";
--> statement-breakpoint
ALTER TABLE "bank_connection_accounts" ADD CONSTRAINT "bank_connection_accounts_connection_fk" FOREIGN KEY ("workspace_id","connection_id") REFERENCES "public"."bank_connections"("workspace_id","id") ON DELETE cascade;
--> statement-breakpoint
-- SET NULL (column): clear only the reference, never workspace_id (PostgreSQL 15+).
ALTER TABLE "bank_connection_accounts" DROP CONSTRAINT IF EXISTS "bank_connection_accounts_account_fk";
--> statement-breakpoint
ALTER TABLE "bank_connection_accounts" ADD CONSTRAINT "bank_connection_accounts_account_fk" FOREIGN KEY ("workspace_id","linked_account_id") REFERENCES "public"."accounts"("workspace_id","id") ON DELETE SET NULL ("linked_account_id");
--> statement-breakpoint
ALTER TABLE "bank_connection_accounts" DROP CONSTRAINT IF EXISTS "bank_connection_accounts_credit_card_fk";
--> statement-breakpoint
ALTER TABLE "bank_connection_accounts" ADD CONSTRAINT "bank_connection_accounts_credit_card_fk" FOREIGN KEY ("workspace_id","linked_credit_card_id") REFERENCES "public"."credit_cards"("workspace_id","id") ON DELETE SET NULL ("linked_credit_card_id");
--> statement-breakpoint
ALTER TABLE "import_batches" DROP CONSTRAINT IF EXISTS "import_batches_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "import_batches" DROP CONSTRAINT IF EXISTS "import_batches_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null;
--> statement-breakpoint
ALTER TABLE "import_batches" DROP CONSTRAINT IF EXISTS "import_batches_connection_fk";
--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_connection_fk" FOREIGN KEY ("workspace_id","connection_id") REFERENCES "public"."bank_connections"("workspace_id","id") ON DELETE SET NULL ("connection_id");
--> statement-breakpoint
ALTER TABLE "import_batches" DROP CONSTRAINT IF EXISTS "import_batches_account_fk";
--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_account_fk" FOREIGN KEY ("workspace_id","account_id") REFERENCES "public"."accounts"("workspace_id","id") ON DELETE SET NULL ("account_id");
--> statement-breakpoint
ALTER TABLE "import_batches" DROP CONSTRAINT IF EXISTS "import_batches_credit_card_fk";
--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_credit_card_fk" FOREIGN KEY ("workspace_id","credit_card_id") REFERENCES "public"."credit_cards"("workspace_id","id") ON DELETE SET NULL ("credit_card_id");
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_import_batch_fk";
--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_import_batch_fk" FOREIGN KEY ("workspace_id","import_batch_id") REFERENCES "public"."import_batches"("workspace_id","id") ON DELETE SET NULL ("import_batch_id");
--> statement-breakpoint

-- 5. Indexes and uniqueness --------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "bank_connection_accounts_connection_idx" ON "bank_connection_accounts" USING btree ("connection_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bank_connection_accounts_provider_uq" ON "bank_connection_accounts" USING btree ("workspace_id","connection_id","provider_account_hash");
--> statement-breakpoint
-- One feed per local account/card: two feeds would import the same movements twice.
CREATE UNIQUE INDEX IF NOT EXISTS "bank_connection_accounts_linked_account_uq" ON "bank_connection_accounts" USING btree ("workspace_id","linked_account_id") WHERE "bank_connection_accounts"."linked_account_id" is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bank_connection_accounts_linked_card_uq" ON "bank_connection_accounts" USING btree ("workspace_id","linked_credit_card_id") WHERE "bank_connection_accounts"."linked_credit_card_id" is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bank_connections_item_uq" ON "bank_connections" USING btree ("workspace_id","provider","provider_item_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bank_connections_created_by_idx" ON "bank_connections" USING btree ("created_by") WHERE "bank_connections"."created_by" is not null;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "import_batches_workspace_idx" ON "import_batches" USING btree ("workspace_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "import_batches_created_by_idx" ON "import_batches" USING btree ("created_by") WHERE "import_batches"."created_by" is not null;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transactions_import_batch_idx" ON "transactions" USING btree ("import_batch_id") WHERE "transactions"."import_batch_id" is not null;
--> statement-breakpoint
-- Idempotent imports: an external id (FITID, provider transaction id, content hash) exists once per
-- account and once per card. NULL account/card ids never collide (card rows vs account rows).
CREATE UNIQUE INDEX IF NOT EXISTS "transactions_account_external_uq" ON "transactions" USING btree ("workspace_id","account_id","external_id") WHERE "transactions"."external_id" is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "transactions_card_external_uq" ON "transactions" USING btree ("workspace_id","credit_card_id","external_id") WHERE "transactions"."external_id" is not null;
--> statement-breakpoint

-- 6. Row Level Security on the new tenant tables -----------------------------------------------------------
ALTER TABLE "bank_connections" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "bank_connections" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "bank_connections_tenant_isolation" ON "bank_connections";
--> statement-breakpoint
CREATE POLICY "bank_connections_tenant_isolation" ON "bank_connections" USING ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "bank_connection_accounts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "bank_connection_accounts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "bank_connection_accounts_tenant_isolation" ON "bank_connection_accounts";
--> statement-breakpoint
CREATE POLICY "bank_connection_accounts_tenant_isolation" ON "bank_connection_accounts" USING ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "import_batches" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "import_batches" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "import_batches_tenant_isolation" ON "import_batches";
--> statement-breakpoint
CREATE POLICY "import_batches_tenant_isolation" ON "import_batches" USING ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint

-- 7. Global tables for webhooks (no workspace context, no personal data) -----------------------------------
-- Random platform keys wrapped by the key provider (KMS in production): the webhook index below is
-- an HMAC with one of them, so a database dump alone does not reveal the aggregator's item ids.
CREATE TABLE IF NOT EXISTS "platform_keys" (
	"name" text PRIMARY KEY NOT NULL,
	"wrapped_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_keys_name_chk" CHECK ("platform_keys"."name" ~ '^[a-z0-9_.:-]{1,64}$')
);
--> statement-breakpoint
-- Webhook routing: HMAC(provider:itemId) → (workspace, connection). Rows are written by the API login
-- after the connection commits and disappear with the connection (cascade runs as the table owner).
CREATE TABLE IF NOT EXISTS "open_finance_items" (
	"item_hash" text PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "open_finance_items" DROP CONSTRAINT IF EXISTS "open_finance_items_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "open_finance_items" ADD CONSTRAINT "open_finance_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "open_finance_items" DROP CONSTRAINT IF EXISTS "open_finance_items_connection_fk";
--> statement-breakpoint
ALTER TABLE "open_finance_items" ADD CONSTRAINT "open_finance_items_connection_fk" FOREIGN KEY ("workspace_id","connection_id") REFERENCES "public"."bank_connections"("workspace_id","id") ON DELETE cascade;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "open_finance_items_connection_uq" ON "open_finance_items" USING btree ("workspace_id","connection_id");
--> statement-breakpoint
-- Webhook deliveries already received (idempotency); purged after 30 days (db/retention.ts).
CREATE TABLE IF NOT EXISTS "open_finance_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "open_finance_events_provider_chk" CHECK ("open_finance_events"."provider" in ('pluggy', 'fake')),
	CONSTRAINT "open_finance_events_size_chk" CHECK (length("open_finance_events"."event_id") between 1 and 200 and length("open_finance_events"."event_type") between 1 and 100)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "open_finance_events_provider_event_uq" ON "open_finance_events" USING btree ("provider","event_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "open_finance_events_created_idx" ON "open_finance_events" USING btree ("created_at");
--> statement-breakpoint

-- 8. Privileges ----------------------------------------------------------------------------------------------
-- effinance_app: plain DML on the new tenant tables (no TRUNCATE: it ignores RLS); nothing on the
-- global ones. The API login gets its grants from docs/deploy-aws.md (tests: test/db-roles.ts).
REVOKE ALL ON "bank_connections", "bank_connection_accounts", "import_batches", "platform_keys", "open_finance_items", "open_finance_events" FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON "platform_keys", "open_finance_items", "open_finance_events" FROM effinance_app;
--> statement-breakpoint
REVOKE TRUNCATE, REFERENCES, TRIGGER ON "bank_connections", "bank_connection_accounts", "import_batches" FROM effinance_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "bank_connections", "bank_connection_accounts", "import_batches" TO effinance_app;
