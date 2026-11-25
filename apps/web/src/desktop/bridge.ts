// What the Electron shell (apps/desktop/src/preload.ts) exposes as `window.effinanceDesktop`.
// Keep in sync with that file: it is the only channel between the app and the operating system.

export interface BackupEntry {
  /** Day of the backup (one file per day), `YYYY-MM-DD`. */
  date: string;
  /** Size in bytes of the encrypted file. */
  size: number;
  local: boolean;
  /** Google Drive file id when the day was uploaded. */
  driveId: string | null;
}

export interface BackupStatus {
  /** A backup password is saved on this computer: the app backs up when it closes. */
  hasPassword: boolean;
  lastBackupAt: string | null;
  lastError: string | null;
  /** Days kept, locally and on Google Drive. */
  retentionDays: number;
  localFolder: string;
}

export interface DriveStatus {
  /** OAuth client (Google Cloud project) saved on this computer. */
  configured: boolean;
  connected: boolean;
  email: string | null;
}

export interface RestorePayload {
  masterKey: string;
  snapshot: string;
}

export type RestoreSource = { kind: 'local'; date: string } | { kind: 'drive'; id: string } | { kind: 'file' };

export interface DesktopBridge {
  version: string;
  /** Hex master key for the field encryption, kept with Windows DPAPI (Electron safeStorage). */
  getMasterKey(): Promise<string>;
  backup: {
    status(): Promise<BackupStatus>;
    setPassword(password: string): Promise<void>;
    runNow(): Promise<BackupStatus>;
    list(): Promise<BackupEntry[]>;
    openFolder(): Promise<void>;
    /** Decrypts a backup; null when the person cancels the file picker. */
    read(source: RestoreSource, password: string): Promise<RestorePayload | null>;
    /** After the snapshot is in the database: saves the backup's master key and reloads the window. */
    finishRestore(masterKey: string): Promise<void>;
  };
  drive: {
    status(): Promise<DriveStatus>;
    configure(clientId: string, clientSecret: string): Promise<DriveStatus>;
    connect(): Promise<DriveStatus>;
    disconnect(): Promise<DriveStatus>;
  };
  /** The shell asks for the database snapshot (backup on close, "Fazer backup agora"). */
  onSnapshotRequest(handler: () => Promise<string>): void;
  /** The window is closing and the backup is running. */
  onClosing(handler: () => void): void;
}

declare global {
  interface Window {
    effinanceDesktop?: DesktopBridge;
  }
}

export function desktopBridge(): DesktopBridge {
  const bridge = typeof window === 'undefined' ? undefined : window.effinanceDesktop;
  if (!bridge) throw new Error('O Effinance para Windows não está disponível nesta janela.');
  return bridge;
}
