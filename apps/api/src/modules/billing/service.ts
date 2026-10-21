// Subscriptions: plan checkout, cancellation and provider status sync (webhooks). Webhook payloads
// are never trusted: the official status is always fetched from the provider.

import { and, eq } from 'drizzle-orm';
import { PLANS, getPlan, type Plan, type PlanCode, type Subscription } from '@effinance/shared';
import type { DbExecutor } from '../../db/client';
import { billingEvents, subscriptions } from '../../db/schema';
import { audit, type AuditContext } from '../../lib/audit';
import { ValidationError } from '../../lib/errors';
import type { Platform } from '../../lib/platform';
import type { Access } from '../workspaces/access';
import { getSubscriptionRow, memberCount } from '../workspaces/service';
import { effectiveStatus, maxMembersFor, summarizeSubscription } from './entitlements';
import { PROVIDER_STATUS_MAP, type ProviderSubscription, type WebhookInput } from './providers/types';

export function plansFor(kind: Access['workspaceKind'] | null): Plan[] {
  return kind ? PLANS.filter((p) => p.workspaceKinds.includes(kind)) : [...PLANS];
}

export async function getSubscription(db: DbExecutor, access: Access): Promise<Subscription> {
  const [row, members] = await Promise.all([
    getSubscriptionRow(db, access.workspaceId),
    memberCount(db, access.workspaceId),
  ]);
  return {
    ...summarizeSubscription(row),
    provider: row?.provider ?? null,
    plan: getPlan(row?.planCode) ?? null,
    memberCount: members,
    maxMembers: maxMembersFor(access.workspaceKind, row),
  };
}

export async function startCheckout(
  db: DbExecutor,
  platform: Platform,
  access: Access,
  payerEmail: string,
  planCode: PlanCode,
  ctx: AuditContext,
): Promise<{ checkoutUrl: string }> {
  const plan = getPlan(planCode)!;
  if (!plan.workspaceKinds.includes(access.workspaceKind)) {
    throw new ValidationError('Este plano não está disponível para este tipo de espaço');
  }
  const members = await memberCount(db, access.workspaceId);
  if (members > plan.maxMembers) {
    throw new ValidationError(`Este espaço tem ${members} membros e o plano ${plan.name} permite ${plan.maxMembers}.`);
  }
  const row = await getSubscriptionRow(db, access.workspaceId);
  const status = effectiveStatus(row);
  if ((status === 'active' || status === 'past_due') && row?.planCode === planCode && !row.cancelAtPeriodEnd) {
    throw new ValidationError('Este espaço já assina este plano');
  }

  const result = await platform.billing.createCheckout({
    workspaceId: access.workspaceId,
    plan,
    payerEmail,
    backUrl: `${platform.appUrl}/configuracoes?aba=assinatura`,
  });
  // An active plan stays active until the new one is authorized (webhook).
  if (status !== 'active' && status !== 'past_due') {
    await db
      .update(subscriptions)
      .set({
        planCode,
        status: 'pending',
        provider: platform.billing.name,
        providerSubscriptionId: result.providerSubscriptionId,
      })
      .where(eq(subscriptions.workspaceId, access.workspaceId));
  }
  await audit(db, {
    ...ctx,
    action: 'billing.checkout_started',
    workspaceId: access.workspaceId,
    userId: access.userId,
    entity: 'subscription',
    metadata: { planCode },
  });
  return { checkoutUrl: result.checkoutUrl };
}

