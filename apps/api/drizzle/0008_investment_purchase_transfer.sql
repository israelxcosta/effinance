-- 0008: a purchase may book an "Aplicação" (transfer) from the paying account to the broker.
-- The id is set by the server only and always read filtered by workspace; deleting the transfer in the
-- statement just leaves the purchase without a link (no FK: transactions has no (workspace_id, id) key).
ALTER TABLE "investment_purchases" ADD COLUMN IF NOT EXISTS "transfer_id" uuid;
