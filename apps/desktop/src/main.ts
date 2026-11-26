// Effinance for Windows: the web app (API + PGlite database inside the page) in an Electron window,
// with an encrypted backup every time the window closes (this computer + Google Drive, 30 days).

import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, safeStorage, session, shell } from 'electron';
import { BackupService, type RestoreSource } from './backup-service';
import { GoogleDrive } from './drive';
import { LocalBackups, readBackupText } from './local-backups';
import { APP_URL, SCHEME, serveAsset } from './protocol';
import { externalUrl, isAppUrl, isPermissionAllowed, isTrustedSender, parseRestoreSource, stringArg } from './security';
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
/** The backup being restored (opened by `backup:read`): its key and password are saved once the restore completes. */
let pendingRestore: { masterKey: string; password: string } | null = null;

/** Caps for strings coming from the page (passwords, OAuth client fields, keys). */
const MAX_ARG = 1024;

/**
 * ipcMain.handle that answers only the app's own top-level page (app://effinance/), never a frame
 * or a page that left the app. Arguments are validated by each handler.
 */
function handle(channel: string, listener: (...args: unknown[]) => unknown) {
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    if (!isTrustedSender(event.senderFrame)) throw new Error('Pedido recusado.');
    return listener(...args);
  });
}

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
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      // No DevTools in the installer (there is no menu either): only in development.
      devTools: !app.isPackaged,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => win?.show());
  // Links to other sites (https only) open in the browser; the window never leaves the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    const external = externalUrl(url);
    if (external) void shell.openExternal(external);
    return { action: 'deny' };
  });
  const stayInApp = (event: Electron.Event, url: string) => {
    if (!isAppUrl(url)) event.preventDefault();
  };
  win.webContents.on('will-navigate', stayInApp);
  win.webContents.on('will-redirect', stayInApp);
  void win.loadURL(APP_URL);
  return win;
}

// Every web contents (including any created later): no <webview>, no new windows by default.
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  protocol.handle(SCHEME, (request) => serveAsset(rendererDir, request));
  // Electron grants every permission by default (camera, microphone, location, devices…): only the
  // clipboard write of the app's own page is allowed.
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) =>
    callback(isPermissionAllowed(permission, details.requestingUrl ?? contents.getURL())),
  );
  session.defaultSession.setPermissionCheckHandler((_contents, permission, requestingOrigin, details) =>
    isPermissionAllowed(permission, details.requestingUrl ?? requestingOrigin),
  );
  session.defaultSession.setDevicePermissionHandler(() => false);

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
  const backup = new BackupService({ store, local, drive, getSnapshot: requestSnapshot });

  handle('desktop:master-key', () => store.secrets().masterKey);
  handle('backup:status', () => backup.status());
  handle('backup:set-password', (password) => backup.setPassword(stringArg(password, MAX_ARG)));
  handle('backup:run', () => backup.run());
  handle('backup:list', () => backup.list());
  handle('backup:open-folder', async () => {
    local.list(); // creates the folder
    await shell.openPath(local.folder);
  });
  handle('backup:read', async (rawSource, rawPassword) => {
    const source = parseRestoreSource(rawSource);
    const password = stringArg(rawPassword, MAX_ARG);
    let resolved: RestoreSource;
    if (source.kind === 'file') {
      const picked = await dialog.showOpenDialog(win!, {
        title: 'Escolha o arquivo de backup',
        defaultPath: local.folder,
        filters: [{ name: 'Backup do Effinance', extensions: ['txt'] }],
        properties: ['openFile'],
      });
      if (picked.canceled || !picked.filePaths[0]) return null;
      resolved = { kind: 'file', text: readBackupText(picked.filePaths[0]) };
    } else resolved = source;
    const payload = await backup.read(resolved, password);
    pendingRestore = { masterKey: payload.masterKey, password };
    return payload;
  });
  handle('backup:finish-restore', (masterKey) => {
    // Only the key of the backup that was just opened (not any key the page sends).
    if (!pendingRestore || masterKey !== pendingRestore.masterKey) throw new Error('Nenhuma restauração em andamento.');
    backup.finishRestore(pendingRestore.masterKey, pendingRestore.password);
    pendingRestore = null;
    win?.webContents.reload();
  });
  handle('drive:status', () => drive.status());
  handle('drive:configure', (id, secret) => drive.configure(stringArg(id, MAX_ARG), stringArg(secret, MAX_ARG)));
  handle('drive:connect', () => drive.connect());
  handle('drive:disconnect', () => drive.disconnect());

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
