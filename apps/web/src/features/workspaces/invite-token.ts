// Where the invite screen finds its token. The fragment form (`/convite#token=…`) is preferred: a
// fragment never reaches a server, so the token stays out of access logs and of the Referer of the
// assets the page loads. `/convite/<token>` (path) is still accepted for links already sent.

export interface InviteTokenSources {
  /** `:token` route param (legacy path form). */
  param?: string | undefined;
  /** `location.hash`, e.g. `#token=…`. */
  hash?: string;
  /** `location.state` of this history entry, where the token moves after leaving the address bar. */
  state?: unknown;
}

/** `inUrl`: the token is still visible in the address bar and must move into the history state. */
export function readInviteToken({ param, hash, state }: InviteTokenSources): { token: string; inUrl: boolean } {
  const fromHash = hash ? new URLSearchParams(hash.replace(/^#/, '')).get('token') : null;
  const fromUrl = param || fromHash;
  if (fromUrl) return { token: fromUrl, inUrl: true };
  const fromState = (state as { inviteToken?: unknown } | null | undefined)?.inviteToken;
  return { token: typeof fromState === 'string' ? fromState : '', inUrl: false };
}

/** Where login/sign-up return to: the invite screen with the token in the fragment only. */
export function inviteReturnPath(token: string): string {
  return `/convite#${new URLSearchParams({ token })}`;
}
