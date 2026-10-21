import type { Plan, PlanCode, SubscriptionStatus } from '@effinance/shared';

/** Provider-side status of a recurring subscription (Mercado Pago "preapproval"). */
export type ProviderStatus = 'authorized' | 'paused' | 'cancelled' | 'pending';

export interface ProviderSubscription {
  id: string;
  status: ProviderStatus;
  /** Our workspace id (sent as `external_reference`). */
  externalReference: string | null;
  nextPaymentDate: Date | null;
  /**
   * Plan actually being charged, derived from the provider's amount and frequency (never from our
   * own records): what was paid is what is granted. Null/undefined when it matches no plan.
   */
  planCode?: PlanCode | null;
}

export interface CheckoutRequest {
  workspaceId: string;
  plan: Plan;
  payerEmail: string;
  backUrl: string;
}

export interface CheckoutResult {
  checkoutUrl: string;
  providerSubscriptionId: string | null;
}

export interface WebhookInput {
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, unknown>;
  body: unknown;
}

export interface WebhookEvent {
  /** Idempotency key of the notification. */
  eventId: string;
  type: string;
  /** Subscription (preapproval) the notification is about, when it concerns one. */
  subscriptionId: string | null;
}

export interface BillingProvider {
  readonly name: 'mercadopago' | 'fake';
  createCheckout(request: CheckoutRequest): Promise<CheckoutResult>;
  /** Official status, always fetched from the provider (webhook payloads are never trusted). */
  getSubscription(id: string): Promise<ProviderSubscription>;
  cancel(id: string): Promise<void>;
  /** Verifies the notification's signature and resolves what it refers to. Throws if invalid. */
  parseWebhook(input: WebhookInput): Promise<WebhookEvent>;
}

/** Mercado Pago preapproval status → our subscription status. */
export const PROVIDER_STATUS_MAP: Record<ProviderStatus, SubscriptionStatus> = {
  authorized: 'active',
  paused: 'past_due',
  cancelled: 'canceled',
  pending: 'pending',
};
