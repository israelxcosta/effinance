-- 0010: a goal contribution may book a transfer between a current account and the goal's account
-- (Aplicação when saving, Resgate when withdrawing). Set by the server only; deleting the transfer in
-- the statement just unlinks the contribution. Same tenant pattern as 0009 (composite key inside the
-- workspace, SET NULL of the reference column only — never workspace_id). Re-runnable.
ALTER TABLE "goal_contributions" ADD COLUMN IF NOT EXISTS "transfer_id" uuid;
--> statement-breakpoint
ALTER TABLE "goal_contributions" DROP CONSTRAINT IF EXISTS "goal_contributions_transfer_fk";
--> statement-breakpoint
ALTER TABLE "goal_contributions" ADD CONSTRAINT "goal_contributions_transfer_fk" FOREIGN KEY ("workspace_id", "transfer_id") REFERENCES "public"."transactions"("workspace_id", "id") ON DELETE SET NULL ("transfer_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "goal_contributions_transfer_uq" ON "goal_contributions" USING btree ("workspace_id", "transfer_id") WHERE "goal_contributions"."transfer_id" is not null;
