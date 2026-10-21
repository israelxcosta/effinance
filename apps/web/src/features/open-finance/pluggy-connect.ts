// Pluggy Connect: the aggregator's official consent widget (Open Finance Brasil), from the npm
// package `pluggy-connect-sdk` (pinned). It renders an iframe served by PLUGGY_CONNECT_ORIGIN — the
// only origin it needs, allowed in `frame-src` (src/lib/csp.ts) — and talks to this page through
// postMessage (zoid). No script is loaded from a CDN: the SDK is bundled in its own chunk, fetched
// only when the user connects a bank.

import { PLUGGY_CONNECT_ORIGIN } from '@/lib/csp';

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

/** The part of the SDK used here (its typings import types from the server-side `pluggy-js`). */
interface PluggyConnectWidget {
  init(container?: HTMLElement): Promise<void>;
}
type PluggyConnectCtor = new (props: {
  url?: string;
  connectToken: string;
  updateItem?: string;
  includeSandbox?: boolean;
  language?: string;
  theme?: 'light' | 'dark';
  onSuccess?: (data: { item: { id: string } }) => void;
  onError?: (error: { message: string; data?: { item?: { id: string } } }) => void;
  onClose?: () => void;
}) => PluggyConnectWidget;

/**
 * Opens the widget and resolves with the connected item id once the user closes it after
 * connecting, or null when they close it without connecting. Rejects when it cannot be loaded.
 * The promise settles only on close: the widget is a modal on top of the page, and the next
 * dialogs of the flow (Radix, modal) would block its pointer events while it is still open.
 */
export async function openPluggyConnect(options: PluggyConnectOptions): Promise<string | null> {
  let PluggyConnect: PluggyConnectCtor;
  try {
    const mod = (await import('pluggy-connect-sdk')) as unknown as { PluggyConnect: PluggyConnectCtor };
    PluggyConnect = mod.PluggyConnect;
  } catch {
    throw new PluggyConnectError('Não foi possível carregar o conector do banco. Verifique sua internet e tente novamente.');
  }

  return new Promise<string | null>((resolve, reject) => {
    let itemId: string | null = null;
    let settled = false;
    const widget = new PluggyConnect({
      url: PLUGGY_CONNECT_ORIGIN,
      connectToken: options.connectToken,
      ...(options.updateItem ? { updateItem: options.updateItem } : {}),
      includeSandbox: options.includeSandbox ?? false,
      language: 'pt',
      // The SDK interpolates `theme` into the modal's innerHTML: only the two known values get there.
      theme: options.theme === 'dark' ? 'dark' : 'light',
      onSuccess: (data) => {
        // Called through postMessage by the widget's origin only (zoid checks it); still untrusted
        // input: just an id string, which the API re-validates against the aggregator.
        const id: unknown = data?.item?.id;
        if (typeof id === 'string' && id.length > 0 && id.length <= 128) itemId = id;
      },
      // Errors (login refused, bank unavailable) are shown inside the widget; the user closes it.
      onError: () => undefined,
      onClose: () => {
        if (settled) return;
        settled = true;
        resolve(itemId);
      },
    });
    widget.init().catch(() => {
      if (settled) return;
      settled = true;
      reject(new PluggyConnectError('Não foi possível abrir o conector do banco. Tente novamente em instantes.'));
    });
  });
}
