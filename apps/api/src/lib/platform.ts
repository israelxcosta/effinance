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
}

declare module 'fastify' {
  interface FastifyInstance {
    platform: Platform;
  }
}
