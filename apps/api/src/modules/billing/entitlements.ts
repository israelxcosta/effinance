// What a subscription allows right now. Trial expiry and the past-due grace period are computed on
// read, so no scheduled job is needed.

import {
  GRACE_DAYS,
  getPlan,
  type PlanCode,
  type SubscriptionStatus,
  type SubscriptionSummary,
  type WorkspaceKind,
} from '@effinance/shared';
import type { subscriptions } from '../../db/schema';

type SubscriptionRow = typeof subscriptions.$inferSelect;

const DAY_MS = 86_400_000;

/** Members allowed while there is no paid plan (trial), by workspace kind. */
const TRIAL_MAX_MEMBERS: Record<WorkspaceKind, number> = { personal: 1, family: 5, business: 15 };

export function effectiveStatus(row: SubscriptionRow | null | undefined, now: Date = new Date()): SubscriptionStatus {
  if (!row) return 'expired';
  switch (row.status) {
    case 'trialing':
      return row.trialEndsAt && row.trialEndsAt > now ? 'trialing' : 'expired';
    case 'active':
      return row.cancelAtPeriodEnd && row.currentPeriodEnd && row.currentPeriodEnd <= now ? 'canceled' : 'active';
    default:
      return row.status;
  }
}

export function canWrite(row: SubscriptionRow | null | undefined, now: Date = new Date()): boolean {
  if (!row) return false;
  const status = effectiveStatus(row, now);
  switch (status) {
    case 'trialing':
    case 'active':
      return true;
    case 'past_due':
      return !row.pastDueSince || now.getTime() - row.pastDueSince.getTime() <= GRACE_DAYS * DAY_MS;
    // Checkout started during the trial: keeps the trial access until it ends.
    case 'pending':
      return !!row.trialEndsAt && row.trialEndsAt > now;
    // Canceled plans stay usable until the end of the period already paid.
    case 'canceled':
      return !!row.currentPeriodEnd && row.currentPeriodEnd > now;
    default:
      return false;
  }
}

export function summarizeSubscription(row: SubscriptionRow | null | undefined, now: Date = new Date()): SubscriptionSummary {
  return {
    planCode: (row?.planCode as PlanCode | null) ?? null,
    status: effectiveStatus(row, now),
    trialEndsAt: row?.trialEndsAt?.toISOString() ?? null,
    currentPeriodEnd: row?.currentPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: row?.cancelAtPeriodEnd ?? false,
    canWrite: canWrite(row, now),
  };
}

/** Member limit of a workspace: the paid plan's, or the trial allowance of its kind. */
export function maxMembersFor(kind: WorkspaceKind, row: SubscriptionRow | null | undefined, now: Date = new Date()): number {
  const status = effectiveStatus(row, now);
  const plan = getPlan(row?.planCode);
  if (plan && (status === 'active' || status === 'past_due' || status === 'canceled')) return plan.maxMembers;
  return TRIAL_MAX_MEMBERS[kind];
}