function periodEnd(plan: Plan | undefined, from: Date): Date {
  const end = new Date(from);
  if (plan?.interval === 'year') end.setUTCFullYear(end.getUTCFullYear() + 1);
  else end.setUTCMonth(end.getUTCMonth() + 1);
  return end;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AppliedSubscription {
  workspaceId: string;
  /** Previous provider subscription replaced by this one (cancel it so it is not charged too). */
  replaced: string | null;
}

/**
 * Applies the provider's official status to our subscription row.
 *
 * - The workspace's current provider subscription: status (and plan actually charged) are applied.
 * - Another subscription of the same workspace (`external_reference`), e.g. a second checkout: only
 *   adopted once AUTHORIZED (an upgrade or a checkout paid later). Any other status of a non-current
 *   subscription is ignored, so a stale/abandoned checkout can never downgrade or replace the plan.
 */
export async function applyProviderSubscription(
  db: DbExecutor,
  remote: ProviderSubscription,
  provider: 'mercadopago' | 'fake',
  /** Stops the replaced subscription at the provider; runs BEFORE our row changes (retry-safe). */
  cancelReplaced?: (providerSubscriptionId: string) => Promise<void>,
): Promise<AppliedSubscription | null> {
  let [row] = await db.select().from(subscriptions).where(eq(subscriptions.providerSubscriptionId, remote.id));
  let adopting = false;
  if (!row) {
    if (remote.status !== 'authorized' || !remote.externalReference || !UUID_RE.test(remote.externalReference)) return null;
    row = (await getSubscriptionRow(db, remote.externalReference)) ?? undefined;
    if (!row) return null;
    adopting = true;
  }
  const previous = row.providerSubscriptionId;
  const replaced = adopting && previous && previous !== remote.id && row.provider === provider ? previous : null;
  // If this fails, nothing changed here: the provider retries the notification and we try again.
  if (replaced && cancelReplaced) await cancelReplaced(replaced);

  const status = PROVIDER_STATUS_MAP[remote.status];
  // What is being charged decides the plan; our own record is only a fallback (unknown price).
  const planCode = remote.planCode ?? row.planCode;
  const now = new Date();
  await db
    .update(subscriptions)
    .set({
      status,
      provider,
      providerSubscriptionId: remote.id,
      planCode,
      pastDueSince: status === 'past_due' ? (row.pastDueSince ?? now) : null,
      currentPeriodEnd:
        status === 'active'
          ? (remote.nextPaymentDate ?? periodEnd(getPlan(planCode), now))
          : row.currentPeriodEnd,
      cancelAtPeriodEnd: status === 'canceled' ? true : status === 'active' ? false : row.cancelAtPeriodEnd,
      ...(status === 'active' ? { trialEndsAt: null } : {}),
    })
    .where(eq(subscriptions.workspaceId, row.workspaceId));
  return { workspaceId: row.workspaceId, replaced };
}

/** Cancels at the end of the paid period (or drops a checkout not yet paid). */
export async function cancelSubscription(db: DbExecutor, platform: Platform, access: Access, ctx: AuditContext): Promise<Subscription> {
  const row = await getSubscriptionRow(db, access.workspaceId);
  const status = effectiveStatus(row);
  if (!row || (status !== 'active' && status !== 'past_due' && status !== 'pending')) {
    throw new ValidationError('Não há assinatura ativa para cancelar');
  }
  if (row.providerSubscriptionId && row.provider === platform.billing.name) {
    await platform.billing.cancel(row.providerSubscriptionId);
  }
  if (status === 'pending') {
    const trialing = !!row.trialEndsAt && row.trialEndsAt > new Date();
    await db
      .update(subscriptions)
      .set({ status: trialing ? 'trialing' : 'expired', planCode: null, providerSubscriptionId: null, provider: null })
      .where(eq(subscriptions.workspaceId, access.workspaceId));
  } else {
    // Stays usable until the end of the period already paid (see entitlements).
    await db
      .update(subscriptions)
      .set({ cancelAtPeriodEnd: true, ...(status === 'past_due' ? { status: 'canceled' as const } : {}) })
      .where(eq(subscriptions.workspaceId, access.workspaceId));
  }
  await audit(db, {
    ...ctx,
    action: 'billing.canceled',
    workspaceId: access.workspaceId,
    userId: access.userId,
    entity: 'subscription',
  });
  return getSubscription(db, access);
}

/** Best effort: stops future charges of workspaces about to be deleted. */
export async function cancelForDeletion(db: DbExecutor, platform: Platform, workspaceIds: string[]): Promise<void> {
  for (const id of workspaceIds) {
    const row = await getSubscriptionRow(db, id);
    if (!row?.providerSubscriptionId || row.provider !== platform.billing.name) continue;
    const status = effectiveStatus(row);
    if (status === 'active' || status === 'past_due' || status === 'pending') {
      await platform.billing.cancel(row.providerSubscriptionId);
    }
  }
}

/**
 * Webhook entry point: verify, deduplicate, re-fetch, apply. An event is only "done" once processed:
 * if a previous delivery failed half-way (provider API down, crash), the retry processes it again —
 * applying a re-fetched status is idempotent.
 */
export async function handleWebhook(
  db: DbExecutor,
  platform: Platform,
  input: WebhookInput,
): Promise<{ duplicate: boolean; workspaceId: string | null }> {
  const event = await platform.billing.parseWebhook(input);
  let [stored] = await db
    .insert(billingEvents)
    .values({ provider: platform.billing.name, eventId: event.eventId, type: event.type, payload: (input.body ?? {}) as object })
    .onConflictDoNothing()
    .returning({ id: billingEvents.id });
  if (!stored) {
    const [existing] = await db
      .select({ id: billingEvents.id, processedAt: billingEvents.processedAt })
      .from(billingEvents)
      .where(and(eq(billingEvents.provider, platform.billing.name), eq(billingEvents.eventId, event.eventId)));
    if (!existing || existing.processedAt) return { duplicate: true, workspaceId: null };
    stored = existing;
  }

  let applied: AppliedSubscription | null = null;
  if (event.subscriptionId) {
    const remote = await platform.billing.getSubscription(event.subscriptionId);
    // The new subscription takes over: stop charging the old one (or an abandoned checkout).
    applied = await applyProviderSubscription(db, remote, platform.billing.name, async (previousId) => {
      const old = await platform.billing.getSubscription(previousId);
      if (old.status !== 'cancelled') await platform.billing.cancel(previousId);
    });
  }
  await db.update(billingEvents).set({ processedAt: new Date() }).where(eq(billingEvents.id, stored.id));
  if (applied) {
    await audit(db, {
      action: 'billing.webhook',
      workspaceId: applied.workspaceId,
      entity: 'subscription',
      metadata: { type: event.type, eventId: event.eventId, replacedPrevious: !!applied.replaced },
    });
  }
  return { duplicate: false, workspaceId: applied?.workspaceId ?? null };
}

/** Fake provider only: activates a plan as if the payment had been authorized. */
export async function devActivate(db: DbExecutor, access: Access, planCode: PlanCode, ctx: AuditContext): Promise<Subscription> {
  const plan = getPlan(planCode)!;
  if (!plan.workspaceKinds.includes(access.workspaceKind)) {
    throw new ValidationError('Este plano não está disponível para este tipo de espaço');
  }
  const now = new Date();
  await db
    .update(subscriptions)
    .set({
      planCode,
      status: 'active',
      provider: 'fake',
      providerSubscriptionId: null,
      trialEndsAt: null,
      pastDueSince: null,
      cancelAtPeriodEnd: false,
      currentPeriodEnd: periodEnd(plan, now),
    })
    .where(eq(subscriptions.workspaceId, access.workspaceId));
  await audit(db, {
    ...ctx,
    action: 'billing.activated',
    workspaceId: access.workspaceId,
    userId: access.userId,
    entity: 'subscription',
    metadata: { planCode, provider: 'fake' },
  });
  return getSubscription(db, access);
}
