// Keeps the tabs of this browser on the same session. Cookies are shared by every tab, so when one
// tab signs in, signs out or switches workspace, the others would keep showing (and editing) the
// previous tenant's cached data while their requests already hit the new one.

const CHANNEL = 'effinance:session';

/** Only the kind of change crosses tabs — never tokens, ids or personal data. */
export type SessionChange = 'login' | 'logout' | 'workspace';

type Listener = (change: SessionChange) => void;

let channel: BroadcastChannel | null | undefined;

function getChannel(): BroadcastChannel | null {
  if (channel === undefined) {
    channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL);
  }
  return channel;
}

const KINDS: readonly SessionChange[] = ['login', 'logout', 'workspace'];

export function isSessionChange(value: unknown): value is SessionChange {
  return typeof value === 'string' && (KINDS as readonly string[]).includes(value);
}

/** Tells the other tabs (not this one) that the session changed. */
export function announceSessionChange(change: SessionChange): void {
  try {
    getChannel()?.postMessage(change);
  } catch {
    // Channel closed or unavailable: the other tabs resync on their next 401.
  }
}

export function onSessionChange(listener: Listener): () => void {
  const ch = getChannel();
  if (!ch) return () => {};
  const handler = (event: MessageEvent) => {
    if (isSessionChange(event.data)) listener(event.data);
  };
  ch.addEventListener('message', handler);
  return () => ch.removeEventListener('message', handler);
}
