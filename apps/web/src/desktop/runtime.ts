// Desktop-only glue, loaded by main.tsx in the desktop build: answers the shell's snapshot requests
// (backup on close, "Fazer backup agora") and restores a backup into the local database.

import { getDemoServer } from '@/demo/server';
import { setSession } from '@/demo/session';
import { desktopBridge, type RestoreSource } from './bridge';
import { installLocalLicense } from './license';
import { exportSnapshot, importSnapshot, parseSnapshot } from './snapshot';

export function startDesktopRuntime(): void {
  const bridge = window.effinanceDesktop;
  if (!bridge) return;
  bridge.onSnapshotRequest(async () => {
    const { client } = await getDemoServer();
    // Whatever is still in memory goes to disk before the window may close.
    await client.syncToFs();
    return exportSnapshot(client);
  });
  bridge.onClosing(showClosingOverlay);
}

/** Replaces all local data with a backup. Returns false when the person cancelled the file picker. */
export async function restoreBackup(source: RestoreSource, password: string): Promise<boolean> {
  const bridge = desktopBridge();
  const payload = await bridge.backup.read(source, password);
  if (!payload) return false;
  const snapshot = parseSnapshot(payload.snapshot);
  const { client } = await getDemoServer();
  await importSnapshot(client, snapshot);
  await installLocalLicense(client);
  await client.syncToFs();
  // The restored accounts sign in again; the window reloads (same URL) with the backup's master key.
  setSession(null);
  window.location.hash = '#/login?restaurado=1';
  await bridge.backup.finishRestore(payload.masterKey);
  return true;
}

/** Plain DOM (not React): it must show over any screen, including the login page. */
function showClosingOverlay(): void {
  if (document.getElementById('desktop-closing')) return;
  const overlay = document.createElement('div');
  overlay.id = 'desktop-closing';
  overlay.setAttribute('role', 'status');
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:color-mix(in oklab, var(--app-bg) 88%, transparent);backdrop-filter:blur(2px)';
  const box = document.createElement('div');
  box.style.cssText =
    'padding:20px 24px;border-radius:16px;border:1px solid var(--app-border);background:var(--app-surface);color:var(--app-fg);font:600 15px/22px var(--font-sans, sans-serif);box-shadow:var(--shadow-lg)';
  box.textContent = 'Salvando o backup antes de fechar…';
  overlay.append(box);
  document.body.append(overlay);
}
