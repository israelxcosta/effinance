// Builds the external services from the environment (API server, migrations, seed). The browser
// demo builds its own (src/demo/server.ts in apps/web).

import { createAwsKmsKeyProvider } from './lib/crypto/aws-kms';
import { fromBase64, sha256Hex, type Bytes } from './lib/crypto/encoding';
import { LocalKeyProvider, type KeyProvider } from './lib/crypto/key-provider';
import { ConsoleMailer, MemoryMailer, WebhookMailer, type Mailer } from './lib/mailer';
import { createSesMailer } from './lib/mailer-ses';
import type { Platform } from './lib/platform';
import { FakeBillingProvider } from './modules/billing/providers/fake';
import { MercadoPagoProvider } from './modules/billing/providers/mercadopago';
import type { Env } from './env';

/** Development/test only: a fixed, public key. Never used when NODE_ENV=production. */
async function insecureDevMasterKey(): Promise<Bytes> {
  const hex = await sha256Hex('effinance-insecure-development-master-key');
  return Uint8Array.from(hex.match(/../g)!.map((h) => parseInt(h, 16)));
}

export async function createKeyProvider(env: Env, warn: (msg: string) => void = console.warn): Promise<KeyProvider> {
  if (env.KEY_PROVIDER === 'aws') return createAwsKmsKeyProvider({ keyId: env.KMS_KEY_ID!, region: env.AWS_REGION });
  if (env.ENCRYPTION_MASTER_KEY) return LocalKeyProvider.create(fromBase64(env.ENCRYPTION_MASTER_KEY));
  if (env.NODE_ENV === 'production') throw new Error('ENCRYPTION_MASTER_KEY is required in production');
  if (env.NODE_ENV !== 'test') {
    warn('⚠ ENCRYPTION_MASTER_KEY não definida: usando a chave de desenvolvimento (insegura). Não use em produção.');
  }
  return LocalKeyProvider.create(await insecureDevMasterKey());
}

export async function createMailer(env: Env): Promise<Mailer> {
  const kind = env.MAILER ?? (env.NODE_ENV === 'test' ? 'memory' : 'console');
  switch (kind) {
    case 'memory':
      return new MemoryMailer();
    case 'webhook':
      return new WebhookMailer(env.MAIL_WEBHOOK_URL!, env.MAIL_WEBHOOK_SECRET, env.MAIL_FROM);
    case 'ses':
      return createSesMailer({ from: env.MAIL_FROM, region: env.AWS_REGION });
    default:
      return new ConsoleMailer();
  }
}

export async function createPlatform(env: Env): Promise<Platform> {
  return {
    appUrl: env.APP_URL,
    relaxedRateLimits: env.NODE_ENV === 'test',
    mailer: await createMailer(env),
    billing:
      env.BILLING_PROVIDER === 'mercadopago'
        ? new MercadoPagoProvider({ accessToken: env.MP_ACCESS_TOKEN!, webhookSecret: env.MP_WEBHOOK_SECRET! })
        : new FakeBillingProvider(env.APP_URL),
  };
}

