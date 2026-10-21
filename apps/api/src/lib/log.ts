// Log hygiene (LGPD): request lines and errors must not carry personal data or secrets.
// - URLs: only known, non-personal query parameters keep their values (`/search?q=<CPF>` does not),
//   and invite tokens and webhook secrets in paths are masked.
// - Errors: Drizzle puts every bound parameter of a failed query in the message (`params: …`), and
//   Postgres errors quote offending values in `message`/`detail` (e-mails, names, documents…).

const SAFE_QUERY_KEYS = new Set([
  'page',
  'pageSize',
  'from',
  'to',
  'aFrom',
  'aTo',
  'bFrom',
  'bTo',
  'month',
  'type',
  'status',
  'granularity',
  'scope',
  'sort',
  'kind',
  'includeArchived',
  'includePending',
  'accountId',
  'creditCardId',
  'categoryId',
  'contactId',
  'recurrenceKind',
  'topic',
  'data.id',
]);

/** Path and query safe to log. */
export function sanitizeUrl(url: string | undefined): string | undefined {
  if (!url) return url;
  const q = url.indexOf('?');
  const path = (q < 0 ? url : url.slice(0, q))
    .replace(/(\/invites\/)[^/?]+/, '$1[token]')
    // Open Finance webhooks authenticate with a secret path segment.
    .replace(/(\/open-finance\/webhooks\/[^/?]+\/)[^/?]+/, '$1[secret]');
  if (q < 0) return path;
  const params = new URLSearchParams(url.slice(q + 1));
  const safe = [...params].map(([k, v]) => `${encodeURIComponent(k)}=${SAFE_QUERY_KEYS.has(k) ? encodeURIComponent(v) : '[redacted]'}`);
  return `${path}?${safe.join('&')}`;
}

function scrubText(text: string | undefined): string | undefined {
  if (!text) return text;
  return (
    text
      // Drizzle: "Failed query: <sql>\nparams: v1,v2…" (then the stack frames).
      .replace(/\nparams: [\s\S]*?(?=\n {4}at |$)/, '\nparams: [redacted]')
      // Postgres: values quoted in messages, e.g. `invalid input syntax for type uuid: "…"`.
      .replace(/: "[^"\n]*"/g, ': "[redacted]"')
      // Provider errors may name the recipient (e.g. SES "identities failed the check: a@b.com").
      .replace(/[\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63}){1,8}/g, '[email]')
      // CPF / CNPJ written as bare digits.
      .replace(/\b(?:\d{11}|\d{14})\b/g, '[document]')
  );
}

interface ErrorLike {
  name?: string;
  message?: string;
  stack?: string;
  code?: unknown;
  statusCode?: unknown;
  constraint_name?: unknown;
  table_name?: unknown;
  column_name?: unknown;
  cause?: unknown;
}

export interface SerializedError {
  type: string;
  message: string;
  stack: string;
  [key: string]: unknown;
}

/** pino `err` serializer: type, scrubbed message/stack, codes and constraint names (no values). */
export function serializeError(error: unknown, depth = 0): SerializedError {
  if (!error || typeof error !== 'object') {
    return { type: typeof error, message: scrubText(String(error)) ?? '', stack: '' };
  }
  const e = error as ErrorLike;
  const out: SerializedError = {
    type: e.name ?? 'Error',
    message: scrubText(e.message) ?? '',
    stack: scrubText(e.stack) ?? '',
  };
  for (const key of ['code', 'statusCode', 'constraint_name', 'table_name', 'column_name'] as const) {
    if (e[key] !== undefined) out[key] = e[key];
  }
  if (e.cause && depth < 3) out.cause = serializeError(e.cause, depth + 1);
  return out;
}

/** pino `req` serializer (Fastify's default fields, with a sanitized URL and no headers). */
export function serializeRequest(req: {
  method?: string;
  url?: string;
  hostname?: string;
  ip?: string;
  socket?: { remotePort?: number };
}) {
  return {
    method: req.method,
    url: sanitizeUrl(req.url),
    host: req.hostname,
    remoteAddress: req.ip,
    remotePort: req.socket?.remotePort,
  };
}
