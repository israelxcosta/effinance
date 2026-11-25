// Effinance for Windows: the web app (API + PGlite database inside the page) in an Electron window,
// with an encrypted backup every time the window closes (this computer + Google Drive, 30 days).

import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, safeStorage, shell } from 'electron';
import { BackupService, type RestoreSource } from './backup-service';
import { GoogleDrive } from './drive';
import { DRIVE_DOWNLOAD_URL, SYNC_SUBFOLDER, detectGoogleDriveFolder } from './drive-folder';
import { LocalBackups } from './local-backups';
import { APP_URL, HOST, SCHEME, serveAsset } from './protocol';
import { Store, type Encryptor } from './store';

const SNAPSHOT_TIMEOUT_MS = 60_000;
/** The window closes even if the backup hangs (e.g. no network for the Drive upload). */
const CLOSE_BACKUP_TIMEOUT_MS = 90_000;

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

if (!app.requestSingleInstanceLock()) app.quit();

const rendererDir = app.isPackaged ? join(process.resourcesPath, 'renderer') : join(__dirname, '..', '..', 'web', 'dist-desktop');

let win: BrowserWindow | null = null;
let closing = false;
/** Password that opened the backup being restored; saved once the restore completes. */
let restorePassword: string | null = null;

function requestSnapshot(): Promise<string> {
  const target = win;
  if (!target || target.isDestroyed()) return Promise.reject(new Error('A janela do aplicativo não está aberta.'));
  const id = randomBytes(8).toString('hex');
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ipcMain.removeListener('desktop:snapshot-response', onResponse);
      reject(new Error('O aplicativo demorou demais para preparar o backup.'));
    }, SNAPSHOT_TIMEOUT_MS);
    function onResponse(event: Electron.IpcMainEvent, msg: { id: string; ok: boolean; data?: string; error?: string }) {
      if (event.sender !== target!.webContents || msg.id !== id) return;
      clearTimeout(timer);
      ipcMain.removeListener('desktop:snapshot-response', onResponse);
      if (msg.ok && typeof msg.data === 'string') resolve(msg.data);
      else reject(new Error(msg.error ?? 'Falha ao preparar o backup.'));
    }
    ipcMain.on('desktop:snapshot-response', onResponse);
    target.webContents.send('desktop:snapshot-request', id);
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 960,
    minHeight: 640,
    title: 'Effinance',
    backgroundColor: '#f6f6f4',
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => win?.show());
  // Links to other sites open in the browser; the window never leaves the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${SCHEME}://${HOST}/`)) event.preventDefault();
  });
  void win.loadURL(APP_URL);
  return win;
}

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  protocol.handle(SCHEME, (request) => serveAsset(rendererDir, request));

  // Development on machines without an OS keychain (e.g. Linux CI): plain secrets, never in the installer.
  const plain: Encryptor = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from(s), decryptString: (b) => b.toString() };
  const encryptor = !app.isPackaged && process.env.EFFINANCE_DEV_PLAIN_SECRETS === '1' ? plain : safeStorage;
  const store = new Store(app.getPath('userData'), encryptor);
  if (!store.secrets().masterKey) store.updateSecrets({ masterKey: randomBytes(32).toString('hex') });

  const builtInClient =
    process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET
      ? { id: process.env.GOOGLE_OAUTH_CLIENT_ID, secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET }
      : null;
  const drive = new GoogleDrive({ store, openExternal: (url) => shell.openExternal(url), defaultClient: builtInClient });
  const local = new LocalBackups(join(app.getPath('documents'), 'Effinance', 'Backups'));
  // Google Drive for desktop: the backups folder inside "Meu Drive" (detected, chosen, or off).
  const detectDrive = () => detectGoogleDriveFolder({ home: app.getPath('home') });
  const syncRoot = () => {
    const chosen = store.settings().syncFolder;
    return chosen === '' ? null : (chosen ?? detectDrive());
  };
  const synced = () => {
    const root = syncRoot();
    return root ? new LocalBackups(join(root, SYNC_SUBFOLDER)) : null;
  };
  const syncStatus = () => {
    const chosen = store.settings().syncFolder;
    const root = syncRoot();
    return {
      mode: chosen === '' ? 'off' : chosen ? 'custom' : 'auto',
      folder: root ? join(root, SYNC_SUBFOLDER) : null,
      detected: detectDrive(),
    };
  };
  const backup = new BackupService({ store, local, synced, drive, getSnapshot: requestSnapshot });

  ipcMain.handle('desktop:master-key', () => store.secrets().masterKey);
  ipcMain.handle('backup:status', () => backup.status());
  ipcMain.handle('backup:set-password', (_e, password: string) => backup.setPassword(String(password)));
  ipcMain.handle('backup:run', () => backup.run());
  ipcMain.handle('backup:list', () => backup.list());
  ipcMain.handle('backup:open-folder', async () => {
    local.list(); // creates the folder
    await shell.openPath(local.folder);
  });
  ipcMain.handle('backup:read', async (_e, source: { kind: string; date?: string; id?: string }, password: string) => {
    let resolved: RestoreSource;
    if (source.kind === 'file') {
      const picked = await dialog.showOpenDialog(win!, {
        title: 'Escolha o arquivo de backup',
        defaultPath: local.folder,
        filters: [{ name: 'Backup do Effinance', extensions: ['txt'] }],
        properties: ['openFile'],
      });
      if (picked.canceled || !picked.filePaths[0]) return null;
      resolved = { kind: 'file', text: await readFile(picked.filePaths[0], 'utf8') };
    } else if (source.kind === 'local' && source.date) resolved = { kind: 'local', date: source.date };
    else if (source.kind === 'synced' && source.date) resolved = { kind: 'synced', date: source.date };
    else if (source.kind === 'drive' && source.id) resolved = { kind: 'drive', id: source.id };
    else throw new Error('Origem do backup inválida.');
    const payload = await backup.read(resolved, String(password));
    restorePassword = String(password);
    return payload;
  });
  ipcMain.handle('backup:finish-restore', (_e, masterKey: string) => {
    if (!restorePassword) throw new Error('Nenhuma restauração em andamento.');
    backup.finishRestore(String(masterKey), restorePassword);
    restorePassword = null;
    win?.webContents.reload();
  });
  ipcMain.handle('sync:status', () => syncStatus());
  ipcMain.handle('sync:set-enabled', (_e, enabled: boolean) => {
    store.updateSettings({ syncFolder: enabled ? undefined : '' });
    return syncStatus();
  });
  ipcMain.handle('sync:choose', async () => {
    const picked = await dialog.showOpenDialog(win!, {
      title: 'Escolha a pasta do Google Drive (por exemplo, G:\\Meu Drive)',
      defaultPath: syncRoot() ?? app.getPath('home'),
      properties: ['openDirectory'],
    });
    if (!picked.canceled && picked.filePaths[0]) store.updateSettings({ syncFolder: picked.filePaths[0] });
    return syncStatus();
  });
  ipcMain.handle('sync:open-download', () => shell.openExternal(DRIVE_DOWNLOAD_URL));
  ipcMain.handle('drive:status', () => drive.status());
  ipcMain.handle('drive:configure', (_e, id: string, secret: string) => drive.configure(String(id), String(secret)));
  ipcMain.handle('drive:connect', () => drive.connect());
  ipcMain.handle('drive:disconnect', () => drive.disconnect());

  const window = createWindow();
  // Backup on close: the window stays up (with a notice) until the backup is saved, then closes.
  window.on('close', (event) => {
    if (closing || !backup.status().hasPassword) return;
    event.preventDefault();
    closing = true;
    window.webContents.send('desktop:closing');
    console.info('[effinance] backup on close: start');
    const timeout = new Promise((resolve) => setTimeout(resolve, CLOSE_BACKUP_TIMEOUT_MS));
    const run = backup.run().then(
      () => console.info('[effinance] backup on close: done'),
      (e: unknown) => console.error('[effinance] backup on close failed', e),
    );
    void Promise.race([run, timeout]).finally(() => window.destroy());
  });
}).catch((error: unknown) => {
  // A startup failure must be visible, not a window that never opens.
  console.error('[effinance] startup failed', error);
  dialog.showErrorBox('Effinance não abriu', error instanceof Error ? error.message : String(error));
  app.quit();
});

app.on('window-all-closed', () => app.quit());
