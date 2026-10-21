// Pluggy (https://pluggy.ai) over plain fetch — no SDK dependency, works in any runtime with fetch and
// WebCrypto. Endpoints and fields as in the official pluggy-sdk 0.92.0 (dist/client.js, baseApi.js,
// types/*.d.ts):
//   POST /auth {clientId, clientSecret, nonExpiring:false} → {apiKey} (JWT, ~2 h), header X-API-KEY;
//   POST /connect_token {itemId?, options:{clientUserId, webhookUrl, avoidDuplicates}} → {accessToken};
//   GET/DELETE /items/:id; GET /accounts?itemId= (page response);
//   GET /v2/transactions?accountId&dateFrom&dateTo&after (cursor: {results, next});
//   GET /bills?accountId&page (page response).
// Direction comes from `type` (DEBIT = money out of the account; on a credit card account that is a
// purchase, CREDIT a payment/refund) — never from the sign of `amount`, whose convention differs
// between account types. Foreign-currency card purchases use `amountInAccountCurrency`.

import type { BankConnectionStatus, ISODate } from '@effinance/shared';
import {
  ProviderError,
  safeImageUrl,
  type ConnectTokenRequest,
  type OpenFinanceProvider,
  type ProviderAccount,
  type ProviderBill,
  type ProviderItem,
  type ProviderTransaction,
} from './types';

export const PLUGGY_API = 'https://api.pluggy.ai';
/** Connect tokens are valid for 30 minutes. */
const CONNECT_TOKEN_TTL_MS = 30 * 60_000;
/** Renew the API key this long before it expires. */
const KEY_MARGIN_MS = 60_000;
/** When the key's expiry cannot be read (keys last 2 hours). */
const DEFAULT_KEY_TTL_MS = 100 * 60_000;
const MAX_PAGES = 200;

interface PluggyConnector {
  name?: string;
  imageUrl?: string;
  isOpenFinance?: boolean;
  isSandbox?: boolean;
}
interface PluggyItem {
  id: string;
  status?: string;
  clientUserId?: string | null;
  connector?: PluggyConnector;
  consentExpiresAt?: string | null;
  lastUpdatedAt?: string | null;
}
interface PluggyAccount {
  id: string;
  type?: 'BANK' | 'CREDIT';
  subtype?: string;
  name?: string;
  marketingName?: string | null;
  number?: string | null;
  balance?: number | null;
  creditData?: {
    brand?: string | null;
    creditLimit?: number | null;
    balanceCloseDate?: string | null;
    balanceDueDate?: string | null;
  } | null;
}
interface PluggyTransaction {
  id: string;
  date: string;
  description?: string | null;
  type?: 'DEBIT' | 'CREDIT';
  amount: number;
  amountInAccountCurrency?: number | null;
  status?: 'PENDING' | 'POSTED';
  creditCardMetadata?: { billId?: string | null } | null;
}
interface PluggyBill {
  id: string;
  dueDate: string;
}
interface Page<T> {
  results: T[];
  page?: number;
  totalPages?: number;
}
interface CursorPage<T> {
  results: T[];
  next: string | null;
}

const STATUS: Record<string, BankConnectionStatus> = {
  UPDATED: 'active',
  UPDATING: 'syncing',
  MERGING: 'syncing',
  LOGIN_ERROR: 'login_error',
  WAITING_USER_INPUT: 'waiting_user_input',
  WAITING_USER_ACTION: 'waiting_user_input',
  OUTDATED: 'outdated',
};

const cents = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 100) : null;

/**
 * Calendar date of a Pluggy timestamp. Date-only values come as midnight UTC ("…T00:00:00.000Z");
 * real timestamps are converted to Brasília time (UTC−3, no daylight saving since 2019).
 */
export function pluggyDate(value: string): ISODate {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value) || /T00:00:00(\.0+)?(Z|\+00:00)$/.test(value)) return value.slice(0, 10);
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new ProviderError('Pluggy: data inválida em transação');
  return new Date(ms - 3 * 3_600_000).toISOString().slice(0, 10);
}

