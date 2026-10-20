import type { ApiError } from '@effinance/shared';
import { IS_DEMO } from './demo';

/** In the demo build requests are answered in-browser (PGlite) instead of going to the network. */
const transport = (input: string, init: RequestInit): Promise<Response> =>
  IS_DEMO ? import('@/demo/fetch').then((m) => m.demoFetch(input, init)) : fetch(input, init);

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

/** Kept in memory only — the httpOnly cookie is the primary session mechanism. */
export function setBearerToken(token: string | null): void {
  bearerToken = token;
}

export function onUnauthorized(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
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

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, signal } = options;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;

  let response: Response;
  try {
    response = await transport(`/api${path}${buildQuery(query)}`, {
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
    const isAuthRoute = path.startsWith('/auth/login') || path.startsWith('/auth/register');
    if (response.status === 401 && !isAuthRoute) unauthorizedHandler?.();
    throw new ApiRequestError(response.status, data as Partial<ApiError> | null);
  }

  return data as T;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Algo deu errado.';
}
