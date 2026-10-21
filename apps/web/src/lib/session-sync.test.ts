import { afterAll, describe, expect, it } from 'vitest';
import { announceSessionChange, isSessionChange, onSessionChange, type SessionChange } from './session-sync';

// Another tab of the same origin.
const otherTab = new BroadcastChannel('effinance:session');
afterAll(() => otherTab.close());

const nextMessage = (ch: BroadcastChannel) =>
  new Promise<unknown>((resolve) => ch.addEventListener('message', (e) => resolve((e as MessageEvent).data), { once: true }));

describe('session sync between tabs', () => {
  it('announces only the kind of change (no tokens or ids)', async () => {
    const received = nextMessage(otherTab);
    announceSessionChange('workspace');
    expect(await received).toBe('workspace');
  });

  it('delivers changes from other tabs and ignores anything else', async () => {
    const seen: SessionChange[] = [];
    const stop = onSessionChange((c) => seen.push(c));
    otherTab.postMessage({ token: 'x' });
    otherTab.postMessage('logout');
    await new Promise((r) => setTimeout(r, 50));
    stop();
    otherTab.postMessage('login');
    await new Promise((r) => setTimeout(r, 50));
    expect(seen).toEqual(['logout']);
    expect(isSessionChange('drop table')).toBe(false);
  });
});
