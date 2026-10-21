// Security audit (security-node-api) — regression tests. Every test in the "finding" blocks
// reproduces an exploitable path that worked before the fix; the "guards" block pins protections that
// were already correct (BOLA/BFLA matrices) so they cannot regress silently.

import { Writable } from 'node:stream';
import { sql } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp, type App } from '../src/app';
import { accounts } from '../src/db/schema';
import { env } from '../src/env';
import { today } from '../src/lib/clock';
import { sha256Hex } from '../src/lib/crypto/encoding';
import { FieldCipher } from '../src/lib/crypto/field-cipher';
import { sanitizeUrl, serializeError } from '../src/lib/log';
import type { KeyProvider } from '../src/lib/crypto/key-provider';
import { configureKeyring, getCipher, keyProvider } from '../src/lib/crypto/keyring';
import { fromDatabaseError } from '../src/lib/errors';
import type { Mailer, MemoryMailer } from '../src/lib/mailer';
import { tenantRoutes } from '../src/lib/tenant-routes';
import { createKeyProvider } from '../src/setup';
import { executeRows } from '../src/lib/sql';
import { totpCode, totpStep } from '../src/lib/totp';
import { MercadoPagoProvider } from '../src/modules/billing/providers/mercadopago';
import { hmacSha256Hex, signatureManifest } from '../src/modules/billing/providers/signature';
import type { BillingProvider } from '../src/modules/billing/providers/types';
import { TEST_PASSWORD, admin, createAccount, createTestApp, firstCategory, registerUser, resetDb, type Client } from './helpers';

const DAY = 86_400_000;
const FAKE_ID = '00000000-0000-4000-8000-000000000000';

let app: App;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await resetDb(app);
  outbox().length = 0;
});
afterEach(() => {
  vi.useRealTimers();
});

const outbox = () => (app.platform.mailer as MemoryMailer).outbox;

function cookie(res: { cookies: { name: string; value: string }[] }, name: string) {
  return res.cookies.find((c) => c.name === name)?.value;
}

const login = (email: string, password = TEST_PASSWORD) =>
  app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
const mfaVerify = (mfaToken: string, code: string) =>
  app.inject({ method: 'POST', url: '/api/auth/mfa/verify', payload: { mfaToken, code } });
const refresh = (token: string) =>
  app.inject({ method: 'POST', url: '/api/auth/refresh', cookies: { effinance_refresh: token } });
const forgot = (email: string) => app.inject({ method: 'POST', url: '/api/auth/password/forgot', payload: { email } });
const resetWith = (token: string, password: string) =>
  app.inject({ method: 'POST', url: '/api/auth/password/reset', payload: { token, password } });

async function enableMfa(user: Client): Promise<{ secret: string; recoveryCodes: string[] }> {
  const { secret } = (await user.post('/auth/mfa/setup')).body;
  const enabled = await user.post('/auth/mfa/enable', { code: await totpCode(secret, totpStep()), password: TEST_PASSWORD });
  expect(enabled.status).toBe(200);
  return { secret, recoveryCodes: enabled.body.recoveryCodes };
}

async function mfaToken(email: string): Promise<string> {
  const res = await login(email);
  expect(res.json().mfaRequired).toBe(true);
  return res.json().mfaToken;
}

// ---------------------------------------------------------------------------------------------
// Findings: authentication, MFA and sessions
// ---------------------------------------------------------------------------------------------

describe('finding: second factor', () => {
  it('limits MFA attempts per account, not only per IP (CWE-307)', async () => {
    const user = await registerUser(app, 'Força Bruta');
    const { secret } = await enableMfa(user);
    const token = await mfaToken(user.email);
    const wrong = await totpCode(secret, totpStep() + 1000);
    // A distributed attacker (many IPs) holding the password: 10 misses, then even the right code is refused.
    for (let i = 0; i < 10; i++) expect((await mfaVerify(token, wrong)).statusCode).toBe(401);
    const blocked = await mfaVerify(token, await totpCode(secret, totpStep() + 1));
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().error).toBe('too_many_requests');
    // Disabling 2FA (another code check) shares the same budget.
    expect((await user.post('/auth/mfa/disable', { code: await totpCode(secret, totpStep() + 1) })).status).toBe(429);
  });

  it('accepts a TOTP code only once, even for concurrent requests (CWE-367)', async () => {
    const user = await registerUser(app, 'Corrida TOTP');
    const { secret } = await enableMfa(user);
    const tokens = await Promise.all([1, 2, 3, 4].map(() => mfaToken(user.email)));
    const code = await totpCode(secret, totpStep() + 1);
    const results = await Promise.all(tokens.map((t) => mfaVerify(t, code)));
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
  });

  it('consumes a recovery code only once, even for concurrent requests (CWE-367)', async () => {
    const user = await registerUser(app, 'Corrida Recuperação');
    const { recoveryCodes } = await enableMfa(user);
    const tokens = await Promise.all([1, 2, 3, 4].map(() => mfaToken(user.email)));
    const results = await Promise.all(tokens.map((t) => mfaVerify(t, recoveryCodes[0]!)));
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
    const [row] = await executeRows<{ n: number }>(
      admin(),
      sql`select jsonb_array_length(mfa_recovery_codes)::int as n from users where id = ${user.userId}`,
    );
    expect(row!.n).toBe(7);
  });

  it('stores recovery codes with a salted KDF, still accepting legacy SHA-256 entries (CWE-916)', async () => {
    const user = await registerUser(app, 'Códigos');
    const { recoveryCodes } = await enableMfa(user);
    const [row] = await executeRows<{ codes: string[] }>(
      admin(),
      sql`select mfa_recovery_codes as codes from users where id = ${user.userId}`,
    );
    const bare = await Promise.all(recoveryCodes.map((c) => sha256Hex(c)));
    expect(row!.codes).toHaveLength(8);
    for (const stored of row!.codes) {
      expect(bare).not.toContain(stored);
      expect(stored).toMatch(/^pbkdf2\$\d+\$/);
    }
    expect((await mfaVerify(await mfaToken(user.email), recoveryCodes[3]!)).statusCode).toBe(200);

    // Accounts that enabled 2FA before the change keep working.
    const legacy = await sha256Hex('abcd-efgh');
    await admin().execute(sql`update users set mfa_recovery_codes = ${JSON.stringify([legacy])}::jsonb where id = ${user.userId}`);
    expect((await mfaVerify(await mfaToken(user.email), 'ABCD-EFGH')).statusCode).toBe(200);
    expect((await mfaVerify(await mfaToken(user.email), 'abcd-efgh')).statusCode).toBe(401);
  });

  it('requires re-authentication to enroll an authenticator on an old session (CWE-306)', async () => {
    const user = await registerUser(app, 'Sessão Antiga');
    // A stolen session from a login made days ago (refresh tokens keep it alive for weeks).
    await admin().execute(sql`update sessions set session_started_at = now() - interval '2 days' where user_id = ${user.userId}`);
    const { secret } = (await user.post('/auth/mfa/setup')).body;
    const code = await totpCode(secret, totpStep());

    const silent = await user.post('/auth/mfa/enable', { code });
    expect(silent.status).toBe(422);
    expect((await user.get('/auth/me')).body.user.mfaEnabled).toBe(false);
    expect((await user.post('/auth/mfa/enable', { code, password: 'nao-e-a-senha-1' })).status).toBe(422);
    expect((await user.get('/auth/me')).body.user.mfaEnabled).toBe(false);

    const ok = await user.post('/auth/mfa/enable', { code, password: TEST_PASSWORD });
    expect(ok.status).toBe(200);
    expect(ok.body.recoveryCodes).toHaveLength(8);
  });
});

