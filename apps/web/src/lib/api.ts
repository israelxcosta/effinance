import type { ApiError } from '@effinance/shared';
import { isSafeApiPath } from './safe-url';

/**
 * In the demo build requests are answered in-browser (PGlite) instead of going to the network.
 * The env check is inlined (not IS_DEMO) so regular builds drop the demo chunk entirely.
 */
const transport = (input: string, init: RequestInit): Promise<Response> =>
  import.meta.env.VITE_DEMO === 'true'
    ? import('@/demo/fetch').then((m) => m.demoFetch(input, init))
    : fetch(input, init);

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, body: Partial<ApiError> | null) {
    super(body?.message ?? defaultMessage(status));
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = body?.error ?? 'request_failed';
    this.details = body?.details;
  }

  /** Field errors when the API returns zod-like issues in `details`. */
  fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    const details = this.details as unknown;
    const issues = Array.isArray(details)
      ? details
      : details && typeof details === 'object' && Array.isArray((details as { issues?: unknown }).issues)
        ? (details as { issues: unknown[] }).issues
        : [];
    for (const issue of issues as { path?: (string | number)[]; message?: string }[]) {
      const key = issue.path?.join('.');
      if (key && issue.message && !out[key]) out[key] = issue.message;
    }
    return out;
  }
}

function defaultMessage(status: number): string {
  if (status === 0) return 'Não foi possível conectar ao servidor.';
  if (status === 401) return 'Sua sessão expirou. Entre novamente.';
  if (status === 402) return 'Assinatura inativa: o espaço está em modo somente leitura.';
  if (status === 403) return 'Você não tem permissão para esta ação.';
  if (status === 404) return 'Registro não encontrado.';
  if (status === 429) return 'Muitas tentativas. Aguarde um instante.';
  if (status >= 500) return 'Erro no servidor. Tente novamente em instantes.';
  return 'Não foi possível concluir a operação.';
}

type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, QueryValue>;
  signal?: AbortSignal;
}

let bearerToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;
let expectedWorkspace: string | null = null;

/** Errors the app reacts to globally (toast + navigation), whatever screen made the request. */
export type AccessErrorKind = 'subscription_required' | 'forbidden' | 'workspace_mismatch';
let accessErrorHandler: ((kind: AccessErrorKind, error: ApiRequestError) => void) | null = null;

/**
 * Kept in memory only — the httpOnly cookies are the primary session mechanism. Dropped whenever the
 * server rotates the session (refresh, workspace switch), since it would carry stale claims.
 */
export function setBearerToken(token: string | null): void {
  bearerToken = token;
}

/**
 * Workspace this tab is showing. Sent as `X-Workspace-Id` so the API refuses (409
 * `workspace_mismatch`) a write meant for it after another tab switched the shared session.
 */
export function setExpectedWorkspace(id: string | null): void {
  expectedWorkspace = id;
}

/** Called when the session cannot be renewed (refresh token missing, expired or revoked). */
export function onUnauthorized(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

export function onAccessError(handler: ((kind: AccessErrorKind, error: ApiRequestError) => void) | null): void {
  accessErrorHandler = handler;
}

/** Requests that must not trigger a session refresh on 401 (credentials are being checked). */
const NO_REFRESH = new Set([
  '/auth/login',
  '/auth/register',
  '/auth/mfa/verify',
  '/auth/refresh',
  '/auth/logout',
  '/auth/password/forgot',
  '/auth/password/reset',
]);

let refreshing: Promise<boolean> | null = null;

/**
 * Renews the 15-minute access token with the refresh cookie. Single-flight: concurrent 401s share
 * one call, since the refresh token rotates on every use (a second call would look like reuse).
 */
export function refreshSession(): Promise<boolean> {
  refreshing ??= transport('/api/auth/refresh', {
    method: 'POST',
    headers: { Accept: 'application/json' },
    credentials: 'include',
  })
    .then((res) => {
      if (res.ok) bearerToken = null;
      // Only the status matters; release the (error) body instead of leaving the response open.
      void res.body?.cancel().catch(() => {});
      return res.ok;
    })
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export function buildQuery(query?: Record<string, QueryValue>): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

async function send(path: string, options: RequestOptions): Promise<Response> {
  const { method = 'GET', body, query, signal } = options;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;
  if (expectedWorkspace) headers['X-Workspace-Id'] = expectedWorkspace;
  try {
    return await transport(`/api${path}${buildQuery(query)}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'include',
      signal,
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new ApiRequestError(0, null);
  }
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  // Ids interpolated from the URL must not turn into another endpoint (`../../billing/cancel`).
  if (!isSafeApiPath(path)) {
    throw new ApiRequestError(400, { error: 'invalid_path', message: 'Endereço inválido.' });
  }
  let response = await send(path, options);

  // Expired access token: renew once and replay. If the replay still gets 401 the session is valid
  // and the request itself was refused (e.g. wrong current password), so it surfaces as an error.
  if (response.status === 401 && !NO_REFRESH.has(path)) {
    if (await refreshSession()) {
      // The replay replaces this 401: release its body instead of leaving the response open.
      void response.body?.cancel().catch(() => {});
      response = await send(path, options);
    } else unauthorizedHandler?.();
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const error = new ApiRequestError(response.status, data as Partial<ApiError> | null);
    if (response.status === 402 || error.code === 'subscription_required') accessErrorHandler?.('subscription_required', error);
    else if (response.status === 403) accessErrorHandler?.('forbidden', error);
    else if (error.code === 'workspace_mismatch') accessErrorHandler?.('workspace_mismatch', error);
    throw error;
  }

  return data as T;
}

/** Errors already explained by the global access toast (no need for a second one). */
export function isAccessError(error: unknown): boolean {
  return (
    error instanceof ApiRequestError && (error.status === 402 || error.status === 403 || error.code === 'workspace_mismatch')
  );
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Algo deu errado.';
}
