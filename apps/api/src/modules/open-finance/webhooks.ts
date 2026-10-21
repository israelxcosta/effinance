// Open Finance webhooks. The delivery is authenticated by the secret in the URL path (compared in
// constant time), validated, recorded once per event id and answered right away; processing runs
// afterwards and never trusts the payload — the item id only routes the event (HMAC index →
// workspace/connection) and the regular sync re-reads everything from the provider.

import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { openFinanceEvents, openFinanceItems } from '../../db/schema';
import { audit } from '../../lib/audit';
import { sha256Hex, timingSafeEqualStr } from '../../lib/crypto/encoding';
import { platformHmac } from '../../lib/crypto/platform-keys';
import { AppError, NotFoundError, UnauthorizedError } from '../../lib/errors';
import { serializeError } from '../../lib/log';
import { ITEM_INDEX_KEY, requireSetup, syncConnection, type OpenFinanceContext } from './service';


const webhookSchema = z.object({
  event: z.string().min(1).max(100),
  eventId: z.string().min(1).max(200),
  itemId: z.string().min(1).max(200).optional(),
});
export type WebhookPayload = z.infer<typeof webhookSchema>;

/** Events after which the item's data may have changed: re-read everything from the provider. */
const SYNC_EVENTS = new Set([
  'item/created',
  'item/updated',
  'item/login_succeeded',
  'item/error',
  'item/waiting_user_input',
  'item/waiting_user_action',
  'transactions/created',
  'transactions/updated',
  'transactions/deleted',
]);

/** Constant-time comparison of the path secret (digests first: no length leak either). */
export async function webhookSecretMatches(given: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256Hex(given), sha256Hex(expected)]);
  return timingSafeEqualStr(a, b);
}

/**
 * Accepts a webhook delivery: authenticates the path secret, validates the envelope and records the
 * event id (idempotency). Returns the processing job to run after answering, or null for a repeat.
 */
export async function receiveWebhook(
  ctx: OpenFinanceContext,
  providerName: string,
  secret: string,
  body: unknown,
): Promise<{ duplicate: boolean; job: (() => Promise<void>) | null }> {
  const of = ctx.of;
  if (!of || of.provider.name !== providerName || !of.webhookSecret) throw new NotFoundError('Rota não encontrada');
  if (!(await webhookSecretMatches(secret, of.webhookSecret))) throw new UnauthorizedError('Webhook não autorizado');
  const parsed = webhookSchema.safeParse(body);
  if (!parsed.success) throw new AppError(400, 'validation_error', 'Notificação inválida');
  const payload = parsed.data;
  const [stored] = await ctx.db
    .insert(openFinanceEvents)
    .values({ provider: of.provider.name, eventId: payload.eventId, eventType: payload.event })
    .onConflictDoNothing()
    .returning({ id: openFinanceEvents.id });
  if (!stored) return { duplicate: true, job: null };
  return { duplicate: false, job: () => processWebhook(ctx, stored.id, payload) };
}

/**
 * Never trusts the payload: the item id only routes the event (HMAC index → workspace and
 * connection); the item, its accounts and transactions are then re-read from the provider by the
 * regular sync, which also re-checks that the item belongs to the workspace.
 */
export async function processWebhook(ctx: OpenFinanceContext, eventRowId: string, payload: WebhookPayload): Promise<void> {
  try {
    const { provider } = requireSetup(ctx.of);
    if (payload.itemId && (SYNC_EVENTS.has(payload.event) || payload.event === 'item/deleted')) {
      const itemHash = await platformHmac(ctx.db, ITEM_INDEX_KEY, `${provider.name}:${payload.itemId}`);
      const [route] = await ctx.db.select().from(openFinanceItems).where(eq(openFinanceItems.itemHash, itemHash));
      if (route) {
        // A deleted item cannot be re-read: the sync marks the connection as gone.
        const result = await syncConnection(ctx, route.workspaceId, route.connectionId, { userId: null });
        await audit(ctx.db, {
          action: 'open_finance.synced',
          workspaceId: route.workspaceId,
          entity: 'bank_connection',
          entityId: route.connectionId,
          metadata: { trigger: 'webhook', event: payload.event, created: result.created, updated: result.updated, skipped: result.skipped },
        });
      }
    }
    await ctx.db.update(openFinanceEvents).set({ processedAt: new Date() }).where(eq(openFinanceEvents.id, eventRowId));
  } catch (error) {
    // Left unprocessed; the provider's next event (or a manual sync) catches up — syncs are idempotent.
    ctx.log?.warn({ err: serializeError(error), event: payload.event }, 'open finance webhook processing failed');
  }
}

const jobs = new Set<Promise<void>>();

/** Runs a webhook job after the response; tracked so shutdown (and tests) can wait for it. */
export function runInBackground(job: () => Promise<void>): void {
  const p = job().finally(() => jobs.delete(p));
  jobs.add(p);
}

export async function settleOpenFinanceJobs(): Promise<void> {
  while (jobs.size > 0) await Promise.allSettled([...jobs]);
}
