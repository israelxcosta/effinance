import { describe, expect, it } from 'vitest';
import { isSafeApiPath, isUuid, resolveCheckoutUrl, safeInternalPath } from './safe-url';

describe('safeInternalPath (post-login redirect)', () => {
  it('keeps in-app paths with query and hash', () => {
    expect(safeInternalPath('/extrato?conta=1&modo=month')).toBe('/extrato?conta=1&modo=month');
    expect(safeInternalPath('/convite/abc_DEF-123')).toBe('/convite/abc_DEF-123');
    expect(safeInternalPath('/configuracoes?aba=assinatura#x')).toBe('/configuracoes?aba=assinatura#x');
  });

  it.each([
    '//evil.example',
    '//evil.example/login',
    '/\\evil.example',
    '\\\\evil.example',
    'https://evil.example',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    '/\t/evil.example',
    '/\n/evil.example',
    'extrato',
    '',
  ])('rejects %j', (value) => {
    expect(safeInternalPath(value)).toBe('/');
  });

  it('rejects non-strings (history state is untyped)', () => {
    expect(safeInternalPath(undefined)).toBe('/');
    expect(safeInternalPath({ pathname: '//evil.example' })).toBe('/');
    expect(safeInternalPath(42, '/login')).toBe('/login');
  });
});

describe('resolveCheckoutUrl', () => {
  const app = 'https://app.effinance.com.br/configuracoes?aba=assinatura';

  it('sends the browser to Mercado Pago over https only', () => {
    expect(resolveCheckoutUrl('https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id=2c93', app)).toEqual({
      kind: 'external',
      href: 'https://www.mercadopago.com.br/subscriptions/checkout?preapproval_id=2c93',
    });
    expect(resolveCheckoutUrl('https://sandbox.mercadopago.com.br/x', app)?.kind).toBe('external');
    expect(resolveCheckoutUrl('http://www.mercadopago.com.br/x', app)).toBeNull();
    expect(resolveCheckoutUrl('https://www.mercadopago.com.br:8443/x', app)).toBeNull();
    expect(resolveCheckoutUrl('https://user:pw@www.mercadopago.com.br/x', app)).toBeNull();
  });

  it.each([
    'javascript:alert(document.cookie)',
    'JaVaScRiPt:alert(1)',
    'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
    'https://evil.example/checkout',
    'https://mercadopago.com.br.evil.example/x',
    'https://evilmercadopago.com.br/x',
    '//evil.example/x',
    'https://evil.example/#/configuracoes',
    'blob:https://app.effinance.com.br/uuid',
  ])('refuses %j', (raw) => {
    expect(resolveCheckoutUrl(raw, app)).toBeNull();
  });

  it('keeps same-origin screens inside the router (browser and hash router)', () => {
    expect(resolveCheckoutUrl('https://app.effinance.com.br/configuracoes?aba=assinatura&simular=individual_monthly', app)).toEqual({
      kind: 'internal',
      path: '/configuracoes?aba=assinatura&simular=individual_monthly',
    });
    expect(
      resolveCheckoutUrl('https://demo.host.example/effinance/#/configuracoes?aba=assinatura&simular=family_yearly', 'https://demo.host.example/effinance/#/configuracoes'),
    ).toEqual({ kind: 'internal', path: '/configuracoes?aba=assinatura&simular=family_yearly' });
  });

  it('routes the fake provider return internally even from another dev origin', () => {
    expect(resolveCheckoutUrl('http://localhost:5173/configuracoes?aba=assinatura&simular=individual_monthly', 'http://127.0.0.1:5173/configuracoes')).toEqual({
      kind: 'internal',
      path: '/configuracoes?aba=assinatura&simular=individual_monthly',
    });
    // Other routes of another origin are not "internal".
    expect(resolveCheckoutUrl('http://localhost:5173/extrato', 'http://127.0.0.1:5173/configuracoes')).toBeNull();
  });

  it('refuses non-strings and oversized values', () => {
    expect(resolveCheckoutUrl(undefined, app)).toBeNull();
    expect(resolveCheckoutUrl({ href: 'https://www.mercadopago.com.br' }, app)).toBeNull();
    expect(resolveCheckoutUrl(`https://www.mercadopago.com.br/${'a'.repeat(3000)}`, app)).toBeNull();
  });
});

describe('isSafeApiPath (client-side path traversal)', () => {
  it('accepts regular API paths', () => {
    expect(isSafeApiPath('/credit-cards/8c0b6c1e-0d5e-4a7c-9a51-0b2b8c7a1e11/invoices/2026-10')).toBe(true);
    expect(isSafeApiPath('/invites/' + encodeURIComponent('abc_DEF-123'))).toBe(true);
    expect(isSafeApiPath('/auth/me')).toBe(true);
  });

  it.each([
    '/credit-cards/1/invoices/../../../billing/cancel',
    '/credit-cards/1/invoices/..%2F..%2Fbilling%2Fcancel',
    '/contacts/%2e%2e/auth/sessions',
    '/contacts/.%2E',
    '/contacts/./x',
    '/credit-cards/1/invoices/2026-10?x=/pay',
    '/credit-cards/1/invoices/2026-10#/pay',
    '/contacts/..\\auth',
    '//evil.example/x',
    'auth/me',
    '/contacts/%E0%A4%A',
  ])('rejects %j', (path) => {
    expect(isSafeApiPath(path)).toBe(false);
  });
});

describe('isUuid', () => {
  it('accepts UUIDs only', () => {
    expect(isUuid('8c0b6c1e-0d5e-4a7c-9a51-0b2b8c7a1e11')).toBe(true);
    expect(isUuid('../auth/sessions')).toBe(false);
    expect(isUuid(null)).toBe(false);
  });
});
