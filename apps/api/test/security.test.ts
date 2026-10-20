import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from '../src/app';
import { FieldCipher } from '../src/lib/crypto/field-cipher';
import { randomBytes } from '../src/lib/crypto/encoding';
import type { MemoryMailer } from '../src/lib/mailer';
import { executeRows } from '../src/lib/sql';
import { totpCode, totpStep } from '../src/lib/totp';
import { TEST_PASSWORD, admin, createAccount, createTestApp, registerUser, resetDb } from './helpers';

let app: App;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await resetDb(app);
  (app.platform.mailer as MemoryMailer).outbox.length = 0;
});
afterEach(() => {
  vi.useRealTimers();
});

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

function cookie(res: { cookies: { name: string; value: string }[] }, name: string) {
  return res.cookies.find((c) => c.name === name)?.value;
}

async function login(email: string, password = TEST_PASSWORD) {
  return app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
}

function refresh(token: string) {
  return app.inject({ method: 'POST', url: '/api/auth/refresh', cookies: { effinance_refresh: token } });
}

describe('sessions', () => {
  it('rotates refresh tokens and revokes the family when an old one is reused', async () => {
    const user = await registerUser(app, 'Rotação');
    const r1 = user.refreshToken!;
    expect(r1).toBeTruthy();

    const first = await refresh(r1);
    expect(first.statusCode).toBe(204);
    const r2 = cookie(first, 'effinance_refresh')!;
    const access2 = cookie(first, 'effinance_token')!;
    expect(r2).not.toBe(r1);
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: bearer(access2) })).statusCode).toBe(200);

    // A concurrent request with the just-rotated token is tolerated but gets nothing new.
    const concurrent = await refresh(r1);
    expect(concurrent.statusCode).toBe(204);
    expect(cookie(concurrent, 'effinance_refresh')).toBeUndefined();

    // Later, the old token showing up again means it was stolen: the whole session dies.
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 60_000 });
    const reuse = await refresh(r1);
    expect(reuse.statusCode).toBe(401);
    expect((await refresh(r2)).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: bearer(access2) })).statusCode).toBe(401);
    vi.useRealTimers();

    const auditRows = await executeRows<{ action: string }>(admin(), sql`select action from audit_logs where action = 'auth.refresh_token_reuse'`);
    expect(auditRows).toHaveLength(1);
  });

  it('lists sessions, revokes one, and logout kills the session server-side', async () => {
    const user = await registerUser(app, 'Sessões');
    const other = await login(user.email);
    expect(other.statusCode).toBe(200);
    const otherAccess = other.json().token;

    const list = await user.get('/auth/sessions');
    expect(list.body).toHaveLength(2);
    expect(list.body.filter((s: any) => s.current)).toHaveLength(1);
    const otherSession = list.body.find((s: any) => !s.current);
    expect(otherSession.ip).toMatch(/\.x$/);

    expect((await user.del(`/auth/sessions/${otherSession.id}`)).status).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/api/accounts', headers: bearer(otherAccess) })).statusCode).toBe(401);

    const out = await app.inject({ method: 'POST', url: '/api/auth/logout', cookies: { effinance_refresh: user.refreshToken! } });
    expect(out.statusCode).toBe(204);
    expect(out.cookies.find((c) => c.name === 'effinance_token')?.value).toBe('');
    expect((await user.get('/accounts')).status).toBe(401);
    expect((await refresh(user.refreshToken!)).statusCode).toBe(401);
  });

  it('changing the password signs out the other sessions', async () => {
    const user = await registerUser(app, 'Troca');
    const other = (await login(user.email)).json().token;
    const wrong = await user.post('/auth/password', { currentPassword: 'nao-e-essa-1', newPassword: 'nova-senha-456' });
    expect(wrong.status).toBe(422);
    const weak = await user.post('/auth/password', { currentPassword: TEST_PASSWORD, newPassword: 'curta' });
    expect(weak.status).toBe(400);
    expect((await user.post('/auth/password', { currentPassword: TEST_PASSWORD, newPassword: 'nova-senha-456' })).status).toBe(204);
    expect((await user.get('/accounts')).status).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/accounts', headers: bearer(other) })).statusCode).toBe(401);
    expect((await login(user.email)).statusCode).toBe(401);
    expect((await login(user.email, 'nova-senha-456')).statusCode).toBe(200);
  });
});

