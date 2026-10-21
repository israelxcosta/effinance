// PluggyProvider against a mocked fetch: REST paths and headers (as in pluggy-sdk 0.92.0), API-key
// caching and renewal, page and cursor pagination, field mapping and error hygiene.

import { describe, expect, it } from 'vitest';
import { PluggyProvider, pluggyDate } from '../src/modules/open-finance/providers/pluggy';
import { ProviderError } from '../src/modules/open-finance/providers/types';

interface Call {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body: unknown;
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

/** A JWT-shaped key expiring at `expSeconds` (only the payload is read). */
function apiKey(expSeconds: number, tag = 'k') {
  const enc = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${enc({ alg: 'HS256' })}.${enc({ exp: expSeconds, tag })}.sig`;
}

function mock(routes: (call: Call) => Response | undefined) {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const call: Call = {
      method: init?.method ?? 'GET',
      url: new URL(String(input)),
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v])),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    return routes(call) ?? json({ message: 'not mocked' }, 500);
  };
  return { calls, fetchImpl, apiCalls: () => calls.filter((c) => c.url.pathname !== '/auth') };
}

const NOW = Date.UTC(2026, 9, 20, 12);

function provider(fetchImpl: typeof fetch, now = () => NOW) {
  return new PluggyProvider({ clientId: 'client-id-123', clientSecret: 'client-secret-456', fetch: fetchImpl, now });
}

describe('PluggyProvider', () => {
  it('authenticates once, sends X-API-KEY and reuses the key until shortly before it expires', async () => {
    let clock = NOW;
    let issued = 0;
    const m = mock((c) => {
      if (c.url.pathname === '/auth') return json({ apiKey: apiKey(NOW / 1000 + 3600, `key-${++issued}`) });
      if (c.url.pathname.startsWith('/items/')) return json({ id: 'item-1', status: 'UPDATED', clientUserId: 'ws', connector: { name: 'Banco' } });
    });
    const p = provider(m.fetchImpl, () => clock);
    // Concurrent first calls share one /auth.
    await Promise.all([p.getItem('item-1'), p.getItem('item-1'), p.getItem('item-1')]);
    expect(m.calls.filter((c) => c.url.pathname === '/auth')).toHaveLength(1);
    const [auth] = m.calls;
    expect(auth).toMatchObject({ method: 'POST', url: new URL('https://api.pluggy.ai/auth') });
    expect(auth!.body).toEqual({ clientId: 'client-id-123', clientSecret: 'client-secret-456', nonExpiring: false });
    expect(auth!.headers['x-api-key']).toBeUndefined();
    for (const c of m.apiCalls()) {
      expect(c.headers['x-api-key']).toBe(apiKey(NOW / 1000 + 3600, 'key-1'));
      expect(c.headers['content-type']).toBe('application/json');
    }
    clock = NOW + 58 * 60_000; // still valid (expires in 2 min, renewed 1 min before)
    await p.getItem('item-1');
    expect(issued).toBe(1);
    clock = NOW + 59 * 60_000 + 1;
    await p.getItem('item-1');
    expect(issued).toBe(2);
    expect(m.apiCalls().at(-1)!.headers['x-api-key']).toBe(apiKey(NOW / 1000 + 3600, 'key-2'));
  });

  it('renews the key once on 401 and retries', async () => {
    let issued = 0;
    let rejectNext = true;
    const m = mock((c) => {
      if (c.url.pathname === '/auth') return json({ apiKey: `opaque-${++issued}` });
      if (rejectNext) {
        rejectNext = false;
        return json({ message: 'expired' }, 401);
      }
      return json({ results: [], page: 1, totalPages: 1 });
    });
    const p = provider(m.fetchImpl);
    expect(await p.listAccounts('item-1')).toEqual([]);
    expect(issued).toBe(2);
    expect(m.apiCalls().map((c) => c.headers['x-api-key'])).toEqual(['opaque-1', 'opaque-2']);
  });

  it('creates connect tokens with clientUserId, webhook and the item to update', async () => {
    const m = mock((c) => {
      if (c.url.pathname === '/auth') return json({ apiKey: 'k' });
      if (c.url.pathname === '/connect_token') return json({ accessToken: 'connect-abc' });
    });
    const p = provider(m.fetchImpl);
    const token = await p.createConnectToken({ clientUserId: 'ws-1', webhookUrl: 'https://api.x/api/open-finance/webhooks/pluggy/s3cr3t' });
    expect(token).toEqual({ accessToken: 'connect-abc', expiresAt: new Date(NOW + 30 * 60_000) });
    await p.createConnectToken({ clientUserId: 'ws-1', webhookUrl: null, itemId: 'item-9' });
    const [create, update] = m.apiCalls();
    expect(create).toMatchObject({ method: 'POST', url: new URL('https://api.pluggy.ai/connect_token') });
    expect(create!.body).toEqual({
      options: { clientUserId: 'ws-1', webhookUrl: 'https://api.x/api/open-finance/webhooks/pluggy/s3cr3t', avoidDuplicates: true },
    });
    expect(update!.body).toEqual({ itemId: 'item-9', options: { clientUserId: 'ws-1', avoidDuplicates: true } });
  });

  it('maps items (status, connector, consent) and treats 404 as missing', async () => {
    const m = mock((c) => {
      if (c.url.pathname === '/auth') return json({ apiKey: 'k' });
      if (c.url.pathname === '/items/item%2F1') {
        return json({
          id: 'item/1',
          status: 'LOGIN_ERROR',
          clientUserId: 'ws-1',
          consentExpiresAt: '2027-01-01T00:00:00.000Z',
          lastUpdatedAt: '2026-10-19T10:00:00.000Z',
          connector: { name: 'Itaú', imageUrl: 'https://cdn.pluggy.ai/assets/itau.png', isOpenFinance: true, isSandbox: false },
        });
      }
      if (c.url.pathname === '/items/gone') return json({ message: 'not found' }, 404);
    });
    const p = provider(m.fetchImpl);
    expect(await p.getItem('item/1')).toEqual({
      id: 'item/1',
      clientUserId: 'ws-1',
      status: 'login_error',
      connector: { name: 'Itaú', imageUrl: 'https://cdn.pluggy.ai/assets/itau.png', isOpenFinance: true, isSandbox: false },
      consentExpiresAt: new Date('2027-01-01T00:00:00.000Z'),
      lastUpdatedAt: new Date('2026-10-19T10:00:00.000Z'),
    });
    expect(await p.getItem('gone')).toBeNull();
  });

  it('pages accounts and maps bank and credit data to cents and days', async () => {
    const m = mock((c) => {
      if (c.url.pathname === '/auth') return json({ apiKey: 'k' });
      if (c.url.pathname === '/accounts') {
        const page = Number(c.url.searchParams.get('page'));
        expect(c.url.searchParams.get('itemId')).toBe('item-1');
        return page === 1
          ? json({
              page: 1,
              totalPages: 2,
              results: [{ id: 'acc-1', type: 'BANK', subtype: 'SAVINGS_ACCOUNT', name: 'Poupança', number: '0001/12345-6', balance: 1234.565 }],
            })
          : json({
              page: 2,
              totalPages: 2,
              results: [
                {
                  id: 'acc-2',
                  type: 'CREDIT',
                  subtype: 'CREDIT_CARD',
                  name: 'Mastercard Black',
                  marketingName: 'Cartão Black',
                  number: '1234',
                  balance: 987.1,
                  creditData: { brand: 'MASTERCARD', creditLimit: 15000, balanceCloseDate: '2026-11-03T00:00:00.000Z', balanceDueDate: '2026-11-10T00:00:00.000Z' },
                },
              ],
            });
      }
    });
    expect(await provider(m.fetchImpl).listAccounts('item-1')).toEqual([
      { id: 'acc-1', kind: 'bank', accountType: 'savings', name: 'Poupança', number: '0001/12345-6', balance: 123457, creditLimit: null, brand: null, closingDay: null, dueDay: null },
      { id: 'acc-2', kind: 'credit_card', accountType: null, name: 'Cartão Black', number: '1234', balance: 98710, creditLimit: 1500000, brand: 'MASTERCARD', closingDay: 3, dueDay: 10 },
    ]);
    expect(m.apiCalls().map((c) => c.url.searchParams.get('page'))).toEqual(['1', '2']);
  });

  it('follows the transactions cursor, keeps the date filter and reads direction from `type`', async () => {
    const cursor = 'eyJpZCI6IjEyMyJ9+/=';
    const m = mock((c) => {
      if (c.url.pathname === '/auth') return json({ apiKey: 'k' });
      if (c.url.pathname === '/v2/transactions') {
        const after = c.url.searchParams.get('after');
        if (!after) {
          return json({
            results: [
              { id: 't1', date: '2026-10-01T00:00:00.000Z', description: 'Compra Loja', type: 'DEBIT', amount: 12.34, status: 'POSTED', creditCardMetadata: { billId: 'bill-1' } },
              { id: 't2', date: '2026-10-02T01:30:00.000Z', description: 'Estorno', type: 'CREDIT', amount: -5, status: 'POSTED' },
            ],
            next: `/v2/transactions?accountId=acc-1&after=${encodeURIComponent(cursor)}`,
          });
        }
        expect(after).toBe(cursor);
        return json({
          results: [
            { id: 't3', date: '2026-10-03T15:00:00.000Z', description: 'Compra USD', type: 'DEBIT', amount: 10, amountInAccountCurrency: 55.5, status: 'PENDING' },
            { id: 't4', date: '2026-10-04T12:00:00.000Z', description: '  ', amount: -7.25 },
          ],
          next: null,
        });
      }
    });
    const txs = await provider(m.fetchImpl).listTransactions('acc-1', { from: '2026-09-01', to: '2026-10-20' });
    expect(txs).toEqual([
      { id: 't1', date: '2026-10-01', description: 'Compra Loja', amount: 1234, direction: 'out', pending: false, billId: 'bill-1' },
      // 01:30 UTC is still the previous day in Brasília.
      { id: 't2', date: '2026-10-01', description: 'Estorno', amount: 500, direction: 'in', pending: false, billId: null },
      { id: 't3', date: '2026-10-03', description: 'Compra USD', amount: 5550, direction: 'out', pending: true, billId: null },
      { id: 't4', date: '2026-10-04', description: 'Lançamento sem descrição', amount: 725, direction: 'out', pending: false, billId: null },
    ]);
    const [first, second] = m.apiCalls();
    for (const c of [first!, second!]) {
      expect(c.url.searchParams.get('accountId')).toBe('acc-1');
      expect(c.url.searchParams.get('dateFrom')).toBe('2026-09-01');
      expect(c.url.searchParams.get('dateTo')).toBe('2026-10-20');
    }
    // Base64 cursors are percent-encoded ("+" must not become a space).
    expect(second!.url.search).toContain(`after=${encodeURIComponent(cursor)}`);
  });

  it('pages bills, deletes items idempotently and keeps ids and secrets out of errors', async () => {
    const m = mock((c) => {
      if (c.url.pathname === '/auth') return json({ apiKey: 'k' });
      if (c.url.pathname === '/bills') {
        const page = Number(c.url.searchParams.get('page'));
        return json({ page, totalPages: 2, results: [{ id: `bill-${page}`, dueDate: `2026-${page === 1 ? '09' : '10'}-10T00:00:00.000Z` }] });
      }
      if (c.method === 'DELETE' && c.url.pathname === '/items/gone') return json({}, 404);
      if (c.method === 'DELETE' && c.url.pathname === '/items/ok') return new Response(null, { status: 204 });
      if (c.url.pathname === '/items/secret-item-id') return json({ message: 'boom' }, 500);
    });
    const p = provider(m.fetchImpl);
    expect(await p.listBills('acc-2')).toEqual([
      { id: 'bill-1', dueDate: '2026-09-10' },
      { id: 'bill-2', dueDate: '2026-10-10' },
    ]);
    await expect(p.deleteItem('gone')).resolves.toBeUndefined();
    await expect(p.deleteItem('ok')).resolves.toBeUndefined();
    const error = await p.getItem('secret-item-id').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).status).toBe(500);
    expect((error as Error).message).toBe('Pluggy GET items/:id respondeu 500');

    const badAuth = mock((c) => (c.url.pathname === '/auth' ? json({ message: 'invalid client-secret-456' }, 401) : undefined));
    const authError = (await provider(badAuth.fetchImpl).getItem('x').catch((e: unknown) => e)) as Error;
    expect(authError.message).toBe('Pluggy /auth respondeu 401');
    const offline = (await provider(async () => {
      throw new TypeError('fetch failed: connect ECONNREFUSED client-secret-456');
    })
      .getItem('x')
      .catch((e: unknown) => e)) as Error;
    expect(offline.message).toBe('Pluggy POST indisponível');
  });

  it('converts Pluggy timestamps to calendar dates', () => {
    expect(pluggyDate('2026-10-01T00:00:00.000Z')).toBe('2026-10-01');
    expect(pluggyDate('2026-10-01')).toBe('2026-10-01');
    expect(pluggyDate('2026-10-01T02:59:59.000Z')).toBe('2026-09-30');
    expect(pluggyDate('2026-10-01T03:00:00.000Z')).toBe('2026-10-01');
    expect(pluggyDate('2026-10-01T23:30:00-03:00')).toBe('2026-10-01');
    expect(() => pluggyDate('ontem')).toThrow(ProviderError);
  });
});