describe('finding: sessions and passwords', () => {
  it('changing the password invalidates pending reset links (CWE-640)', async () => {
    const user = await registerUser(app, 'Link Pendente');
    expect((await forgot(user.email)).statusCode).toBe(204);
    const token = /token=([\w-]+)/.exec(outbox().at(-1)!.text)![1]!;
    expect((await user.post('/auth/password', { currentPassword: TEST_PASSWORD, newPassword: 'outra-senha-987' })).status).toBe(204);
    expect((await resetWith(token, 'senha-do-invasor-1')).statusCode).toBe(422);
    expect((await login(user.email, 'outra-senha-987')).statusCode).toBe(200);
  });

  it('puts the reset token in the URL fragment (kept out of server/CDN logs and Referer, CWE-598)', async () => {
    const user = await registerUser(app, 'Fragmento');
    await forgot(user.email);
    const text = outbox().at(-1)!.text;
    expect(text).toMatch(/\/redefinir-senha#token=[\w-]{40,}/);
    expect(text).not.toMatch(/\?token=/);
  });

  it('caps the absolute lifetime of a session however often it is refreshed (CWE-613)', async () => {
    const user = await registerUser(app, 'Sessão Eterna');
    const start = Date.now();
    let token = user.refreshToken!;
    for (const day of [25, 50, 75]) {
      vi.useFakeTimers({ toFake: ['Date'], now: start + day * DAY });
      const res = await refresh(token);
      expect(res.statusCode).toBe(204);
      token = cookie(res, 'effinance_refresh')!;
    }
    vi.useFakeTimers({ toFake: ['Date'], now: start + 91 * DAY });
    expect((await refresh(token)).statusCode).toBe(401);
  });

  it('answers forgot-password without waiting for e-mail delivery (timing enumeration, CWE-208)', async () => {
    const user = await registerUser(app, 'Entrega Lenta');
    const original = app.platform.mailer;
    const slow: Mailer = { name: 'webhook', delivers: true, send: () => new Promise((r) => setTimeout(r, 1500)) };
    app.platform.mailer = slow;
    try {
      const started = performance.now();
      expect((await forgot(user.email)).statusCode).toBe(204);
      expect(performance.now() - started).toBeLessThan(1000);
    } finally {
      app.platform.mailer = original;
    }
  });

  it('caps password-reset e-mails per account (mail bombing, CWE-799)', async () => {
    const user = await registerUser(app, 'Caixa Cheia');
    for (let i = 0; i < 8; i++) expect((await forgot(user.email)).statusCode).toBe(204);
    expect(outbox().filter((m) => m.to === user.email)).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------------------------
// Findings: tenant transaction boundary, integrity errors and token claims
// ---------------------------------------------------------------------------------------------

describe('finding: request boundary', () => {
  it('answers only after COMMIT: no success for a rolled-back write, read-your-writes after 201 (CWE-362)', async () => {
    const user = await registerUser(app, 'Commit');
    const workspaceId = (await user.get('/auth/me')).body.workspace.id as string;
    const probe = Fastify({ logger: false });
    probe.decorate('db', app.db);
    probe.decorateRequest('userId', '');
    probe.decorateRequest('workspaceId', '');
    probe.decorateRequest('sessionId', null);
    probe.decorateRequest('access', null as never);
    probe.decorateRequest('db', null as never);
    probe.decorate('authenticate', async (req: { userId: string; workspaceId: string; access: unknown }) => {
      req.userId = user.userId;
      req.workspaceId = workspaceId;
      req.access = { role: 'owner', subscription: { canWrite: true } };
    });
    await probe.register(tenantRoutes, {
      routes: [
        {
          prefix: '/probe',
          plugin: async (p) => {
            p.post('/fails-after-send', async (req, reply) => {
              await req.db.insert(accounts).values({ workspaceId: req.workspaceId, name: 'Fantasma', type: 'checking', color: '#152B61', icon: 'wallet' });
              reply.code(201).send({ ok: true });
              throw new Error('falhou depois do send');
            });
            p.post('/slow-commit', async (req, reply) => {
              await req.db.insert(accounts).values({ workspaceId: req.workspaceId, name: 'Visível', type: 'checking', color: '#152B61', icon: 'wallet' });
              reply.code(201).send({ ok: true });
              await new Promise((r) => setTimeout(r, 300));
            });
            p.post('/returns-reply', async (_req, reply) => {
              reply.code(202).send({ ok: true });
              return reply;
            });
          },
        },
      ],
    });
    await probe.ready();
    try {
      expect((await probe.inject({ method: 'POST', url: '/probe/fails-after-send' })).statusCode).toBe(500);
      const slow = await probe.inject({ method: 'POST', url: '/probe/slow-commit' });
      expect(slow.statusCode).toBe(201);
      // The client has the answer: the row is already committed (visible to any other connection).
      const names = await executeRows<{ name: string }>(
        admin(),
        sql`select name from accounts where workspace_id = ${workspaceId} and name in ('Fantasma', 'Visível')`,
      );
      expect(names.map((n) => n.name)).toEqual(['Visível']);
      const returned = await probe.inject({ method: 'POST', url: '/probe/returns-reply' });
      expect(returned.statusCode).toBe(202);
      expect(returned.json()).toEqual({ ok: true });
    } finally {
      await probe.close();
    }
  });

  it('maps unique and foreign-key violations to 409 instead of 500', async () => {
    const pending = Object.assign(new Error('Failed query: insert …'), {
      cause: Object.assign(new Error('duplicate key value'), { code: '23505', constraint_name: 'workspace_invites_pending_email_uq' }),
    });
    expect(fromDatabaseError(pending)).toMatchObject({ statusCode: 409, message: 'Já existe um convite pendente para este e-mail' });
    expect(fromDatabaseError({ code: '23503' })).toMatchObject({ statusCode: 409 });
    expect(fromDatabaseError(new Error('boom'))).toBeNull();

    // Concurrent invites to the same address race on the "one pending invite per e-mail" index.
    const owner = await registerUser(app, 'Convites Simultâneos');
    await familyOf(owner);
    const results = await Promise.all(
      [1, 2, 3, 4, 5, 6].map(() => owner.post('/workspaces/current/invites', { email: 'mesma@teste.com', role: 'viewer' })),
    );
    expect(results.every((r) => r.status === 201 || r.status === 409)).toBe(true);
    expect((await owner.get('/workspaces/current/invites')).body).toHaveLength(1);
  });

  it('rejects tokens whose claims are not UUIDs with 401, not a database error (CWE-20)', async () => {
    const user = await registerUser(app, 'Claims');
    const forged = app.jwt.sign({ typ: 'access', sub: user.userId, wid: 'not-a-uuid', sid: FAKE_ID });
    const res = await app.inject({ method: 'GET', url: '/api/accounts', headers: { authorization: `Bearer ${forged}` } });
    expect(res.statusCode).toBe(401);
  });

  it('refuses requests from a tab that still shows another workspace (X-Workspace-Id)', async () => {
    const user = await registerUser(app, 'Duas Abas');
    const personal = (await user.get('/auth/me')).body.workspace.id as string;
    const family = await familyOf(user, 'Outra Aba');
    const post = (workspaceHeader: string) =>
      app.inject({
        method: 'POST',
        url: '/api/accounts',
        headers: { authorization: `Bearer ${user.token}`, 'x-workspace-id': workspaceHeader },
        payload: { name: 'Conta', type: 'checking' },
      });
    const stale = await post(personal);
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toBe('workspace_mismatch');
    expect((await post(family)).statusCode).toBe(201);
    // The stale tab can still read and resynchronize.
    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${user.token}`, 'x-workspace-id': personal },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().workspace.id).toBe(family);
  });
});

// ---------------------------------------------------------------------------------------------
// Findings: workspaces (abuse / resource consumption)
// ---------------------------------------------------------------------------------------------

async function familyOf(owner: Client, name = 'Família Audit'): Promise<string> {
  const created = await owner.post('/workspaces', { name, kind: 'family' });
  expect(created.status).toBe(201);
  expect((await owner.post('/auth/switch-workspace', { workspaceId: created.body.id })).status).toBe(200);
  return created.body.id;
}

describe('finding: workspace abuse', () => {
  it('caps invite e-mails per workspace (spam through our sender, CWE-770)', async () => {
    const owner = await registerUser(app, 'Spammer');
    await familyOf(owner);
    // Re-inviting the same address replaces the pending invite, so the member limit never kicks in.
    for (let i = 0; i < 20; i++) {
      expect((await owner.post('/workspaces/current/invites', { email: 'vitima@teste.com', role: 'viewer' })).status).toBe(201);
    }
    const blocked = await owner.post('/workspaces/current/invites', { email: 'vitima@teste.com', role: 'viewer' });
    expect(blocked.status).toBe(429);
    expect(outbox().filter((m) => m.to === 'vitima@teste.com')).toHaveLength(20);
  });

  it('caps how many workspaces a user owns (each one is a new trial and a new KMS data key, CWE-770)', async () => {
    const user = await registerUser(app, 'Colecionadora');
    for (let i = 1; i <= 9; i++) expect((await user.post('/workspaces', { name: `Espaço ${i}`, kind: 'family' })).status).toBe(201);
    const over = await user.post('/workspaces', { name: 'Espaço 10', kind: 'business' });
    expect(over.status).toBe(422);
    expect((await user.get('/workspaces')).body).toHaveLength(10);
  });

  it('keeps e-mail subjects on one line (header injection through the workspace name, CWE-93)', async () => {
    const owner = await registerUser(app, 'Cabeçalho');
    await familyOf(owner, 'Casa\r\nBcc: alvo@evil.example');
    expect((await owner.post('/workspaces/current/invites', { email: 'convite@teste.com', role: 'viewer' })).status).toBe(201);
    const mail = outbox().at(-1)!;
    expect(mail.subject).not.toMatch(/[\r\n]/);
  });
});

// ---------------------------------------------------------------------------------------------
// Findings: billing (Mercado Pago)
// ---------------------------------------------------------------------------------------------

const MP_SECRET = 'mp-webhook-secret-auditoria';

function fakeMercadoPago() {
  const preapprovals = new Map<string, Record<string, any>>();
  const calls: { method: string; url: string; body?: any }[] = [];
  let counter = 0;
  let failGets = 0;
  let initPointHost = 'https://www.mercadopago.com.br';
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
    if (method === 'POST' && url.endsWith('/preapproval')) {
      const id = `pre_${++counter}`;
      preapprovals.set(id, { ...body, id, status: 'pending', init_point: `${initPointHost}/subscriptions/checkout?preapproval_id=${id}` });
      return json(preapprovals.get(id));
    }
    const pre = /\/preapproval\/([^/?]+)$/.exec(url);
    if (pre) {
      if (method === 'GET' && failGets > 0) {
        failGets -= 1;
        return json({ message: 'unavailable' }, 503);
      }
      const row = preapprovals.get(pre[1]!);
      if (!row) return json({ message: 'not found' }, 404);
      if (method === 'PUT') Object.assign(row, body);
      return json(row);
    }
    return json({ message: 'unexpected' }, 500);
  };
  return {
    preapprovals,
    calls,
    fetchImpl,
    failNextGets(n: number) {
      failGets = n;
    },
    answerCheckoutFrom(host: string) {
      initPointHost = host;
    },
  };
}

describe('finding: billing', () => {
  let mp: ReturnType<typeof fakeMercadoPago>;
  let original: BillingProvider;
  beforeEach(() => {
    mp = fakeMercadoPago();
    original = app.platform.billing;
    app.platform.billing = new MercadoPagoProvider({ accessToken: 'TEST-token', webhookSecret: MP_SECRET, fetch: mp.fetchImpl });
  });
  afterEach(() => {
    app.platform.billing = original;
  });

  async function webhook(dataId: string, eventId = `evt-${Math.random()}`) {
    const ts = String(Math.floor(Date.now() / 1000));
    const requestId = `req-${Math.random().toString(36).slice(2)}`;
    const v1 = await hmacSha256Hex(MP_SECRET, signatureManifest(dataId, requestId, ts));
    return app.inject({
      method: 'POST',
      url: `/api/billing/webhooks/mercadopago?data.id=${dataId}&type=subscription_preapproval`,
      headers: { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId },
      payload: { id: eventId, type: 'subscription_preapproval', action: 'updated', data: { id: dataId } },
    });
  }

  it('grants the plan that was actually paid, not the last one picked at checkout (CWE-840)', async () => {
    const owner = await registerUser(app, 'Plano Barato');
    expect((await owner.post('/billing/checkout', { planCode: 'individual_monthly' })).status).toBe(200); // pre_1, R$ 19,90
    expect((await owner.post('/billing/checkout', { planCode: 'family_monthly' })).status).toBe(200); // pre_2, R$ 34,90
    // The owner pays the cheap one…
    mp.preapprovals.get('pre_1')!.status = 'authorized';
    expect((await webhook('pre_1')).statusCode).toBe(200);
    const sub = (await owner.get('/billing/subscription')).body;
    // …and must not get the family plan (5 members) for it.
    expect(sub).toMatchObject({ status: 'active', plan: { code: 'individual_monthly' }, maxMembers: 1 });
    // The abandoned checkout is cancelled at Mercado Pago, so it cannot be paid later on top.
    expect(mp.preapprovals.get('pre_2')!.status).toBe('cancelled');
  });

  it('ignores notifications of a non-current preapproval unless it was authorized (CWE-345)', async () => {
    const owner = await registerUser(app, 'Plano Ativo');
    await owner.post('/billing/checkout', { planCode: 'individual_monthly' });
    mp.preapprovals.get('pre_1')!.status = 'authorized';
    await webhook('pre_1');
    expect((await owner.get('/billing/subscription')).body).toMatchObject({ status: 'active', plan: { code: 'individual_monthly' } });

    // Upgrade checkout started but not paid: its "pending" notification must not take the plan away.
    await owner.post('/billing/checkout', { planCode: 'family_monthly' });
    expect((await webhook('pre_2')).statusCode).toBe(200);
    expect((await owner.get('/billing/subscription')).body).toMatchObject({
      status: 'active',
      canWrite: true,
      plan: { code: 'individual_monthly' },
    });
    expect((await owner.post('/accounts', { name: 'Ainda escreve', type: 'checking' })).status).toBe(201);

    // Once paid, the upgrade replaces the old plan, which is cancelled at the provider.
    mp.preapprovals.get('pre_2')!.status = 'authorized';
    await webhook('pre_2');
    expect((await owner.get('/billing/subscription')).body).toMatchObject({
      status: 'active',
      plan: { code: 'family_monthly' },
      maxMembers: 5,
    });
    expect(mp.preapprovals.get('pre_1')!.status).toBe('cancelled');
  });

  it('only sends the browser to Mercado Pago checkout URLs (open redirect, CWE-601)', async () => {
    const owner = await registerUser(app, 'Checkout Desviado');
    mp.answerCheckoutFrom('https://mercadopago.com.br.evil.example');
    expect((await owner.post('/billing/checkout', { planCode: 'individual_monthly' })).status).toBe(500);
    mp.answerCheckoutFrom('http://www.mercadopago.com.br');
    expect((await owner.post('/billing/checkout', { planCode: 'individual_monthly' })).status).toBe(500);
    mp.answerCheckoutFrom('https://www.mercadopago.com');
    const ok = await owner.post('/billing/checkout', { planCode: 'individual_monthly' });
    expect(ok.status).toBe(200);
    expect(ok.body.checkoutUrl).toMatch(/^https:\/\/www\.mercadopago\.com\//);
  });

  it('processes a notification again when the first attempt failed (lost payment, CWE-754)', async () => {
    const owner = await registerUser(app, 'Webhook Instável');
    await owner.post('/billing/checkout', { planCode: 'individual_monthly' });
    mp.preapprovals.get('pre_1')!.status = 'authorized';
    mp.failNextGets(1);
    expect((await webhook('pre_1', 'evt-retry')).statusCode).toBe(500);
    // Mercado Pago retries the same notification.
    const retry = await webhook('pre_1', 'evt-retry');
    expect(retry.statusCode).toBe(200);
    expect((await owner.get('/billing/subscription')).body.status).toBe('active');
    expect((await webhook('pre_1', 'evt-retry')).json()).toMatchObject({ duplicate: true });
  });
});

// ---------------------------------------------------------------------------------------------
// Findings: HTTP hardening, logs, configuration, key management
// ---------------------------------------------------------------------------------------------

describe('finding: http, logs and configuration', () => {
  it('rejects calendar years the database cannot store with 400 instead of a 500 (CWE-20)', async () => {
    const user = await registerUser(app, 'Ano Zero');
    const tx = await user.post('/transactions', { type: 'expense', description: 'x', amount: 100, date: '0000-01-01' });
    expect(tx.status).toBe(400);
    expect((await user.get('/dashboard?month=0001-01')).status).toBe(400);
    expect((await user.get('/statement?from=0001-01-01&to=2026-01-01')).status).toBe(400);
    expect((await user.get('/dashboard?month=2026-10')).status).toBe(200);
  });

  it('marks API responses as non-cacheable (CWE-525)', async () => {
    const user = await registerUser(app, 'Cache');
    const res = await app.inject({ method: 'GET', url: '/api/accounts', headers: { authorization: `Bearer ${user.token}` } });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('scopes the access-token cookie to /api', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { name: 'Cookie', email: 'cookie-path@teste.com', password: TEST_PASSWORD, acceptTerms: true },
    });
    expect(res.cookies.find((c) => c.name === 'effinance_token')).toMatchObject({ path: '/api', httpOnly: true });
    const out = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { authorization: `Bearer ${res.json().token}` } });
    const cleared = out.cookies.filter((c) => c.name === 'effinance_token');
    // The new scope and the legacy one (path "/") are both cleared.
    expect(cleared.map((c) => c.path).sort()).toEqual(['/', '/api']);
  });

  it('keeps CPF searches, invite tokens and SQL parameters out of the logs (CWE-532)', async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, done) {
        lines.push(String(chunk));
        done();
      },
    });
    const logged = await buildApp({ logger: { level: 'info', stream } });
    await logged.ready();
    try {
      const reg = await logged.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { name: 'Logs', email: 'logs@teste.com', password: TEST_PASSWORD, acceptTerms: true },
      });
      const auth = { authorization: `Bearer ${reg.json().token}` };
      await logged.inject({ method: 'GET', url: '/api/search?q=52998224725', headers: auth });
      await logged.inject({ method: 'GET', url: `/api/invites/${'k'.repeat(43)}` });
      // A database failure on a query carrying personal data (forced by renaming a column briefly).
      await admin().execute(sql`alter table contacts rename column name to name_audit_tmp`);
      let boom;
      try {
        boom = await logged.inject({
          method: 'POST',
          url: '/api/contacts',
          headers: auth,
          payload: { name: 'PII-MARKER-7781', email: 'pii-marker@exemplo.com' },
        });
      } finally {
        await admin().execute(sql`alter table contacts rename column name_audit_tmp to name`);
      }
      expect(boom.statusCode).toBe(500);
      expect(boom.json()).toEqual({ error: 'internal_error', message: 'Erro inesperado. Tente novamente.' });
      const all = lines.join('');
      expect(all).toContain('unhandled error');
      expect(all).toContain('params: [redacted]');
      expect(all).toContain('/api/search');
      expect(all).not.toContain('52998224725');
      expect(all).not.toContain('k'.repeat(43));
      expect(all).not.toContain('PII-MARKER-7781');
      expect(all).not.toContain('logs@teste.com');
    } finally {
      // buildApp re-pointed the shared keyring at the logged app's pool: point it back first.
      configureKeyring({ provider: keyProvider(), db: app.db });
      await logged.close();
    }
  });

  it('scrubs e-mails, documents and SQL parameters from logged errors and URLs (CWE-532)', () => {
    const ses = new Error('Email address is not verified. The following identities failed the check in region SA-EAST-1: ana.souza@exemplo.com.br');
    const pg = Object.assign(new Error('invalid input syntax for type uuid: "52998224725"'), { code: '22P02' });
    const drizzle = Object.assign(new Error('Failed query: select 1 where id = $1\nparams: 52998224725,ana@x.com'), { params: ['x'], cause: pg });
    const out = JSON.stringify([serializeError(ses), serializeError(drizzle)]);
    expect(out).not.toMatch(/ana\.souza@|ana@x\.com|52998224725/);
    expect(out).toContain('"code":"22P02"');
    expect(sanitizeUrl('/api/contacts?search=Maria%20Silva&page=2')).toBe('/api/contacts?search=[redacted]&page=2');
    expect(sanitizeUrl('/api/invites/abcDEF123_-xyz/accept')).toBe('/api/invites/[token]/accept');
  });

  describe('production environment', () => {
    const hardened: Record<string, string> = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://api:secret@db.internal:5432/effinance',
      DATABASE_SSL: 'verify-full',
      DATABASE_CA_FILE: '/etc/ssl/rds-global-bundle.pem',
      JWT_SECRET: 'Zx9-'.repeat(12),
      KEY_PROVIDER: 'aws',
      KMS_KEY_ID: 'arn:aws:kms:sa-east-1:111122223333:key/abcd',
      AWS_REGION: 'sa-east-1',
      BILLING_PROVIDER: 'mercadopago',
      MP_ACCESS_TOKEN: 'APP_USR-token',
      MP_WEBHOOK_SECRET: 'whsec',
      MAILER: 'ses',
      APP_URL: 'https://app.effinance.com.br',
      CORS_ORIGIN: 'https://app.effinance.com.br',
    };

    async function loadEnv(overrides: Record<string, string | undefined>): Promise<string | null> {
      vi.resetModules();
      for (const [k, v] of Object.entries({ ...hardened, ...overrides })) vi.stubEnv(k, v);
      try {
        await import('../src/env');
        return null;
      } catch (error) {
        return (error as Error).message;
      } finally {
        vi.unstubAllEnvs();
      }
    }

    it('accepts the documented production setup', async () => {
      expect(await loadEnv({})).toBeNull();
    });

    it.each([
      ['console mailer (reset links in stdout)', { MAILER: undefined }, 'MAILER'],
      ['console mailer, explicit', { MAILER: 'console' }, 'MAILER'],
      ['database without TLS', { DATABASE_SSL: 'disable' }, 'DATABASE_SSL'],
      ['database TLS without certificate check', { DATABASE_SSL: 'require' }, 'DATABASE_SSL'],
      ['plain-http app URL', { APP_URL: 'http://app.effinance.com.br' }, 'APP_URL'],
      ['localhost CORS origin', { CORS_ORIGIN: 'http://localhost:5173' }, 'CORS_ORIGIN'],
      ['placeholder JWT secret', { JWT_SECRET: 'change-me-to-a-long-random-secret-of-32-chars-or-more' }, 'JWT_SECRET'],
      ['dev-only JWT secret', { JWT_SECRET: 'dev-only-not-a-secret-replace-before-deploying-anywhere' }, 'JWT_SECRET'],
      ['short JWT secret', { JWT_SECRET: 'k'.repeat(40) }, 'JWT_SECRET'],
      ['local master key', { KEY_PROVIDER: 'local', ENCRYPTION_MASTER_KEY: Buffer.alloc(32, 7).toString('base64') }, 'KEY_PROVIDER'],
      ['unauthenticated mail webhook', { MAILER: 'webhook', MAIL_WEBHOOK_URL: 'https://mail.internal/send' }, 'MAIL_WEBHOOK_SECRET'],
      ['plain-http mail webhook', { MAILER: 'webhook', MAIL_WEBHOOK_URL: 'http://mail.internal/send', MAIL_WEBHOOK_SECRET: 's' }, 'MAIL_WEBHOOK_URL'],
    ])('refuses to start with %s (CWE-1188)', async (_label, overrides, variable) => {
      const message = await loadEnv(overrides);
      expect(message).toContain(variable);
    });
  });

  it('never pins the calendar date in production (EFFINANCE_TODAY)', () => {
    expect(today()).toBe('2026-10-20');
    vi.stubEnv('NODE_ENV', 'production');
    try {
      expect(today()).not.toBe('2026-10-20');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('uses the public development master key only when NODE_ENV says development/test (CWE-1188)', async () => {
    const devLike = { ...env, NODE_ENV: 'development' as const, KEY_PROVIDER: 'local' as const, ENCRYPTION_MASTER_KEY: undefined };
    vi.stubEnv('NODE_ENV', undefined);
    try {
      // NODE_ENV missing: the schema defaults it to "development", but the dev key must not be used.
      await expect(createKeyProvider(devLike, () => {})).rejects.toThrow(/ENCRYPTION_MASTER_KEY/);
    } finally {
      vi.unstubAllEnvs();
    }
    vi.stubEnv('NODE_ENV', 'development');
    try {
      expect((await createKeyProvider(devLike, () => {})).name).toBe('local');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('never replaces a data key another instance already stored (legacy workspaces, CWE-362)', async () => {
    const user = await registerUser(app, 'Chave Legada');
    const workspaceId = (await user.get('/auth/me')).body.workspace.id as string;
    await admin().execute(sql`update workspaces set wrapped_key = null, key_id = null where id = ${workspaceId}`);
    const real = keyProvider();
    let winner: Awaited<ReturnType<KeyProvider['generateDataKey']>> | null = null;
    const racing: KeyProvider = {
      name: real.name,
      decryptDataKey: (w, wrapped, keyId) => real.decryptDataKey(w, wrapped, keyId),
      encryptSecret: (p, c) => real.encryptSecret(p, c),
      decryptSecret: (c, ctx) => real.decryptSecret(c, ctx),
      async generateDataKey(w) {
        const mine = await real.generateDataKey(w);
        // Meanwhile another API instance generated and stored its own key (and encrypted data with it).
        winner = await real.generateDataKey(w);
        await admin().execute(sql`update workspaces set wrapped_key = ${winner.wrapped}, key_id = ${winner.keyId} where id = ${w}`);
        return mine;
      },
    };
    configureKeyring({ provider: racing, db: app.db });
    try {
      const cipher = await getCipher(workspaceId);
      const sealed = (await (await FieldCipher.create(workspaceId, winner!.plaintext)).encrypt('contacts', 'notes', 'dado'))!;
      expect(await cipher.decrypt('contacts', 'notes', sealed)).toBe('dado');
      const [row] = await executeRows<{ wrapped_key: string }>(admin(), sql`select wrapped_key from workspaces where id = ${workspaceId}`);
      expect(row!.wrapped_key).toBe(winner!.wrapped);
    } finally {
      configureKeyring({ provider: real, db: app.db });
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Guards: access-control matrices (already correct; pinned against regressions)
// ---------------------------------------------------------------------------------------------

describe('guards: access control', () => {
  const DOMAIN_MUTATIONS: [string, string][] = [
    ['POST', '/categories'],
    ['PUT', `/categories/${FAKE_ID}`],
    ['DELETE', `/categories/${FAKE_ID}`],
    ['POST', '/accounts'],
    ['PUT', `/accounts/${FAKE_ID}`],
    ['DELETE', `/accounts/${FAKE_ID}`],
    ['POST', '/credit-cards'],
    ['PUT', `/credit-cards/${FAKE_ID}`],
    ['DELETE', `/credit-cards/${FAKE_ID}`],
    ['POST', `/credit-cards/${FAKE_ID}/invoices/2026-10/pay`],
    ['POST', '/goals'],
    ['PUT', `/goals/${FAKE_ID}`],
    ['DELETE', `/goals/${FAKE_ID}`],
    ['POST', `/goals/${FAKE_ID}/contributions`],
    ['DELETE', `/goals/${FAKE_ID}/contributions/${FAKE_ID}`],
    ['POST', '/contacts'],
    ['PUT', `/contacts/${FAKE_ID}`],
    ['DELETE', `/contacts/${FAKE_ID}`],
    ['POST', '/transactions'],
    ['PUT', `/transactions/${FAKE_ID}`],
    ['PATCH', `/transactions/${FAKE_ID}/paid`],
    ['POST', `/transactions/${FAKE_ID}/anticipate`],
    ['DELETE', `/transactions/${FAKE_ID}`],
    ['POST', '/transfers'],
    ['PUT', `/transfers/${FAKE_ID}`],
    ['DELETE', `/transfers/${FAKE_ID}`],
    // Imports and Open Finance (lib/tenant-scope.ts guards).
    ['POST', '/imports/preview'],
    ['POST', '/imports'],
    ['DELETE', `/imports/${FAKE_ID}`],
    ['POST', '/open-finance/connect-token'],
    ['POST', '/open-finance/dev/connect'],
    ['POST', '/open-finance/connections'],
    ['PUT', `/open-finance/connections/${FAKE_ID}/accounts`],
    ['POST', `/open-finance/connections/${FAKE_ID}/sync`],
    ['DELETE', `/open-finance/connections/${FAKE_ID}`],
  ];

  async function call(c: Client, method: string, url: string, body: unknown = {}) {
    const res = await app.inject({
      method: method as 'POST',
      url: `/api${url}`,
      headers: { authorization: `Bearer ${c.token}` },
      ...(method === 'DELETE' ? {} : { payload: body as object }),
    });
    return res.statusCode;
  }

  it('viewers get 403 and expired workspaces 402 on every financial mutation (BFLA)', async () => {
    const owner = await registerUser(app, 'Dona Matriz');
    const workspaceId = await familyOf(owner);
    const inv = await owner.post('/workspaces/current/invites', { email: 'leitor-matriz@teste.com', role: 'viewer' });
    const viewer = await registerUser(app, 'Leitor', 'leitor-matriz@teste.com');
    expect((await viewer.post(`/invites/${inv.body.inviteUrl.split('/convite/')[1]}/accept`)).status).toBe(200);
    for (const [method, url] of DOMAIN_MUTATIONS) expect(await call(viewer, method, url), `${method} ${url}`).toBe(403);

    await admin().execute(sql`update subscriptions set trial_ends_at = now() - interval '1 day' where workspace_id = ${workspaceId}`);
    for (const [method, url] of DOMAIN_MUTATIONS) expect(await call(owner, method, url), `${method} ${url}`).toBe(402);
  });

  it('only the owner manages the workspace, members, invites, billing, export and audit (BFLA)', async () => {
    const owner = await registerUser(app, 'Dona Gestão');
    await familyOf(owner, 'Gestão');
    const inv = await owner.post('/workspaces/current/invites', { email: 'editor-matriz@teste.com', role: 'editor' });
    const editor = await registerUser(app, 'Editor', 'editor-matriz@teste.com');
    expect((await editor.post(`/invites/${inv.body.inviteUrl.split('/convite/')[1]}/accept`)).status).toBe(200);
    const pending = await owner.post('/workspaces/current/invites', { email: 'outro@teste.com', role: 'viewer' });

    const ownerOnly: [string, string, unknown?][] = [
      ['PUT', '/workspaces/current', { name: 'Tomado' }],
      ['DELETE', '/workspaces/current', { confirmName: 'Gestão' }],
      ['PATCH', `/workspaces/current/members/${owner.userId}`, { role: 'viewer' }],
      ['DELETE', `/workspaces/current/members/${owner.userId}`],
      ['GET', '/workspaces/current/invites'],
      ['POST', '/workspaces/current/invites', { email: 'x@teste.com', role: 'editor' }],
      ['DELETE', `/workspaces/current/invites/${pending.body.id}`],
      ['GET', '/workspaces/current/export'],
      ['GET', '/workspaces/current/audit'],
      ['POST', '/billing/checkout', { planCode: 'family_monthly' }],
      ['POST', '/billing/cancel'],
      ['POST', '/billing/dev/activate', { planCode: 'family_monthly' }],
    ];
    for (const [method, url, body] of ownerOnly) {
      const res = await app.inject({
        method: method as 'POST',
        url: `/api${url}`,
        headers: { authorization: `Bearer ${editor.token}` },
        ...(body !== undefined ? { payload: body as object } : {}),
      });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }
    // A forged token for a workspace the user is not a member of is rejected (claims are re-checked).
    const forged = app.jwt.sign({ typ: 'access', sub: editor.userId, wid: FAKE_ID, sid: FAKE_ID });
    expect((await app.inject({ method: 'GET', url: '/api/accounts', headers: { authorization: `Bearer ${forged}` } })).statusCode).toBe(401);
    // An MFA challenge token is never an access token, and vice versa.
    const mfa = app.jwt.sign({ typ: 'mfa', sub: editor.userId });
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${mfa}` } })).statusCode).toBe(401);
    expect((await mfaVerify(editor.token, '123456')).statusCode).toBe(401);
  });

  it('rejects ids of another workspace everywhere, including nested references (BOLA)', async () => {
    const alice = await registerUser(app, 'Alice Matriz');
    const bob = await registerUser(app, 'Bob Matriz');
    const aAccount = await createAccount(alice);
    const aCategory = await firstCategory(alice, 'expense');
    const aSub = aCategory.subcategories[0]!.id;
    const aCard = (await alice.post('/credit-cards', { name: 'C', bank: 'nubank', brand: 'visa', limit: 100000, closingDay: 3, dueDay: 10 })).body.id;
    const aContact = (await alice.post('/contacts', { name: 'Contato A' })).body.id;
    const aGoal = (await alice.post('/goals', { name: 'Meta A', targetAmount: 1000 })).body.id;
    const aContribution = (await alice.post(`/goals/${aGoal}/contributions`, { amount: 100, date: '2026-10-01' })).body.id;
    const aTx = (await alice.post('/transactions', { type: 'expense', description: 'A', amount: 900, date: '2026-10-10', recurrenceKind: 'installment', installments: 3, creditCardId: aCard })).body[0].id;
    await familyOf(alice, 'Família Alice');
    const aInvite = (await alice.post('/workspaces/current/invites', { email: 'convidado-a@teste.com', role: 'viewer' })).body.id;
    const aSession = (await alice.get('/auth/sessions')).body[0].id;
    const aWorkspace = (await alice.get('/auth/me')).body.workspace.id;

    const bAccount = await createAccount(bob);
    const bCategory = await firstCategory(bob, 'expense');
    const bCard = (await bob.post('/credit-cards', { name: 'B', bank: 'nubank', brand: 'visa', limit: 100000, closingDay: 3, dueDay: 10 })).body.id;
    const bGoal = (await bob.post('/goals', { name: 'Meta B', targetAmount: 1000 })).body.id;
    const bTx = (await bob.post('/transactions', { type: 'expense', description: 'B', amount: 100, date: '2026-10-10', accountId: bAccount })).body[0].id;
    const base = { type: 'expense', description: 'x', amount: 100, date: '2026-10-10' };

    const probes: [string, string, unknown?][] = [
      ['POST', '/transactions', { ...base, creditCardId: aCard }],
      ['POST', '/transactions', { ...base, contactId: aContact }],
      ['POST', '/transactions', { ...base, categoryId: bCategory.id, subcategoryId: aSub }],
      ['POST', '/transactions', { ...base, splits: [{ categoryId: bCategory.id, amount: 50 }, { categoryId: aCategory.id, amount: 50 }] }],
      ['PUT', `/transactions/${bTx}`, { categoryId: aCategory.id }],
      ['PUT', `/transactions/${bTx}`, { accountId: aAccount }],
      ['PATCH', `/transactions/${bTx}/paid`, { paid: true, accountId: aAccount }],
      ['POST', `/transactions/${aTx}/anticipate`, {}],
      ['POST', '/transfers', { fromAccountId: bAccount, toAccountId: aAccount, amount: 100, date: '2026-10-10' }],
      ['POST', '/goals', { name: 'g', targetAmount: 10, accountId: aAccount }],
      ['POST', `/goals/${aGoal}/contributions`, { amount: 10, date: '2026-10-01' }],
      ['DELETE', `/goals/${bGoal}/contributions/${aContribution}`],
      ['POST', '/credit-cards', { name: 'c', bank: 'nubank', brand: 'visa', limit: 10, closingDay: 1, dueDay: 8, defaultAccountId: aAccount }],
      ['POST', `/credit-cards/${bCard}/invoices/2026-11/pay`, { accountId: aAccount, date: '2026-11-05' }],
      ['POST', '/categories', { name: 'sub', type: 'expense', parentId: aCategory.id }],
      ['GET', `/credit-cards/${aCard}/invoices`],
      ['GET', `/credit-cards/${aCard}/invoices/2026-11`],
      ['GET', `/contacts/${aContact}`],
      ['GET', `/goals/${aGoal}/contributions`],
      ['GET', `/reports/cashflow?from=2026-10-01&to=2026-10-31&accountId=${aAccount}`],
      ['GET', `/statement?from=2026-10-01&to=2026-10-31&accountId=${aAccount}`],
      ['DELETE', `/workspaces/current/invites/${aInvite}`],
      ['PATCH', `/workspaces/current/members/${alice.userId}`, { role: 'viewer' }],
      ['POST', '/auth/switch-workspace', { workspaceId: aWorkspace }],
    ];
    for (const [method, url, body] of probes) {
      const res = await app.inject({
        method: method as 'POST',
        url: `/api${url}`,
        headers: { authorization: `Bearer ${bob.token}` },
        ...(body !== undefined ? { payload: body as object } : {}),
      });
      expect(res.statusCode, `${method} ${url}`).toBe(404);
    }
    expect((await bob.del(`/auth/sessions/${aSession}`)).status).toBe(401);
    expect((await alice.get('/auth/sessions')).body).toHaveLength(1);
    const filtered = await bob.get(`/transactions?accountId=${aAccount}&creditCardId=${aCard}&contactId=${aContact}`);
    expect(filtered.body.total).toBe(0);
  });
});