describe('two-factor authentication', () => {
  it('enables TOTP, requires it on login, accepts recovery codes once and can be disabled', async () => {
    const user = await registerUser(app, 'Dois Fatores');
    const setup = await user.post('/auth/mfa/setup');
    expect(setup.status).toBe(200);
    expect(setup.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\/Effinance:/);
    const { secret } = setup.body;

    expect((await user.post('/auth/mfa/enable', { code: '000000' })).status).toBe(422);
    const enabled = await user.post('/auth/mfa/enable', { code: await totpCode(secret, totpStep()) });
    expect(enabled.status).toBe(200);
    expect(enabled.body.recoveryCodes).toHaveLength(8);
    expect((await user.get('/auth/me')).body.user.mfaEnabled).toBe(true);

    // The secret is stored encrypted.
    const [stored] = await executeRows<{ mfa_secret_enc: string }>(admin(), sql`select mfa_secret_enc from users where id = ${user.userId}`);
    expect(stored!.mfa_secret_enc).not.toContain(secret);

    const challenge = await login(user.email);
    expect(challenge.json()).toMatchObject({ mfaRequired: true });
    expect(cookie(challenge, 'effinance_token')).toBeUndefined();
    const { mfaToken } = challenge.json();
    // The MFA token is not an access token.
    expect((await app.inject({ method: 'GET', url: '/api/accounts', headers: bearer(mfaToken) })).statusCode).toBe(401);

    const verify = (code: string, token = mfaToken) =>
      app.inject({ method: 'POST', url: '/api/auth/mfa/verify', payload: { mfaToken: token, code } });
    expect((await verify('123456')).statusCode).toBe(401);
    const ok = await verify(await totpCode(secret, totpStep() + 1));
    expect(ok.statusCode).toBe(200);
    expect(ok.json().token).toBeTruthy();
    // The same code cannot be replayed.
    const again = (await login(user.email)).json().mfaToken;
    expect((await verify(await totpCode(secret, totpStep() + 1), again)).statusCode).toBe(401);

    const recovery = enabled.body.recoveryCodes[0];
    expect((await verify(recovery.toUpperCase(), again)).statusCode).toBe(200);
    const third = (await login(user.email)).json().mfaToken;
    expect((await verify(recovery, third)).statusCode).toBe(401);

    expect((await user.post('/auth/mfa/disable', { code: enabled.body.recoveryCodes[1] })).status).toBe(204);
    const plain = await login(user.email);
    expect(plain.json().token).toBeTruthy();
  });
});

describe('password reset', () => {
  it('sends a single-use link, sets the new password and signs out every session', async () => {
    const user = await registerUser(app, 'Esquecida');
    const outbox = (app.platform.mailer as MemoryMailer).outbox;
    const forgot = (email: string) => app.inject({ method: 'POST', url: '/api/auth/password/forgot', payload: { email } });

    expect((await forgot('ninguem@teste.com')).statusCode).toBe(204);
    expect(outbox).toHaveLength(0);
    expect((await forgot(user.email)).statusCode).toBe(204);
    expect(outbox).toHaveLength(1);
    const token = /token=([\w-]+)/.exec(outbox[0]!.text)![1]!;

    const reset = (password: string) =>
      app.inject({ method: 'POST', url: '/api/auth/password/reset', payload: { token, password } });
    expect((await reset('fraca')).statusCode).toBe(400);
    expect((await reset('recuperada-789')).statusCode).toBe(204);
    expect((await reset('recuperada-789')).statusCode).toBe(422);
    expect((await user.get('/accounts')).status).toBe(401);
    expect((await login(user.email)).statusCode).toBe(401);
    expect((await login(user.email, 'recuperada-789')).statusCode).toBe(200);
  });
});

