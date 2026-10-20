// URL hygiene for navigation sinks (post-login redirects, payment checkout) and API paths.

/** Payment provider hosts the app may send the browser to (exact host or any subdomain). */
export const CHECKOUT_HOSTS = ['mercadopago.com.br', 'mercadopago.com'] as const;

const PROBE_ORIGIN = 'https://effinance.invalid';
// C0 controls, DEL and backslashes: browsers strip/normalize them, which hides `//host` tricks.
const UNSAFE_CHARS = /[\u0000-\u001f\u007f\\]/;

/**
 * Returns `value` when it is an in-app path (`/extrato?conta=1`), otherwise `fallback`. Rejects
 * absolute and protocol-relative URLs (`https://x`, `//x`, `/\x`), so the value can be handed to
 * `navigate()` after login without leaving the app.
 */
export function safeInternalPath(value: unknown, fallback = '/'): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return fallback;
  if (UNSAFE_CHARS.test(value)) return fallback;
  try {
    const url = new URL(value, PROBE_ORIGIN);
    if (url.origin !== PROBE_ORIGIN || url.pathname.startsWith('//')) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

function isCheckoutHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return CHECKOUT_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

export type CheckoutTarget = { kind: 'internal'; path: string } | { kind: 'external'; href: string };

/**
 * Where to send the browser for a `checkoutUrl` returned by the API. Only two shapes are accepted:
 * an https page of the payment provider (allowlist) or a screen of this app. The fake provider used
 * in development and in the demo returns `<app>/configuracoes?aba=assinatura&simular=<plan>` (or
 * `<app>/#/configuracoes?...` with the hash router); that route is kept inside the router even when
 * the API's APP_URL differs from the current origin (dev runs on both localhost and 127.0.0.1) —
 * an in-app route never leaves the app. Anything else (`javascript:`, other hosts, http) is null.
 */
export function resolveCheckoutUrl(raw: unknown, currentHref: string): CheckoutTarget | null {
  if (typeof raw !== 'string' || raw.length > 2048 || UNSAFE_CHARS.test(raw)) return null;
  let url: URL;
  let current: URL;
  try {
    current = new URL(currentHref);
    url = new URL(raw, current);
  } catch {
    return null;
  }
  if (url.username || url.password || (url.protocol !== 'https:' && url.protocol !== 'http:')) return null;

  // Hash-routed build (demo): the route lives after `#`.
  const route = url.hash.startsWith('#/') ? url.hash.slice(1) : `${url.pathname}${url.search}`;
  const path = safeInternalPath(route, '');
  if (path && url.origin === current.origin) return { kind: 'internal', path };
  if (path && /^\/configuracoes\?(?:[^#]*&)?simular=/.test(path)) return { kind: 'internal', path };

  if (url.protocol === 'https:' && !url.port && isCheckoutHost(url.hostname)) {
    return { kind: 'external', href: url.toString() };
  }
  return null;
}

/**
 * API paths are built by interpolating ids that sometimes come from the URL (`?fatura=`, `?editar=`).
 * A value like `../../billing/cancel` would be normalized by `fetch` into another endpoint (client-side
 * path traversal), so dot segments, `?`, `#`, backslashes and control characters are refused.
 */
export function isSafeApiPath(path: string): boolean {
  if (!path.startsWith('/') || path.startsWith('//')) return false;
  if (/[?#\\\u0000-\u001f\u007f]/.test(path)) return false;
  return path.split('/').every((segment) => {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return false;
    }
    return decoded !== '.' && decoded !== '..' && !/[/\\?#]/.test(decoded);
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}
