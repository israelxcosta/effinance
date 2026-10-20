ALTER TABLE "transactions" ADD COLUMN "split_group_id" uuid;--> statement-breakpoint
CREATE INDEX "transactions_split_group_idx" ON "transactions" USING btree ("split_group_id");