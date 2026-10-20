-- 0004: tenant integrity and database hardening (security audit).
-- Runs inside the migrator's transaction (drizzle / PGlite demo): no CONCURRENTLY, no VACUUM.
-- Re-runnable: every constraint is dropped if present before being added.

-- 1. Privilege model, fail closed ----------------------------------------------------------------
-- Tenant isolation only holds if effinance_app is subject to RLS. Refuse to migrate otherwise.
DO $$
DECLARE
  app oid;
BEGIN
  SELECT oid INTO app FROM pg_roles WHERE rolname = 'effinance_app';
  IF app IS NULL THEN
    RAISE EXCEPTION 'role effinance_app is missing (migration 0003 / docs/deploy-aws.md)';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_roles
     WHERE oid = app AND (rolsuper OR rolbypassrls OR rolcanlogin OR rolcreaterole OR rolcreatedb OR rolreplication)
  ) THEN
    RAISE EXCEPTION 'effinance_app must be NOSUPERUSER NOBYPASSRLS NOLOGIN NOCREATEROLE NOCREATEDB NOREPLICATION';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members WHERE member = app) THEN
    RAISE EXCEPTION 'effinance_app must not be a member of other roles (it would gain their privileges)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relowner = app)
     OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspowner = app)
     OR EXISTS (SELECT 1 FROM pg_proc WHERE proowner = app) THEN
    RAISE EXCEPTION 'effinance_app must not own objects (an owner can disable row level security)';
  END IF;
END
$$;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
--> statement-breakpoint
-- Functions created by the migrator from now on are not executable by everyone.
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
--> statement-breakpoint
-- effinance_app: plain DML on financial tables, nothing else (no TRUNCATE: it ignores RLS).
REVOKE ALL ON "users", "workspaces", "workspace_members", "workspace_invites", "subscriptions", "billing_events", "sessions", "password_resets", "audit_logs" FROM effinance_app;
--> statement-breakpoint
REVOKE TRUNCATE, REFERENCES, TRIGGER ON "categories", "accounts", "credit_cards", "goals", "goal_contributions", "contacts", "recurrences", "transactions" FROM effinance_app;
--> statement-breakpoint

