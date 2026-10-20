// Subscriptions: plan checkout, cancellation and provider status sync (webhooks). Webhook payloads
// are never trusted: the official status is always fetched from the provider.

import { eq } from 'drizzle-orm';
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

/** Applies the provider's official status to our subscription row. */
export async function applyProviderSubscription(
  db: DbExecutor,
  remote: ProviderSubscription,
  provider: 'mercadopago' | 'fake',
): Promise<string | null> {
  const [byId] = await db.select().from(subscriptions).where(eq(subscriptions.providerSubscriptionId, remote.id));
  const row = byId ?? (remote.externalReference ? await getSubscriptionRow(db, remote.externalReference) : null);
  if (!row) return null;
  const status = PROVIDER_STATUS_MAP[remote.status];
  const now = new Date();
  await db
    .update(subscriptions)
    .set({
      status,
      provider,
      providerSubscriptionId: remote.id,
      pastDueSince: status === 'past_due' ? (row.pastDueSince ?? now) : null,
      currentPeriodEnd:
        status === 'active'
          ? (remote.nextPaymentDate ?? periodEnd(getPlan(row.planCode), now))
          : row.currentPeriodEnd,
      cancelAtPeriodEnd: status === 'canceled' ? true : status === 'active' ? false : row.cancelAtPeriodEnd,
      ...(status === 'active' ? { trialEndsAt: null } : {}),
    })
    .where(eq(subscriptions.workspaceId, row.workspaceId));
  return row.workspaceId;
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

/** Webhook entry point: verify, deduplicate, re-fetch, apply. */
export async function handleWebhook(
  db: DbExecutor,
  platform: Platform,
  input: WebhookInput,
): Promise<{ duplicate: boolean; workspaceId: string | null }> {
  const event = await platform.billing.parseWebhook(input);
  const [stored] = await db
    .insert(billingEvents)
    .values({ provider: platform.billing.name, eventId: event.eventId, type: event.type, payload: (input.body ?? {}) as object })
    .onConflictDoNothing()
    .returning({ id: billingEvents.id });
  if (!stored) return { duplicate: true, workspaceId: null };

  let workspaceId: string | null = null;
  if (event.subscriptionId) {
    const remote = await platform.billing.getSubscription(event.subscriptionId);
    workspaceId = await applyProviderSubscription(db, remote, platform.billing.name);
  }
  await db.update(billingEvents).set({ processedAt: new Date() }).where(eq(billingEvents.id, stored.id));
  if (workspaceId) {
    await audit(db, {
      action: 'billing.webhook',
      workspaceId,
      entity: 'subscription',
      metadata: { type: event.type, eventId: event.eventId },
    });
  }
  return { duplicate: false, workspaceId };
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
