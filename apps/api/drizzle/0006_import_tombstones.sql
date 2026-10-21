-- 0006: undo keeps the import batch as history, and Open Finance rows removed by the user are
-- remembered so the next sync (which re-reads a week of history) does not bring them back.
-- Same tenant pattern as 0004/0005. Runs inside the migrator's transaction; re-runnable.

ALTER TABLE "import_batches" ADD COLUMN IF NOT EXISTS "undone_at" timestamp with time zone;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "import_tombstones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"account_id" uuid,
	"credit_card_id" uuid,
	"external_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_tombstones_workspace_id_id_uq" UNIQUE("workspace_id","id"),
	-- Exactly one destination: an account or a card.
	CONSTRAINT "import_tombstones_target_chk" CHECK (num_nonnulls("import_tombstones"."account_id", "import_tombstones"."credit_card_id") = 1),
	CONSTRAINT "import_tombstones_external_id_chk" CHECK (length("import_tombstones"."external_id") between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "import_tombstones" DROP CONSTRAINT IF EXISTS "import_tombstones_workspace_id_workspaces_id_fk";
--> statement-breakpoint
ALTER TABLE "import_tombstones" ADD CONSTRAINT "import_tombstones_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade;
--> statement-breakpoint
-- Tombstones belong to the destination: they go away with the account/card (inside the workspace).
ALTER TABLE "import_tombstones" DROP CONSTRAINT IF EXISTS "import_tombstones_account_fk";
--> statement-breakpoint
ALTER TABLE "import_tombstones" ADD CONSTRAINT "import_tombstones_account_fk" FOREIGN KEY ("workspace_id","account_id") REFERENCES "public"."accounts"("workspace_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "import_tombstones" DROP CONSTRAINT IF EXISTS "import_tombstones_credit_card_fk";
--> statement-breakpoint
ALTER TABLE "import_tombstones" ADD CONSTRAINT "import_tombstones_credit_card_fk" FOREIGN KEY ("workspace_id","credit_card_id") REFERENCES "public"."credit_cards"("workspace_id","id") ON DELETE cascade;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "import_tombstones_account_uq" ON "import_tombstones" USING btree ("workspace_id","account_id","external_id") WHERE "import_tombstones"."account_id" is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "import_tombstones_card_uq" ON "import_tombstones" USING btree ("workspace_id","credit_card_id","external_id") WHERE "import_tombstones"."credit_card_id" is not null;
--> statement-breakpoint
ALTER TABLE "import_tombstones" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "import_tombstones" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "import_tombstones_tenant_isolation" ON "import_tombstones";
--> statement-breakpoint
CREATE POLICY "import_tombstones_tenant_isolation" ON "import_tombstones" USING ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid) WITH CHECK ("workspace_id" = nullif(current_setting('app.workspace_id', true), '')::uuid);
--> statement-breakpoint
REVOKE ALL ON "import_tombstones" FROM PUBLIC;
--> statement-breakpoint
REVOKE TRUNCATE, REFERENCES, TRIGGER ON "import_tombstones" FROM effinance_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "import_tombstones" TO effinance_app;
