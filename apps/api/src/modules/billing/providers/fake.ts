// Development / tests / browser demo: no real charge. Checkout sends the user back to the
// subscription tab with `simular=<plan>`, and POST /billing/dev/activate activates the plan.

import { UnauthorizedError } from '../../../lib/errors';
import type { BillingProvider, CheckoutRequest, CheckoutResult, ProviderSubscription, WebhookEvent } from './types';

export class FakeBillingProvider implements BillingProvider {
  readonly name = 'fake' as const;

  constructor(private readonly appUrl: string) {}

  async createCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
    return {
      checkoutUrl: `${this.appUrl}/configuracoes?aba=assinatura&simular=${req.plan.code}`,
      providerSubscriptionId: null,
    };
  }

  async getSubscription(id: string): Promise<ProviderSubscription> {
    return { id, status: 'authorized', externalReference: null, nextPaymentDate: null };
  }

  async cancel(): Promise<void> {}

  async parseWebhook(): Promise<WebhookEvent> {
    throw new UnauthorizedError('Webhooks não são aceitos com o provedor de testes');
  }
}
