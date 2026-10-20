import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../src/app';
import { MercadoPagoProvider } from '../src/modules/billing/providers/mercadopago';
import { hmacSha256Hex, signatureManifest, verifySignature } from '../src/modules/billing/providers/signature';
import { PROVIDER_STATUS_MAP } from '../src/modules/billing/providers/types';
import { canWrite, effectiveStatus } from '../src/modules/billing/entitlements';
import { executeRows } from '../src/lib/sql';
import { registerUser, resetDb } from './helpers';

const SECRET = 'mp-webhook-secret-de-teste';

/** Mercado Pago API stand-in: records calls and answers from `preapprovals`. */
function fakeMercadoPago() {
  const preapprovals = new Map<string, Record<string, unknown>>();
  const calls: { method: string; url: string; body?: any }[] = [];
  let counter = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
    if (method === 'POST' && url.endsWith('/preapproval')) {
      const id = `pre_${++counter}`;
      preapprovals.set(id, { id, status: 'pending', external_reference: body.external_reference });
      return json({ id, status: 'pending', init_point: `https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id=${id}` });
    }
    const pre = /\/preapproval\/([^/?]+)$/.exec(url);
    if (pre) {
      const row = preapprovals.get(pre[1]!);
      if (!row) return json({ message: 'not found' }, 404);
      if (method === 'PUT') Object.assign(row, body);
      return json(row);
    }
    const authorized = /\/authorized_payments\/([^/?]+)$/.exec(url);
    if (authorized) return json({ id: authorized[1], preapproval_id: 'pre_1', status: 'processed' });
    return json({ message: 'unexpected' }, 500);
  };
  return { preapprovals, calls, fetchImpl };
}

let app: App;
let mp: ReturnType<typeof fakeMercadoPago>;

beforeAll(async () => {
  mp = fakeMercadoPago();
  app = await buildApp({
    logger: false,
    platform: { billing: new MercadoPagoProvider({ accessToken: 'TEST-token', webhookSecret: SECRET, fetch: mp.fetchImpl }) },
  });
  await app.ready();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await resetDb(app);
});

async function signedWebhook(options: { dataId: string; type?: string; eventId?: string; ts?: number; secret?: string }) {
  const ts = String(options.ts ?? Math.floor(Date.now() / 1000));
  const requestId = `req-${Math.random().toString(36).slice(2)}`;
  const v1 = await hmacSha256Hex(options.secret ?? SECRET, signatureManifest(options.dataId, requestId, ts));
  const type = options.type ?? 'subscription_preapproval';
  return app.inject({
    method: 'POST',
    url: `/api/billing/webhooks/mercadopago?data.id=${options.dataId}&type=${type}`,
    headers: { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId },
    payload: { id: options.eventId ?? `evt-${Math.random()}`, type, action: 'updated', data: { id: options.dataId } },
  });
}

describe('Mercado Pago subscriptions', () => {
  it('creates the preapproval, then activates only from a signed webhook (status re-fetched)', async () => {
    const owner = await registerUser(app, 'Assinante');
    const me = (await owner.get('/auth/me')).body;
    const checkout = await owner.post('/billing/checkout', { planCode: 'individual_yearly' });
    expect(checkout.status).toBe(200);
    expect(checkout.body.checkoutUrl).toContain('preapproval_id=pre_1');
    const created = mp.calls.find((c) => c.method === 'POST')!;
    expect(created.body).toMatchObject({
      external_reference: me.workspace.id,
      payer_email: owner.email,
      status: 'pending',
      auto_recurring: { frequency: 12, frequency_type: 'months', transaction_amount: 199, currency_id: 'BRL' },
    });
    expect(created.body.back_url).toBe('http://localhost:5173/configuracoes?aba=assinatura');
    // Still in trial while the payment is pending.
    expect((await owner.get('/billing/subscription')).body).toMatchObject({ status: 'pending', canWrite: true });

    // Forged / stale notifications are rejected.
    expect((await signedWebhook({ dataId: 'pre_1', secret: 'outro-segredo' })).statusCode).toBe(401);
    expect((await signedWebhook({ dataId: 'pre_1', ts: Math.floor(Date.now() / 1000) - 600 })).statusCode).toBe(401);
    const unsigned = await app.inject({ method: 'POST', url: '/api/billing/webhooks/mercadopago?data.id=pre_1&type=subscription_preapproval', payload: {} });
    expect(unsigned.statusCode).toBe(401);

    // A payload claiming "authorized" means nothing: the provider still says pending.
    expect((await signedWebhook({ dataId: 'pre_1', eventId: 'e1' })).json()).toMatchObject({ received: true, duplicate: false });
    expect((await owner.get('/billing/subscription')).body.status).toBe('pending');

    mp.preapprovals.get('pre_1')!.status = 'authorized';
    mp.preapprovals.get('pre_1')!.next_payment_date = '2027-10-20T12:00:00.000Z';
    expect((await signedWebhook({ dataId: 'pre_1', eventId: 'e2' })).statusCode).toBe(200);
    const active = (await owner.get('/billing/subscription')).body;
    expect(active).toMatchObject({ status: 'active', canWrite: true, provider: 'mercadopago', plan: { code: 'individual_yearly' } });
    expect(active.currentPeriodEnd).toBe('2027-10-20T12:00:00.000Z');

    // Same notification twice is processed once.
    expect((await signedWebhook({ dataId: 'pre_1', eventId: 'e2' })).json()).toMatchObject({ duplicate: true });

    // Payment failure → past_due (grace), recovered → active.
    mp.preapprovals.get('pre_1')!.status = 'paused';
    await signedWebhook({ dataId: 'auth_9', type: 'subscription_authorized_payment', eventId: 'e3' });
    expect((await owner.get('/billing/subscription')).body).toMatchObject({ status: 'past_due', canWrite: true });

    // Cancel goes to Mercado Pago and keeps access until the period end.
    mp.preapprovals.get('pre_1')!.status = 'authorized';
    await signedWebhook({ dataId: 'pre_1', eventId: 'e4' });
    const canceled = await owner.post('/billing/cancel');
    expect(canceled.body).toMatchObject({ cancelAtPeriodEnd: true, canWrite: true });
    expect(mp.calls.at(-1)).toMatchObject({ method: 'PUT', body: { status: 'cancelled' } });
    expect((await owner.post('/billing/dev/activate', { planCode: 'individual_monthly' })).status).toBe(404);

    const events = await executeRows<{ n: number }>(app.db, sql`select count(*)::int as n from billing_events`);
    expect(events[0]!.n).toBe(4); // e1..e4; the duplicate e2 is not stored twice
  });
});

