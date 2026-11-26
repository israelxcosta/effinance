import { describe, expect, it } from 'vitest';
import { safeInternalPath } from '@/lib/safe-url';
import { inviteReturnPath, readInviteToken } from './invite-token';

const TOKEN = 'k3J9_x-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';

describe('invite token in the URL', () => {
  it('reads the token from the fragment (#token=), the legacy path and the history state', () => {
    expect(readInviteToken({ hash: `#token=${TOKEN}` })).toEqual({ token: TOKEN, inUrl: true });
    expect(readInviteToken({ param: TOKEN })).toEqual({ token: TOKEN, inUrl: true });
    expect(readInviteToken({ state: { inviteToken: TOKEN } })).toEqual({ token: TOKEN, inUrl: false });
    expect(readInviteToken({ state: { inviteToken: 42 } })).toEqual({ token: '', inUrl: false });
    expect(readInviteToken({})).toEqual({ token: '', inUrl: false });
  });

  // `/convite/<token>` puts the token in the request line (CDN/ALB access logs) and in the Referer
  // of every asset the page loads; after signing in the app used to navigate back to that path.
  it('returns to the invite after login with the token only in the fragment', () => {
    const path = inviteReturnPath(TOKEN);
    const url = new URL(path, 'https://app.example');
    expect(url.pathname).toBe('/convite');
    expect(url.search).toBe('');
    expect(url.pathname + url.search).not.toContain(TOKEN);
    // It survives the post-login redirect filter and is read back by the invite screen.
    expect(safeInternalPath(path)).toBe(path);
    expect(readInviteToken({ hash: url.hash }).token).toBe(TOKEN);
  });
});
