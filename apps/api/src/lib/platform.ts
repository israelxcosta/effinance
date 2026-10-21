// External services and settings the route plugins need, decorated on the app as `app.platform`.
// Built from the environment by the API (src/setup.ts) and by hand in the browser demo, so the
// modules never import `env.ts` directly.

import type { BillingProvider } from '../modules/billing/providers/types';
import type { Mailer } from './mailer';

export interface Platform {
  /** Public URL of the web app (links in e-mails, checkout return URL). */
  appUrl: string;
  mailer: Mailer;
  billing: BillingProvider;
  /** Tests only: per-IP route limits become 1000/window so suites can hammer an endpoint. */
  relaxedRateLimits?: boolean;
}

/**
 * Per-IP rate limit for a route (`config` of the route options; @fastify/rate-limit). The browser
 * demo's router ignores it. Per-account limits live in the services (they also cover the demo).
 */
export function rateLimited(platform: Pick<Platform, 'relaxedRateLimits'> | undefined, max: number, timeWindow: string) {
  return { rateLimit: { max: platform?.relaxedRateLimits ? 1000 : max, timeWindow } };
}

declare module 'fastify' {
  interface FastifyInstance {
    platform: Platform;
  }
}
