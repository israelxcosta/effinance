// Pluggy Connect: the aggregator's official consent widget (Open Finance Brasil). It renders an
// iframe served from https://connect.pluggy.ai (the only origin it needs: see `frame-src` in
// src/lib/csp.ts) and talks to this page through postMessage. Loaded on demand (own chunk), never
// from a CDN.

export interface PluggyConnectOptions {
  /** Short-lived connect token from `POST /open-finance/connect-token` (never an API key). */
  connectToken: string;
  /** Update mode (re-consent) of an existing item. */
  updateItem?: string | null;
  /** Show the aggregator's sandbox institutions. */
  includeSandbox?: boolean;
  theme: 'light' | 'dark';
}

export class PluggyConnectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PluggyConnectError';
  }
}

/**
 * Opens the widget and resolves with the connected item id when the user finishes, or null when
 * they close it without connecting. Rejects when the widget cannot be loaded.
 *
 * TODO(open-finance): instalar o SDK oficial e trocar este corpo pelo import dinâmico:
 *   pnpm --filter @effinance/web add pluggy-connect-sdk@2.14.2
 * (o pnpm recusa re-resolver o lockfile até as dependências recentes cumprirem `minimumReleaseAge`).
 */
export async function openPluggyConnect(options: PluggyConnectOptions): Promise<string | null> {
  void options;
  throw new PluggyConnectError('O conector do banco ainda não está disponível nesta versão. Tente novamente mais tarde.');
}