function dayOf(value: string | null | undefined): number | null {
  if (!value) return null;
  const day = Number(value.slice(8, 10));
  return day >= 1 && day <= 31 ? day : null;
}

/** `exp` (ms) of a JWT, read without verifying (it is our own key, only used to schedule renewal). */
function jwtExpiry(token: string): number | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: unknown };
    return typeof json.exp === 'number' ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

export interface PluggyOptions {
  clientId: string;
  clientSecret: string;
  /** Accept Pluggy's sandbox connectors (never in production). */
  sandbox?: boolean;
  baseUrl?: string;
  /** Injected in tests. */
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

export class PluggyProvider implements OpenFinanceProvider {
  readonly name = 'pluggy' as const;
  readonly sandbox: boolean;
  private apiKey: { value: string; renewAt: number } | null = null;
  private pendingKey: Promise<string> | null = null;

  constructor(private readonly options: PluggyOptions) {
    this.sandbox = options.sandbox ?? false;
  }

  private now() {
    return this.options.now?.() ?? Date.now();
  }

  private async send(method: string, path: string, init: { query?: Record<string, string | number | undefined>; body?: unknown; apiKey?: string }) {
    const base = (this.options.baseUrl ?? PLUGGY_API).replace(/\/+$/, '');
    const query = Object.entries(init.query ?? {})
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    const doFetch = this.options.fetch ?? fetch;
    try {
      return await doFetch(`${base}${path}${query ? `?${query}` : ''}`, {
        method,
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          ...(init.apiKey ? { 'X-API-KEY': init.apiKey } : {}),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 20_000),
      });
    } catch {
      throw new ProviderError(`Pluggy ${method} indisponível`);
    }
  }

  /** API key, cached until shortly before it expires; concurrent callers share one /auth call. */
  private async key(): Promise<string> {
    if (this.apiKey && this.apiKey.renewAt > this.now()) return this.apiKey.value;
    this.pendingKey ??= (async () => {
      try {
        const res = await this.send('POST', '/auth', {
          body: { clientId: this.options.clientId, clientSecret: this.options.clientSecret, nonExpiring: false },
        });
        // Never include the response body: a failed /auth echoes nothing useful and logs must stay clean.
        if (!res.ok) throw new ProviderError(`Pluggy /auth respondeu ${res.status}`, res.status);
        const { apiKey } = (await res.json()) as { apiKey?: string };
        if (!apiKey) throw new ProviderError('Pluggy /auth sem apiKey');
        const expiry = jwtExpiry(apiKey) ?? this.now() + DEFAULT_KEY_TTL_MS;
        this.apiKey = { value: apiKey, renewAt: expiry - KEY_MARGIN_MS };
        return apiKey;
      } finally {
        this.pendingKey = null;
      }
    })();
    return this.pendingKey;
  }

  /** Authenticated call; a 401 (key revoked/expired early) renews the key once. `label` keeps ids out of errors. */
  private async request<T>(
    method: string,
    path: string,
    label: string,
    init: { query?: Record<string, string | number | undefined>; body?: unknown } = {},
    allowNotFound = false,
  ): Promise<T | null> {
    let res = await this.send(method, path, { ...init, apiKey: await this.key() });
    if (res.status === 401) {
      this.apiKey = null;
      res = await this.send(method, path, { ...init, apiKey: await this.key() });
    }
    if (allowNotFound && res.status === 404) return null;
    if (!res.ok) throw new ProviderError(`Pluggy ${method} ${label} respondeu ${res.status}`, res.status);
    if (res.status === 204) return null;
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T | null;
  }

  async createConnectToken(req: ConnectTokenRequest) {
    const out = await this.request<{ accessToken?: string }>('POST', '/connect_token', 'connect_token', {
      body: {
        ...(req.itemId ? { itemId: req.itemId } : {}),
        options: {
          clientUserId: req.clientUserId,
          ...(req.webhookUrl ? { webhookUrl: req.webhookUrl } : {}),
          avoidDuplicates: true,
        },
      },
    });
    if (!out?.accessToken) throw new ProviderError('Pluggy connect_token sem accessToken');
    return { accessToken: out.accessToken, expiresAt: new Date(this.now() + CONNECT_TOKEN_TTL_MS) };
  }

