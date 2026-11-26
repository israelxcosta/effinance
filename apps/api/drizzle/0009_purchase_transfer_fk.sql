-- 0009: security audit of the data layer (2026-11).
-- DB-01: investment_purchases.transfer_id (0008) had no foreign key. The column could hold the id of a
--   transaction of another workspace (foreign-key checks are the only guard that ignores RLS-hidden
--   rows), and kept pointing to deleted transfers. It becomes a composite key inside the workspace,
--   ON DELETE SET NULL (column) = "deleting the Aplicação in the statement only unlinks the purchase".
-- DB-02: money had no upper bound in the database. A purchase total (quantity × unit price + fees) is
--   capped at the contract maximum (R$ 1 bilhão, as /transfers), and no transaction amount may exceed
--   Number.MAX_SAFE_INTEGER (the API reads bigint as a JS number: above it values change silently).
-- Same tenant pattern as 0004–0007. Runs inside the migrator's transaction (drizzle / PGlite demo): no
-- CONCURRENTLY. Re-runnable (IF [NOT] EXISTS / drop before add).

-- 1. Parent key: transactions gets UNIQUE (workspace_id, id), like every other referenced table ------
-- (The foreign key of step 3 depends on it: drop it first when re-running.)
ALTER TABLE "investment_purchases" DROP CONSTRAINT IF EXISTS "investment_purchases_transfer_fk";
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_workspace_id_id_uq";
--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_workspace_id_id_uq" UNIQUE ("workspace_id", "id");
--> statement-breakpoint

-- 2. Existing links that point nowhere inside the workspace are cleared --------------------------------
-- The migrator owns the table and is not a superuser in production (docs/deploy-aws.md): FORCE ROW LEVEL
-- SECURITY would hide every row from it (no app.workspace_id), turning the clean-up into a silent no-op
-- and the foreign key below into a failure. FORCE is lifted for this statement only and restored in the
-- same transaction (the ALTER holds an exclusive lock: nobody observes the gap).
ALTER TABLE "investment_purchases" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "transactions" NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
UPDATE "investment_purchases" AS p SET "transfer_id" = NULL
 WHERE p."transfer_id" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "transactions" AS t WHERE t."workspace_id" = p."workspace_id" AND t."id" = p."transfer_id");
--> statement-breakpoint
-- Two purchases sharing one Aplicação (never written by the API): keep the oldest link.
UPDATE "investment_purchases" AS p SET "transfer_id" = NULL
 WHERE p."transfer_id" IS NOT NULL
   AND EXISTS (
     SELECT 1 FROM "investment_purchases" AS o
      WHERE o."workspace_id" = p."workspace_id" AND o."transfer_id" = p."transfer_id"
        AND (o."created_at", o."id") < (p."created_at", p."id")
   );
--> statement-breakpoint
ALTER TABLE "transactions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "investment_purchases" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- 3. Composite foreign key + one Aplicação per purchase -------------------------------------------------
-- SET NULL (column): clear only the reference, never workspace_id (PostgreSQL 15+).
ALTER TABLE "investment_purchases" ADD CONSTRAINT "investment_purchases_transfer_fk" FOREIGN KEY ("workspace_id", "transfer_id") REFERENCES "public"."transactions"("workspace_id", "id") ON DELETE SET NULL ("transfer_id");
--> statement-breakpoint
-- Also the index behind the foreign key: deleting a transaction looks the link up by (workspace, id).
CREATE UNIQUE INDEX IF NOT EXISTS "investment_purchases_transfer_uq" ON "investment_purchases" USING btree ("workspace_id", "transfer_id") WHERE "investment_purchases"."transfer_id" is not null;
--> statement-breakpoint

-- 4. Money bounds ------------------------------------------------------------------------------------------
-- NOT VALID: enforced for every row written from now on without scanning (or failing on) old rows.
-- `ALTER TABLE ... VALIDATE CONSTRAINT` can be run later in a maintenance window.
ALTER TABLE "investment_purchases" DROP CONSTRAINT IF EXISTS "investment_purchases_total_chk";
--> statement-breakpoint
ALTER TABLE "investment_purchases" ADD CONSTRAINT "investment_purchases_total_chk" CHECK (round("investment_purchases"."quantity" * "investment_purchases"."unit_price") + "investment_purchases"."fees" <= 100000000000) NOT VALID;
--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_amount_max_chk";
--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_amount_max_chk" CHECK ("transactions"."amount" <= 9007199254740991) NOT VALID;
