// The only bridge between the page and the operating system: `window.effinanceDesktop`.
// Mirrors apps/web/src/desktop/bridge.ts (DesktopBridge). The page never gets Node or ipcRenderer.

import { contextBridge, ipcRenderer } from 'electron';

let snapshotHandler: (() => Promise<string>) | null = null;

ipcRenderer.on('desktop:snapshot-request', async (_event, id: string) => {
  try {
    if (!snapshotHandler) throw new Error('O aplicativo ainda está carregando.');
    ipcRenderer.send('desktop:snapshot-response', { id, ok: true, data: await snapshotHandler() });
  } catch (e) {
    ipcRenderer.send('desktop:snapshot-response', { id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
});

const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('effinanceDesktop', {
  version: process.env.EFFINANCE_VERSION ?? '',
  getMasterKey: () => invoke('desktop:master-key'),
  backup: {
    status: () => invoke('backup:status'),
    setPassword: (password: string) => invoke('backup:set-password', password),
    runNow: () => invoke('backup:run'),
    list: () => invoke('backup:list'),
    openFolder: () => invoke('backup:open-folder'),
    read: (source: unknown, password: string) => invoke('backup:read', source, password),
    finishRestore: (masterKey: string) => invoke('backup:finish-restore', masterKey),
  },
  drive: {
    status: () => invoke('drive:status'),
    configure: (clientId: string, clientSecret: string) => invoke('drive:configure', clientId, clientSecret),
    connect: () => invoke('drive:connect'),
    disconnect: () => invoke('drive:disconnect'),
  },
  onSnapshotRequest: (handler: () => Promise<string>) => {
    snapshotHandler = handler;
  },
  onClosing: (handler: () => void) => {
    ipcRenderer.on('desktop:closing', () => handler());
  },
});
