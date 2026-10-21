import { z } from 'zod';

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3333),
    HOST: z.string().default('0.0.0.0'),
    /** Proxy hops whose X-Forwarded-For is trusted (1 = the load balancer in front of the API). */
    TRUST_PROXY: z.coerce.number().int().min(0).default(1),
    DATABASE_URL: z.url(),
    /** `verify-full` (production on RDS): TLS with certificate and host verification. */
    DATABASE_SSL: z.enum(['disable', 'require', 'verify-full']).default('disable'),
    /** PEM bundle used with verify-full (e.g. the RDS global CA bundle). */
    DATABASE_CA_FILE: optional,
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must have at least 32 characters'),
    CORS_ORIGIN: z
      .string()
      .default('http://localhost:5173')
      .transform((v) =>
        v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    /** Public URL of the web app (links in e-mails and checkout return). */
    APP_URL: z
      .string()
      .default('http://localhost:5173')
      .transform((v) => v.replace(/\/+$/, '')),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

    KEY_PROVIDER: z.enum(['local', 'aws']).default('local'),
    /** base64 of 32 random bytes (KEY_PROVIDER=local). */
    ENCRYPTION_MASTER_KEY: optional,
    KMS_KEY_ID: optional,
    AWS_REGION: optional,

    MAILER: z.enum(['console', 'memory', 'webhook', 'ses']).optional(),
    MAIL_FROM: z.string().default('Effinance <nao-responda@effinance.app>'),
    MAIL_WEBHOOK_URL: optional,
    MAIL_WEBHOOK_SECRET: optional,

    BILLING_PROVIDER: z.enum(['fake', 'mercadopago']).default('fake'),
    MP_ACCESS_TOKEN: optional,
    MP_WEBHOOK_SECRET: optional,

    /**
     * Read-only bank connections (Open Finance Brasil). fake = simulated institutions (development,
     * tests, demo); pluggy = aggregator (production); disabled = feature hidden. Default: fake outside
     * production, disabled in production.
     */
    OPEN_FINANCE_PROVIDER: z.enum(['fake', 'pluggy', 'disabled']).optional(),
    PLUGGY_CLIENT_ID: optional,
    PLUGGY_CLIENT_SECRET: optional,
    /** Accept Pluggy sandbox connectors (non-Open-Finance test banks). Never in production. */
    PLUGGY_SANDBOX: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    /** Secret path segment of the webhook URL (URL-safe, 32+ characters; 43+ in production). */
    OPEN_FINANCE_WEBHOOK_SECRET: optional,
    /** Public base URL of this API (webhook URL given to the aggregator), e.g. https://api.effinance.com.br. */
    API_PUBLIC_URL: optional.transform((v) => v?.replace(/\/+$/, '')),

    /** Shared rate-limit store for multiple API instances. */
    REDIS_URL: optional,
  })
  .superRefine((e, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
    if (e.KEY_PROVIDER === 'aws' && !e.KMS_KEY_ID) issue('KMS_KEY_ID', 'required when KEY_PROVIDER=aws');
    if (e.KEY_PROVIDER === 'local' && e.NODE_ENV === 'production' && !e.ENCRYPTION_MASTER_KEY) {
      issue('ENCRYPTION_MASTER_KEY', 'required in production when KEY_PROVIDER=local');
    }
    if (e.BILLING_PROVIDER === 'mercadopago' && (!e.MP_ACCESS_TOKEN || !e.MP_WEBHOOK_SECRET)) {
      issue('MP_ACCESS_TOKEN', 'MP_ACCESS_TOKEN and MP_WEBHOOK_SECRET are required with BILLING_PROVIDER=mercadopago');
    }
    if (e.NODE_ENV === 'production' && e.BILLING_PROVIDER === 'fake') {
      issue('BILLING_PROVIDER', 'the fake provider is not allowed in production');
    }
    if (e.MAILER === 'webhook' && !e.MAIL_WEBHOOK_URL) issue('MAIL_WEBHOOK_URL', 'required when MAILER=webhook');
    if (e.DATABASE_SSL === 'verify-full' && !e.DATABASE_CA_FILE) {
      issue('DATABASE_CA_FILE', 'required when DATABASE_SSL=verify-full');
    }
    const openFinance = openFinanceProviderOf(e);
    if (openFinance === 'pluggy') {
      if (!e.PLUGGY_CLIENT_ID || !e.PLUGGY_CLIENT_SECRET) {
        issue('PLUGGY_CLIENT_ID', 'PLUGGY_CLIENT_ID and PLUGGY_CLIENT_SECRET are required with OPEN_FINANCE_PROVIDER=pluggy');
      }
      if (!e.OPEN_FINANCE_WEBHOOK_SECRET) issue('OPEN_FINANCE_WEBHOOK_SECRET', 'required with OPEN_FINANCE_PROVIDER=pluggy');
      if (!e.API_PUBLIC_URL) issue('API_PUBLIC_URL', 'required with OPEN_FINANCE_PROVIDER=pluggy (webhook URL)');
    }
    if (e.OPEN_FINANCE_WEBHOOK_SECRET && !/^[A-Za-z0-9_-]{32,200}$/.test(e.OPEN_FINANCE_WEBHOOK_SECRET)) {
      issue('OPEN_FINANCE_WEBHOOK_SECRET', 'must be 32–200 URL-safe characters (it is a path segment): openssl rand -base64 48 | tr "+/" "-_" | tr -d =');
    }
    if (e.API_PUBLIC_URL && !/^https?:\/\/[^/\s?#]+(\/[^\s?#]*)?$/.test(e.API_PUBLIC_URL)) {
      issue('API_PUBLIC_URL', 'must be an absolute http(s) URL without query or fragment');
    }
    if (e.NODE_ENV === 'production') {
      // Fail closed: development defaults must never reach production (docs/deploy-aws.md).
      if (e.JWT_SECRET.length < 43 || /dev-?only|change-?me|replace-?me|example|placeholder|secret-of-32/i.test(e.JWT_SECRET)) {
        issue('JWT_SECRET', 'must be a random secret of 43+ characters in production (openssl rand -base64 48), not a placeholder');
      }
      if (e.KEY_PROVIDER !== 'aws') {
        issue('KEY_PROVIDER', 'must be "aws" in production (data keys wrapped by KMS; no master key in the environment)');
      }
      if (e.MAILER !== 'ses' && e.MAILER !== 'webhook') {
        issue('MAILER', 'must be "ses" or "webhook" in production (the console mailer writes reset/invite links to the logs)');
      }
      if (e.MAILER === 'webhook' && e.MAIL_WEBHOOK_URL && !e.MAIL_WEBHOOK_URL.startsWith('https://')) {
        issue('MAIL_WEBHOOK_URL', 'must use https in production');
      }
      if (e.MAILER === 'webhook' && !e.MAIL_WEBHOOK_SECRET) {
        issue('MAIL_WEBHOOK_SECRET', 'required with MAILER=webhook in production (the endpoint must authenticate us)');
      }
      if (e.DATABASE_SSL !== 'verify-full') {
        issue('DATABASE_SSL', 'must be verify-full in production (TLS with certificate and host verification)');
      }
      if (!e.APP_URL.startsWith('https://')) issue('APP_URL', 'must be an https URL in production');
      if (e.OPEN_FINANCE_PROVIDER === 'fake') {
        issue('OPEN_FINANCE_PROVIDER', 'the fake provider is not allowed in production (use pluggy or disabled)');
      }
      if (openFinance === 'pluggy') {
        if (e.PLUGGY_SANDBOX) issue('PLUGGY_SANDBOX', 'sandbox connectors are not allowed in production');
        if (e.API_PUBLIC_URL && !e.API_PUBLIC_URL.startsWith('https://')) issue('API_PUBLIC_URL', 'must be an https URL in production');
        const secret = e.OPEN_FINANCE_WEBHOOK_SECRET ?? '';
        if (secret.length < 43 || /dev-?only|change-?me|replace-?me|example|placeholder/i.test(secret)) {
          issue('OPEN_FINANCE_WEBHOOK_SECRET', 'must be a random secret of 43+ characters in production, not a placeholder');
        }
      }
      if (e.CORS_ORIGIN.length === 0 || e.CORS_ORIGIN.some((o) => !o.startsWith('https://'))) {
        issue('CORS_ORIGIN', 'must list only https origins in production');
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

/** Effective Open Finance provider: explicit, or fake outside production and disabled in it. */
export function openFinanceProviderOf(e: Pick<Env, 'OPEN_FINANCE_PROVIDER' | 'NODE_ENV'>): 'fake' | 'pluggy' | 'disabled' {
  return e.OPEN_FINANCE_PROVIDER ?? (e.NODE_ENV === 'production' ? 'disabled' : 'fake');
}

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return parsed.data;
}

export const env = loadEnv();