describe('billing rules', () => {
  it('maps provider statuses', () => {
    expect(PROVIDER_STATUS_MAP).toEqual({ authorized: 'active', paused: 'past_due', cancelled: 'canceled', pending: 'pending' });
  });

  it('computes trial expiry, grace period and canceled access on read', () => {
    const now = new Date('2026-10-20T12:00:00Z');
    const day = 86_400_000;
    const row = (patch: Record<string, unknown>) =>
      ({
        workspaceId: 'w',
        planCode: 'individual_monthly',
        status: 'active',
        provider: 'mercadopago',
        providerSubscriptionId: 'p',
        trialEndsAt: null,
        currentPeriodEnd: null,
        pastDueSince: null,
        cancelAtPeriodEnd: false,
        createdAt: now,
        updatedAt: now,
        ...patch,
      }) as never;
    expect(effectiveStatus(row({ status: 'trialing', trialEndsAt: new Date(now.getTime() - 1) }), now)).toBe('expired');
    expect(canWrite(row({ status: 'trialing', trialEndsAt: new Date(now.getTime() + day) }), now)).toBe(true);
    expect(canWrite(row({ status: 'past_due', pastDueSince: new Date(now.getTime() - 6 * day) }), now)).toBe(true);
    expect(canWrite(row({ status: 'past_due', pastDueSince: new Date(now.getTime() - 8 * day) }), now)).toBe(false);
    expect(canWrite(row({ status: 'canceled', currentPeriodEnd: new Date(now.getTime() + day) }), now)).toBe(true);
    expect(canWrite(row({ status: 'canceled', currentPeriodEnd: new Date(now.getTime() - day) }), now)).toBe(false);
    expect(
      effectiveStatus(row({ status: 'active', cancelAtPeriodEnd: true, currentPeriodEnd: new Date(now.getTime() - 1) }), now),
    ).toBe('canceled');
    expect(canWrite(row({ status: 'expired' }), now)).toBe(false);
  });

  it('validates the webhook signature manifest', async () => {
    const ts = '1792500000';
    const v1 = await hmacSha256Hex(SECRET, 'id:abc123;request-id:r-1;ts:1792500000;');
    expect(signatureManifest('ABC123', 'r-1', ts)).toBe('id:abc123;request-id:r-1;ts:1792500000;');
    const base = { requestId: 'r-1', dataId: 'ABC123', secret: SECRET, now: 1792500000 * 1000 };
    expect(await verifySignature({ ...base, header: `ts=${ts},v1=${v1}` })).toBe(true);
    expect(await verifySignature({ ...base, header: `ts=${ts},v1=${v1.replace(/.$/, '0')}` })).toBe(false);
    expect(await verifySignature({ ...base, header: `ts=${ts},v1=${v1}`, now: (1792500000 + 400) * 1000 })).toBe(false);
    expect(await verifySignature({ ...base, header: undefined })).toBe(false);
  });
});
