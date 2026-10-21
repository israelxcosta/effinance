import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiRequestError, onUnauthorized, setBearerToken } from './api';

const json = (status: number, body: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('api client', () => {
  const fetchMock = vi.fn<(input: string, init: RequestInit) => Promise<Response>>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    setBearerToken(null);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    onUnauthorized(null);
  });

  it('refuses paths that would resolve to another endpoint (client-side path traversal)', async () => {
    // e.g. /cartoes/:id?fatura=../../../billing/cancel
    for (const path of ['/credit-cards/1/invoices/../../../billing/cancel', '/contacts/%2e%2e/auth/sessions', '/x?y=1']) {
      await expect(api(path)).rejects.toMatchObject({ status: 400, code: 'invalid_path' });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes once for concurrent 401s and replays (single-flight)', async () => {
    let refreshed = false;
    fetchMock.mockImplementation(async (input) => {
      if (input === '/api/auth/refresh') {
        refreshed = true;
        return json(200, { token: 'new' });
      }
      return refreshed ? json(200, { ok: true }) : json(401, { error: 'unauthorized', message: 'expirado' });
    });
    const results = await Promise.all([api('/accounts'), api('/goals'), api('/contacts')]);
    expect(results).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/auth/refresh')).toHaveLength(1);
  });

  it('does not loop when the refresh is refused: one attempt, then the session ends', async () => {
    const ended = vi.fn();
    onUnauthorized(ended);
    fetchMock.mockImplementation(async (input) =>
      input === '/api/auth/refresh' ? json(401, { error: 'unauthorized' }) : json(401, { error: 'unauthorized' }),
    );
    await expect(api('/accounts')).rejects.toBeInstanceOf(ApiRequestError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it('a replay that still gets 401 surfaces as an error without a second refresh', async () => {
    fetchMock.mockImplementation(async (input) =>
      input === '/api/auth/refresh' ? json(204, undefined) : json(401, { error: 'unauthorized', message: 'Senha atual incorreta' }),
    );
    await expect(api('/auth/password', { method: 'POST', body: {} })).rejects.toMatchObject({ status: 401 });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/auth/password', '/api/auth/refresh', '/api/auth/password']);
  });

  it('never sends credentials-checking routes to refresh', async () => {
    fetchMock.mockResolvedValue(json(401, { error: 'unauthorized', message: 'E-mail ou senha inválidos' }));
    await expect(api('/auth/login', { method: 'POST', body: {} })).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
