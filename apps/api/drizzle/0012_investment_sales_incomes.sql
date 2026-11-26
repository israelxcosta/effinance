-- 0012: investment sales (result computed with the average price; it changes the broker balance, not
-- income/expenses) and income (dividends, JCP, interest, yield: income transactions at the broker,
-- linked here; deleting the transaction deletes the record). A goal withdrawal from a title is a sale
-- (goal_contributions.sale_id). Same tenant pattern as 0007/0009: RLS forced, composite keys inside
-- the workspace, SET NULL of the reference column only. Re-runnable.
CREATE TABLE IF NOT EXISTS "investment_incomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"account_id" uuid,
	"kind" text NOT NULL,
	"ticker" text,
	"date" date NOT NULL,
	"amount" bigint NOT NULL,
	"transaction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "investment_incomes_workspace_id_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "investment_incomes_kind_chk" CHECK ("investment_incomes"."kind" in ('dividend', 'jcp', 'interest', 'yield')),
	CONSTRAINT "investment_incomes_ticker_chk" CHECK ("investment_incomes"."ticker" is null or length("investment_incomes"."ticker") between 1 and 30),
	CONSTRAINT "investment_incomes_amount_chk" CHECK ("investment_incomes"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "investment_sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"account_id" uuid,
	"ticker" text NOT NULL,
	"date" date NOT NULL,
	"quantity" numeric(24, 8) NOT NULL,
	"unit_price" bigint NOT NULL,
	"fees" bigint DEFAULT 0 NOT NULL,
	"cost" bigint NOT NULL,
	"result" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "investment_sales_workspace_id_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "investment_sales_ticker_chk" CHECK (length("investment_sales"."ticker") between 1 and 30),
	CONSTRAINT "investment_sales_quantity_chk" CHECK ("investment_sales"."quantity" > 0),
	CONSTRAINT "investment_sales_amounts_chk" CHECK ("investment_sales"."unit_price" > 0 and "investment_sales"."fees" >= 0 and "investment_sales"."cost" >= 0),
	CONSTRAINT "investment_sales_result_chk" CHECK (abs("investment_sales"."result") <= 100000000000)
);
--> statement-breakpoint
ALTER TABLE "goal_contributions" ADD COLUMN IF NOT EXISTS "sale_id" uuid;--> statement-breakpoint
ALTER TABLE "investment_incomes" DROP CONSTRAINT IF EXISTS "investment_incomes_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "investment_incomes" ADD CONSTRAINT "investment_incomes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "investment_incomes" DROP CONSTRAINT IF EXISTS "investment_incomes_account_fk";--> statement-breakpoint
ALTER TABLE "investment_incomes" ADD CONSTRAINT "investment_incomes_account_fk" FOREIGN KEY ("workspace_id", "account_id") REFERENCES "public"."accounts"("workspace_id", "id") ON DELETE SET NULL ("account_id");--> statement-breakpoint
ALTER TABLE "investment_incomes" DROP CONSTRAINT IF EXISTS "investment_incomes_transaction_fk";--> statement-breakpoint
ALTER TABLE "investment_incomes" ADD CONSTRAINT "investment_incomes_transaction_fk" FOREIGN KEY ("workspace_id","transaction_id") REFERENCES "public"."transactions"("workspace_id","id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "investment_sales" DROP CONSTRAINT IF EXISTS "investment_sales_workspace_id_workspaces_id_fk";--> statement-breakpoint
ALTER TABLE "investment_sales" ADD CONSTRAINT "investment_sales_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "investment_sales" DROP CONSTRAINT IF EXISTS "investment_sales_account_fk";--> statement-breakpoint
ALTER TABLE "investment_sales" ADD CONSTRAINT "investment_sales_account_fk" FOREIGN KEY ("workspace_id", "account_id") REFERENCES "public"."accounts"("workspace_id", "id") ON DELETE SET NULL ("account_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "investment_incomes_workspace_date_idx" ON "investment_incomes" USING btree ("workspace_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "investment_incomes_transaction_uq" ON "investment_incomes" USING btree ("workspace_id","transaction_id") WHERE "investment_incomes"."transaction_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "investment_sales_workspace_ticker_idx" ON "investment_sales" USING btree ("workspace_id","ticker");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "investment_sales_account_idx" ON "investment_sales" USING btree ("account_id");--> statement-breakpoint
ALTER TABLE "goal_contributions" DROP CONSTRAINT IF EXISTS "goal_contributions_sale_fk";--> statement-breakpoint
ALTER TABLE "goal_contributions" ADD CONSTRAINT "goal_contributions_sale_fk" FOREIGN KEY ("workspace_id", "sale_id") REFERENCES "public"."investment_sales"("workspace_id", "id") ON DELETE SET NULL ("sale_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "goal_contributions_sale_uq" ON "goal_contributions" USING btree ("workspace_id","sale_id") WHERE "goal_contributions"."sale_id" is not null;
--> statement-breakpoint
ALTER TABLE "investment_sales" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "investment_sales" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "investment_sales_tenant_isolation" ON "investment_sales";
--> statement-breakpoint
CREATE POLICY "investment_sales_tenant_isolation" ON "investment_sales" USING ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
REVOKE ALL ON "investment_sales" FROM PUBLIC;
--> statement-breakpoint
REVOKE TRUNCATE, REFERENCES, TRIGGER ON "investment_sales" FROM effinance_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "investment_sales" TO effinance_app;
--> statement-breakpoint
ALTER TABLE "investment_incomes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "investment_incomes" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "investment_incomes_tenant_isolation" ON "investment_incomes";
--> statement-breakpoint
CREATE POLICY "investment_incomes_tenant_isolation" ON "investment_incomes" USING ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
REVOKE ALL ON "investment_incomes" FROM PUBLIC;
--> statement-breakpoint
REVOKE TRUNCATE, REFERENCES, TRIGGER ON "investment_incomes" FROM effinance_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "investment_incomes" TO effinance_app;
