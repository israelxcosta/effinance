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
    if (e.NODE_ENV === 'production') {
      // Fail closed: development defaults must never reach production (docs/deploy-aws.md).
      if (/change-?me|example|placeholder|secret-of-32/i.test(e.JWT_SECRET)) {
        issue('JWT_SECRET', 'looks like the .env.example placeholder: generate a random secret (openssl rand -base64 48)');
      }
      if (e.MAILER !== 'ses' && e.MAILER !== 'webhook') {
        issue('MAILER', 'must be "ses" or "webhook" in production (the console mailer writes reset/invite links to the logs)');
      }
      if (e.MAILER === 'webhook' && e.MAIL_WEBHOOK_URL && !e.MAIL_WEBHOOK_URL.startsWith('https://')) {
        issue('MAIL_WEBHOOK_URL', 'must use https in production');
      }
      if (e.DATABASE_SSL !== 'verify-full') {
        issue('DATABASE_SSL', 'must be verify-full in production (TLS with certificate and host verification)');
      }
      if (!e.APP_URL.startsWith('https://')) issue('APP_URL', 'must be an https URL in production');
      if (e.CORS_ORIGIN.length === 0 || e.CORS_ORIGIN.some((o) => !o.startsWith('https://'))) {
        issue('CORS_ORIGIN', 'must list only https origins in production');
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return parsed.data;
}

export const env = loadEnv();
