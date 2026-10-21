import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PLUGGY_CONNECT_ORIGIN } from '@/lib/csp';

// The SDK touches `window` on import (zoid); the wrapper's contract is tested against a stand-in
// that records the props and lets the test play the widget's callbacks.
type Props = Record<string, unknown> & {
  onSuccess: (data: unknown) => void;
  onClose: () => void;
};
const created: Props[] = [];
let initResult: Promise<void> = Promise.resolve();

vi.mock('pluggy-connect-sdk', () => ({
  PluggyConnect: class {
    constructor(props: Props) {
      created.push(props);
    }
    init() {
      return initResult;
    }
  },
}));

const { openPluggyConnect, PluggyConnectError } = await import('./pluggy-connect');

describe('openPluggyConnect', () => {
  beforeEach(() => {
    created.length = 0;
    initResult = Promise.resolve();
  });

  it('frames only the fixed Pluggy origin and passes no more than the widget needs', async () => {
    const promise = openPluggyConnect({ connectToken: 'ct-123', theme: 'dark' });
    await vi.waitFor(() => expect(created).toHaveLength(1));
    const props = created[0]!;
    expect(props.url).toBe(PLUGGY_CONNECT_ORIGIN);
    expect(props.connectToken).toBe('ct-123');
    expect(props.includeSandbox).toBe(false);
    expect(Object.keys(props).sort()).toEqual(['connectToken', 'includeSandbox', 'language', 'onClose', 'onError', 'onSuccess', 'theme', 'url']);
    props.onClose();
    await expect(promise).resolves.toBeNull();
  });

  it('only a known theme reaches the SDK (it is interpolated into innerHTML)', async () => {
    void openPluggyConnect({ connectToken: 't', theme: '"><img src=x onerror=alert(1)>' as 'dark' });
    await vi.waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]!.theme).toBe('light');
  });

  it('resolves with the item id only after close, and ignores malformed success payloads', async () => {
    const promise = openPluggyConnect({ connectToken: 't', theme: 'light' });
    await vi.waitFor(() => expect(created).toHaveLength(1));
    const { onSuccess, onClose } = created[0]!;
    onSuccess(undefined);
    onSuccess({ item: { id: { $ne: null } } });
    onSuccess({ item: { id: 'x'.repeat(500) } });
    onSuccess({ item: { id: '3e2a1b6c-1111-4c3d-9e8f-000000000000' } });
    onClose();
    onClose();
    await expect(promise).resolves.toBe('3e2a1b6c-1111-4c3d-9e8f-000000000000');
  });

  it('rejects with a pt-BR message when the widget cannot render', async () => {
    initResult = Promise.reject(new Error('zoid: render failed'));
    await expect(openPluggyConnect({ connectToken: 't', theme: 'light' })).rejects.toBeInstanceOf(PluggyConnectError);
  });
});