  async getItem(itemId: string): Promise<ProviderItem | null> {
    const item = await this.request<PluggyItem>('GET', `/items/${encodeURIComponent(itemId)}`, 'items/:id', {}, true);
    if (!item) return null;
    return {
      id: item.id,
      clientUserId: item.clientUserId ?? null,
      status: STATUS[item.status ?? ''] ?? 'error',
      connector: {
        name: String(item.connector?.name ?? 'Instituição').slice(0, 80),
        imageUrl: safeImageUrl(item.connector?.imageUrl),
        isOpenFinance: item.connector?.isOpenFinance === true,
        isSandbox: item.connector?.isSandbox === true,
      },
      consentExpiresAt: item.consentExpiresAt ? new Date(item.consentExpiresAt) : null,
      lastUpdatedAt: item.lastUpdatedAt ? new Date(item.lastUpdatedAt) : null,
    };
  }

  async deleteItem(itemId: string): Promise<void> {
    await this.request('DELETE', `/items/${encodeURIComponent(itemId)}`, 'items/:id', {}, true);
  }

  async listAccounts(itemId: string): Promise<ProviderAccount[]> {
    const out: ProviderAccount[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await this.request<Page<PluggyAccount>>('GET', '/accounts', 'accounts', { query: { itemId, page } });
      for (const a of res?.results ?? []) {
        const credit = a.type === 'CREDIT';
        out.push({
          id: a.id,
          kind: credit ? 'credit_card' : 'bank',
          accountType: credit ? null : a.subtype === 'SAVINGS_ACCOUNT' ? 'savings' : 'checking',
          name: String(a.marketingName || a.name || (credit ? 'Cartão de crédito' : 'Conta')).slice(0, 60),
          number: a.number ?? null,
          balance: cents(a.balance),
          creditLimit: credit ? cents(a.creditData?.creditLimit) : null,
          brand: credit ? (a.creditData?.brand ?? null) : null,
          closingDay: credit ? dayOf(a.creditData?.balanceCloseDate) : null,
          dueDay: credit ? dayOf(a.creditData?.balanceDueDate) : null,
        });
      }
      if (!res?.totalPages || page >= res.totalPages) break;
    }
    return out;
  }

  async listTransactions(accountId: string, range: { from: ISODate; to: ISODate }): Promise<ProviderTransaction[]> {
    const out: ProviderTransaction[] = [];
    let after: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await this.request<CursorPage<PluggyTransaction>>('GET', '/v2/transactions', 'v2/transactions', {
        query: { accountId, dateFrom: range.from, dateTo: range.to, after },
      });
      for (const t of res?.results ?? []) {
        const value = t.amountInAccountCurrency ?? t.amount;
        const direction = t.type === 'CREDIT' ? 'in' : t.type === 'DEBIT' ? 'out' : value < 0 ? 'out' : 'in';
        out.push({
          id: t.id,
          date: pluggyDate(t.date),
          description: String(t.description ?? '').trim() || 'Lançamento sem descrição',
          amount: Math.abs(cents(value) ?? 0),
          direction,
          pending: t.status === 'PENDING',
          billId: t.creditCardMetadata?.billId ?? null,
        });
      }
      const next = res?.next ? new URL(res.next, this.options.baseUrl ?? PLUGGY_API).searchParams.get('after') : null;
      if (!next) break;
      after = next;
    }
    return out;
  }

  async listBills(accountId: string): Promise<ProviderBill[]> {
    const out: ProviderBill[] = [];
    for (let page = 1; page <= 20; page++) {
      const res = await this.request<Page<PluggyBill>>('GET', '/bills', 'bills', { query: { accountId, page } });
      for (const b of res?.results ?? []) out.push({ id: b.id, dueDate: pluggyDate(b.dueDate) });
      if (!res?.totalPages || page >= res.totalPages) break;
    }
    return out;
  }
}
