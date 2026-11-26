-- 0011: goals kept in a fixed-income title. goals.asset_name names the title ("Tesouro Selic 2029");
-- saving into such a goal books an investment purchase of it (with its own Aplicação), linked by
-- goal_contributions.purchase_id. Same tenant pattern as 0009/0010: composite key inside the workspace,
-- SET NULL of the reference column only (deleting the purchase in Investimentos just unlinks). Re-runnable.
ALTER TABLE "goals" ADD COLUMN IF NOT EXISTS "asset_name" text;
--> statement-breakpoint
ALTER TABLE "goals" DROP CONSTRAINT IF EXISTS "goals_asset_name_chk";
--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_asset_name_chk" CHECK ("goals"."asset_name" is null or length("goals"."asset_name") between 1 and 30);
--> statement-breakpoint
ALTER TABLE "goal_contributions" ADD COLUMN IF NOT EXISTS "purchase_id" uuid;
--> statement-breakpoint
ALTER TABLE "goal_contributions" DROP CONSTRAINT IF EXISTS "goal_contributions_purchase_fk";
--> statement-breakpoint
ALTER TABLE "goal_contributions" ADD CONSTRAINT "goal_contributions_purchase_fk" FOREIGN KEY ("workspace_id", "purchase_id") REFERENCES "public"."investment_purchases"("workspace_id", "id") ON DELETE SET NULL ("purchase_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "goal_contributions_purchase_uq" ON "goal_contributions" USING btree ("workspace_id", "purchase_id") WHERE "goal_contributions"."purchase_id" is not null;
