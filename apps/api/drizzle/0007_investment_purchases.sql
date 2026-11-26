-- 0007: portfolio purchases (asset, date, quantity, unit price, fees). Positions and the average
-- price are computed from them. Same tenant pattern as 0004–0006. Re-runnable.

CREATE TABLE IF NOT EXISTS "investment_purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"account_id" uuid,
	"asset_type" text NOT NULL,
	"ticker" text NOT NULL,
	"name" text,
	"date" date NOT NULL,
	"quantity" numeric(24, 8) NOT NULL,
	"unit_price" bigint NOT NULL,
	"fees" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "investment_purchases_workspace_id_id_uq" UNIQUE("workspace_id","id"),
	CONSTRAINT "investment_purchases_asset_type_chk" CHECK ("investment_purchases"."asset_type" in ('stock', 'fii', 'etf', 'bdr', 'fixed_income', 'crypto', 'other')),
	CONSTRAINT "investment_purchases_ticker_chk" CHECK (length("investment_purchases"."ticker") between 1 and 30),
	CONSTRAINT "investment_purchases_name_chk" CHECK ("investment_purchases"."name" is null or length("investment_purchases"."name") <= 80),
	CONSTRAINT "investment_purchases_quantity_chk" CHECK ("investment_purchases"."quantity" > 0),
	CONSTRAINT "investment_purchases_amounts_chk" CHECK ("investment_purchases"."unit_price" > 0 and "investment_purchases"."fees" >= 0)
);
--> statement-breakpoint
ALTER TABLE "investment_purchases" DROP CONSTRAINT IF EXISTS "investment_purchases_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "investment_purchases" ADD CONSTRAINT "investment_purchases_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade;
--> statement-breakpoint
-- Deleting the broker account keeps the purchases (only the reference is cleared).
ALTER TABLE "investment_purchases" DROP CONSTRAINT IF EXISTS "investment_purchases_account_fk";
--> statement-breakpoint
ALTER TABLE "investment_purchases" ADD CONSTRAINT "investment_purchases_account_fk" FOREIGN KEY ("workspace_id", "account_id") REFERENCES "public"."accounts"("workspace_id", "id") ON DELETE SET NULL ("account_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "investment_purchases_workspace_ticker_idx" ON "investment_purchases" USING btree ("workspace_id","ticker");
--> statement-breakpoint
ALTER TABLE "investment_purchases" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "investment_purchases" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "investment_purchases_tenant_isolation" ON "investment_purchases";
--> statement-breakpoint
CREATE POLICY "investment_purchases_tenant_isolation" ON "investment_purchases" USING ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
REVOKE ALL ON "investment_purchases" FROM PUBLIC;
--> statement-breakpoint
REVOKE TRUNCATE, REFERENCES, TRIGGER ON "investment_purchases" FROM effinance_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "investment_purchases" TO effinance_app;