describe('encryption at rest', () => {
  it('stores personal data and notes encrypted; the API returns plaintext', async () => {
    const user = await registerUser(app, 'Cifrada');
    const account = await createAccount(user);
    const contact = await user.post('/contacts', {
      name: 'Carlos Pereira',
      document: '529.982.247-25',
      email: 'carlos@exemplo.com',
      phone: '(11) 98765-4321',
      street: 'Rua das Flores',
      notes: 'Cliente desde 2020',
    });
    await user.post('/transactions', {
      type: 'income',
      description: 'Consultoria',
      amount: 500000,
      date: '2026-10-05',
      accountId: account,
      contactId: contact.body.id,
      notes: 'NF 1234 — confidencial',
      recurrenceKind: 'fixed',
      frequency: 'monthly',
    });
    const goal = await user.post('/goals', { name: 'Reserva', targetAmount: 100000, notes: 'Plano secreto' });
    await user.post(`/goals/${goal.body.id}/contributions`, { amount: 1000, date: '2026-10-01', note: 'Bônus' });

    const [row] = await executeRows<Record<string, string>>(
      admin(),
      sql`select document, email, phone, street, notes, document_hash from contacts where id = ${contact.body.id}`,
    );
    for (const field of ['document', 'email', 'phone', 'street', 'notes']) expect(row![field]).toMatch(/^v1\./);
    expect(JSON.stringify(row)).not.toMatch(/52998224725|carlos@|98765|Flores|2020/);
    expect(row!.document_hash).toMatch(/^[0-9a-f]{64}$/);

    const notes = await executeRows<{ notes: string }>(admin(), sql`select notes from transactions where notes is not null`);
    expect(notes.length).toBeGreaterThan(1);
    expect(notes.every((n) => n.notes.startsWith('v1.'))).toBe(true);
    const [series] = await executeRows<{ notes: string }>(admin(), sql`select template->>'notes' as notes from recurrences`);
    expect(series!.notes).toMatch(/^v1\./);
    const [goalRow] = await executeRows<{ notes: string }>(admin(), sql`select notes from goals`);
    expect(goalRow!.notes).toMatch(/^v1\./);
    const [contribution] = await executeRows<{ note: string }>(admin(), sql`select note from goal_contributions`);
    expect(contribution!.note).toMatch(/^v1\./);

    expect((await user.get(`/contacts/${contact.body.id}`)).body).toMatchObject({
      document: '52998224725',
      email: 'carlos@exemplo.com',
      street: 'Rua das Flores',
      notes: 'Cliente desde 2020',
    });
    const list = await user.get('/transactions?search=Consultoria&pageSize=2');
    expect(list.body.items[0].notes).toBe('NF 1234 — confidencial');
    expect((await user.get(`/goals/${goal.body.id}/contributions`)).body[0].note).toBe('Bônus');
    expect((await user.get('/goals')).body[0].notes).toBe('Plano secreto');
    expect((await user.get('/search?q=52998224725')).body.contacts).toHaveLength(1);
  });

  it('binds ciphertexts to workspace, table and column', async () => {
    const key = randomBytes(32);
    const a = await FieldCipher.create('ws-a', key);
    const b = await FieldCipher.create('ws-b', key);
    const sealed = (await a.encrypt('contacts', 'email', 'x@y.com'))!;
    expect(await a.decrypt('contacts', 'email', sealed)).toBe('x@y.com');
    await expect(a.decrypt('contacts', 'phone', sealed)).rejects.toThrow();
    await expect(b.decrypt('contacts', 'email', sealed)).rejects.toThrow();
    expect(await a.encrypt('contacts', 'email', 'x@y.com')).not.toBe(sealed);
    expect(await a.blindIndex('123')).toBe(await a.blindIndex('123'));
    expect(await a.blindIndex('123')).not.toBe(await (await FieldCipher.create('ws-a', randomBytes(32))).blindIndex('123'));
  });
});

describe('request hardening', () => {
  it('rejects cross-origin and non-JSON state-changing requests (CSRF)', async () => {
    const user = await registerUser(app, 'Origem');
    const post = (headers: Record<string, string>, payload: string) =>
      app.inject({ method: 'POST', url: '/api/accounts', headers: { ...bearer(user.token), ...headers }, payload });
    const body = JSON.stringify({ name: 'Conta', type: 'checking' });

    const evil = await post({ origin: 'https://evil.example', 'content-type': 'application/json' }, body);
    expect(evil.statusCode).toBe(403);
    const form = await post({ 'content-type': 'text/plain' }, body);
    expect(form.statusCode).toBe(415);
    const ok = await post({ origin: 'http://localhost:5173', 'content-type': 'application/json' }, body);
    expect(ok.statusCode).toBe(201);
  });

  it('sends strict security headers', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
  });

  it('issues short-lived access tokens and httpOnly cookies scoped to their use', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { name: 'Cookies', email: 'cookies@teste.com', password: TEST_PASSWORD, acceptTerms: true },
    });
    const access = res.cookies.find((c) => c.name === 'effinance_token')!;
    const refreshCookie = res.cookies.find((c) => c.name === 'effinance_refresh')!;
    expect(access).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 900 });
    expect(refreshCookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/api/auth' });
    const payload = JSON.parse(Buffer.from(res.json().token.split('.')[1], 'base64url').toString());
    expect(payload.exp - payload.iat).toBe(900);
    expect(payload).toMatchObject({ typ: 'access' });
    expect(payload.wid).toBeTruthy();
    expect(payload.sid).toBeTruthy();
  });

  it('requires accepting the terms and a strong password on sign-up', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { name: 'X', email: 'x@teste.com', password: 'somenteletras', acceptTerms: false },
    });
    expect(res.statusCode).toBe(400);
    const paths = res.json().details.map((d: any) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['password', 'acceptTerms']));
  });
});