-- 2. Composite foreign keys: a row can only reference rows of its own workspace ------------------
-- Foreign-key checks bypass RLS, so `x_id → parent(id)` accepted ids of other tenants (and told
-- whether they exist); cascades from the other tenant then deleted or blocked this tenant's rows.
ALTER TABLE "categories" DROP CONSTRAINT IF EXISTS "categories_parent_id_categories_id_fk";
--> statement-breakpoint
ALTER TABLE "categories" DROP CONSTRAINT IF EXISTS "categories_parent_fk";
--> statement-breakpoint
ALTER TABLE "credit_cards" DROP CONSTRAINT IF EXISTS "credit_cards_default_account_id_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "credit_cards" DROP CONSTRAINT IF EXISTS "credit_cards_default_account_fk";
--> statement-breakpoint
ALTER TABLE "goals" DROP CONSTRAINT IF EXISTS "goals_account_id_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "goals" DROP CONSTRAINT IF EXISTS "goals_account_fk";
--> statement-breakpoint
ALTER TABLE "goal_contributions" DROP CONSTRAINT IF EXISTS "goal_contributions_goal_id_goals_id_fk";
--> statement-breakpoint
ALTER TABLE "goal_contributions" DROP CONSTRAINT IF EXISTS "goal_contributions_goal_fk";
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_account_id_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_account_fk";
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_to_account_id_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_to_account_fk";
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_credit_card_id_credit_cards_id_fk";
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_credit_card_fk";
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_category_id_categories_id_fk";
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_category_fk";
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_subcategory_id_categories_id_fk";
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_subcategory_fk";
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_contact_id_contacts_id_fk";
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_contact_fk";
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_recurrence_id_recurrences_id_fk";
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_recurrence_fk";
--> statement-breakpoint
ALTER TABLE "accounts" DROP CONSTRAINT IF EXISTS "accounts_workspace_id_id_uq";
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_workspace_id_id_uq" UNIQUE ("workspace_id", "id");
--> statement-breakpoint
ALTER TABLE "categories" DROP CONSTRAINT IF EXISTS "categories_workspace_id_id_uq";
--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_workspace_id_id_uq" UNIQUE ("workspace_id", "id");
--> statement-breakpoint
ALTER TABLE "contacts" DROP CONSTRAINT IF EXISTS "contacts_workspace_id_id_uq";
--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_workspace_id_id_uq" UNIQUE ("workspace_id", "id");
--> statement-breakpoint
ALTER TABLE "credit_cards" DROP CONSTRAINT IF EXISTS "credit_cards_workspace_id_id_uq";
--> statement-breakpoint
ALTER TABLE "credit_cards" ADD CONSTRAINT "credit_cards_workspace_id_id_uq" UNIQUE ("workspace_id", "id");
--> statement-breakpoint
ALTER TABLE "goals" DROP CONSTRAINT IF EXISTS "goals_workspace_id_id_uq";
--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_workspace_id_id_uq" UNIQUE ("workspace_id", "id");
--> statement-breakpoint
ALTER TABLE "recurrences" DROP CONSTRAINT IF EXISTS "recurrences_workspace_id_id_uq";
--> statement-breakpoint
ALTER TABLE "recurrences" ADD CONSTRAINT "recurrences_workspace_id_id_uq" UNIQUE ("workspace_id", "id");
--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_fk" FOREIGN KEY ("workspace_id", "parent_id") REFERENCES "public"."categories"("workspace_id", "id") ON DELETE CASCADE;
--> statement-breakpoint
-- SET NULL (column): clear only the reference, never workspace_id (PostgreSQL 15+).
ALTER TABLE "credit_cards" ADD CONSTRAINT "credit_cards_default_account_fk" FOREIGN KEY ("workspace_id", "default_account_id") REFERENCES "public"."accounts"("workspace_id", "id") ON DELETE SET NULL ("default_account_id");
--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_account_fk" FOREIGN KEY ("workspace_id", "account_id") REFERENCES "public"."accounts"("workspace_id", "id") ON DELETE SET NULL ("account_id");
--> statement-breakpoint
ALTER TABLE "goal_contributions" ADD CONSTRAINT "goal_contributions_goal_fk" FOREIGN KEY ("workspace_id", "goal_id") REFERENCES "public"."goals"("workspace_id", "id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_fk" FOREIGN KEY ("workspace_id", "account_id") REFERENCES "public"."accounts"("workspace_id", "id");
--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_to_account_fk" FOREIGN KEY ("workspace_id", "to_account_id") REFERENCES "public"."accounts"("workspace_id", "id");
--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_credit_card_fk" FOREIGN KEY ("workspace_id", "credit_card_id") REFERENCES "public"."credit_cards"("workspace_id", "id");
--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_fk" FOREIGN KEY ("workspace_id", "category_id") REFERENCES "public"."categories"("workspace_id", "id");
--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_subcategory_fk" FOREIGN KEY ("workspace_id", "subcategory_id") REFERENCES "public"."categories"("workspace_id", "id");
--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_contact_fk" FOREIGN KEY ("workspace_id", "contact_id") REFERENCES "public"."contacts"("workspace_id", "id") ON DELETE SET NULL ("contact_id");
--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_recurrence_fk" FOREIGN KEY ("workspace_id", "recurrence_id") REFERENCES "public"."recurrences"("workspace_id", "id") ON DELETE SET NULL ("recurrence_id");
--> statement-breakpoint

-- 3. Domain checks (values of the shared contract; money in cents) -------------------------------
ALTER TABLE "accounts" DROP CONSTRAINT IF EXISTS "accounts_type_chk";
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_type_chk" CHECK ("accounts"."type" in ('checking', 'savings', 'wallet', 'benefit', 'investment', 'other'));
--> statement-breakpoint
ALTER TABLE "credit_cards" DROP CONSTRAINT IF EXISTS "credit_cards_limit_chk";
--> statement-breakpoint
ALTER TABLE "credit_cards" ADD CONSTRAINT "credit_cards_limit_chk" CHECK ("credit_cards"."limit" >= 0);
--> statement-breakpoint
ALTER TABLE "credit_cards" DROP CONSTRAINT IF EXISTS "credit_cards_brand_chk";
--> statement-breakpoint
ALTER TABLE "credit_cards" ADD CONSTRAINT "credit_cards_brand_chk" CHECK ("credit_cards"."brand" in ('visa', 'mastercard', 'elo', 'amex', 'hipercard', 'diners', 'other'));
--> statement-breakpoint
ALTER TABLE "goals" DROP CONSTRAINT IF EXISTS "goals_target_amount_chk";
--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_target_amount_chk" CHECK ("goals"."target_amount" > 0);
--> statement-breakpoint
ALTER TABLE "goal_contributions" DROP CONSTRAINT IF EXISTS "goal_contributions_amount_chk";
--> statement-breakpoint
ALTER TABLE "goal_contributions" ADD CONSTRAINT "goal_contributions_amount_chk" CHECK ("goal_contributions"."amount" <> 0);
--> statement-breakpoint
ALTER TABLE "recurrences" DROP CONSTRAINT IF EXISTS "recurrences_kind_chk";
--> statement-breakpoint
ALTER TABLE "recurrences" ADD CONSTRAINT "recurrences_kind_chk" CHECK ("recurrences"."kind" in ('installment', 'recurring', 'fixed'));
--> statement-breakpoint
ALTER TABLE "recurrences" DROP CONSTRAINT IF EXISTS "recurrences_frequency_chk";
--> statement-breakpoint
ALTER TABLE "recurrences" ADD CONSTRAINT "recurrences_frequency_chk" CHECK ("recurrences"."frequency" in ('weekly', 'monthly', 'semiannual', 'annual'));
--> statement-breakpoint
ALTER TABLE "recurrences" DROP CONSTRAINT IF EXISTS "recurrences_counters_chk";
--> statement-breakpoint
ALTER TABLE "recurrences" ADD CONSTRAINT "recurrences_counters_chk" CHECK ("recurrences"."next_index" >= 0 and ("recurrences"."total_occurrences" is null or "recurrences"."total_occurrences" > 0));
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_recurrence_kind_chk";
--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_recurrence_kind_chk" CHECK ("transactions"."recurrence_kind" in ('single', 'installment', 'recurring', 'fixed'));
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_frequency_chk";
--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_frequency_chk" CHECK ("transactions"."frequency" in ('weekly', 'monthly', 'semiannual', 'annual'));
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_payment_method_chk";
--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_payment_method_chk" CHECK ("transactions"."payment_method" in ('pix', 'cash', 'debit_card', 'credit_card', 'bank_slip', 'transfer', 'auto_debit', 'other'));
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_transfer_kind_chk";
--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_transfer_kind_chk" CHECK ("transactions"."transfer_kind" in ('transfer', 'investment', 'redemption', 'card_payment'));
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_invoice_month_chk";
--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_invoice_month_chk" CHECK ("transactions"."invoice_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_installments_chk";
--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_installments_chk" CHECK (("transactions"."installment_number" is null or "transactions"."installment_number" > 0) and ("transactions"."installment_total" is null or "transactions"."installment_total" > 0) and ("transactions"."occurrence_index" is null or "transactions"."occurrence_index" >= 0));
--> statement-breakpoint
ALTER TABLE "subscriptions" DROP CONSTRAINT IF EXISTS "subscriptions_status_chk";
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_status_chk" CHECK ("subscriptions"."status" in ('trialing', 'pending', 'active', 'past_due', 'canceled', 'expired'));
--> statement-breakpoint
ALTER TABLE "subscriptions" DROP CONSTRAINT IF EXISTS "subscriptions_plan_code_chk";
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_code_chk" CHECK ("subscriptions"."plan_code" in ('individual_monthly', 'individual_yearly', 'family_monthly', 'business_monthly'));
--> statement-breakpoint
ALTER TABLE "subscriptions" DROP CONSTRAINT IF EXISTS "subscriptions_provider_chk";
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_provider_chk" CHECK ("subscriptions"."provider" in ('mercadopago', 'fake'));
--> statement-breakpoint
-- An invite can never grant ownership.
ALTER TABLE "workspace_invites" DROP CONSTRAINT IF EXISTS "workspace_invites_role_chk";
--> statement-breakpoint
ALTER TABLE "workspace_invites" ADD CONSTRAINT "workspace_invites_role_chk" CHECK ("workspace_invites"."role" in ('editor', 'viewer'));
--> statement-breakpoint

-- 4. Uniqueness and indexes -------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS "workspace_members_single_owner_uq" ON "workspace_members" USING btree ("workspace_id") WHERE "workspace_members"."role" = 'owner';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workspace_invites_pending_email_uq" ON "workspace_invites" USING btree ("workspace_id", lower("email")) WHERE "workspace_invites"."accepted_at" is null;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_invites_email_idx" ON "workspace_invites" USING btree (lower("email"));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workspace_invites_invited_by_idx" ON "workspace_invites" USING btree ("invited_by");
--> statement-breakpoint
-- Referenced by ON DELETE actions: without these, deleting a workspace/user/category scans whole
-- tables shared by every tenant (sessions grows by one row per token refresh).
CREATE INDEX IF NOT EXISTS "sessions_workspace_idx" ON "sessions" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_expires_idx" ON "sessions" USING btree ("expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_last_workspace_idx" ON "users" USING btree ("last_workspace_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transactions_subcategory_idx" ON "transactions" USING btree ("subcategory_id") WHERE "transactions"."subcategory_id" is not null;
--> statement-breakpoint

-- 5. Encryption backfill bookkeeping -----------------------------------------------------------------
-- Existing workspaces start NULL (re-checked by `db:migrate` even when their key already exists);
-- workspaces created from now on are encrypted from birth.
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "encryption_backfilled_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "workspaces" ALTER COLUMN "encryption_backfilled_at" SET DEFAULT now();
--> statement-breakpoint

-- 6. LGPD: deleting an account also deletes the invites addressed to its e-mail ---------------------
-- Invoker rights (the API login already deletes invites), pinned search_path, qualified names.
CREATE OR REPLACE FUNCTION "public"."users_forget_invites"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  DELETE FROM "public"."workspace_invites" WHERE lower("email") = lower(OLD."email");
  RETURN OLD;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."users_forget_invites"() FROM PUBLIC;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "users_forget_invites" ON "users";
--> statement-breakpoint
CREATE TRIGGER "users_forget_invites" AFTER DELETE ON "users" FOR EACH ROW EXECUTE FUNCTION "public"."users_forget_invites"();
