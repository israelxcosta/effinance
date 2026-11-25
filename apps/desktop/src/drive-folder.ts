// Google Drive for desktop (Google's free app) mounts the person's Drive as a folder — usually the
// virtual drive G:\ with "Meu Drive" / "My Drive" inside. Backups saved there sync to Google Drive
// by themselves: no Google Cloud project, no OAuth, no sign-in inside Effinance.

import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const SYNC_SUBFOLDER = 'Effinance Backups';
const MY_DRIVE_NAMES = ['Meu Drive', 'My Drive', 'Mi unidad'];
export const DRIVE_DOWNLOAD_URL = 'https://www.google.com/drive/download/';

export interface DetectDeps {
  platform?: NodeJS.Platform;
  home?: string;
  exists?: (path: string) => boolean;
}

/** "Meu Drive" folder of Google Drive for desktop on this computer, or null. */
export function detectGoogleDriveFolder({ platform = process.platform, home = '', exists = existsSync }: DetectDeps = {}): string | null {
  const candidates: string[] = [];
  if (platform === 'win32') {
    // Streaming mode (default): a virtual drive letter, G: unless taken.
    for (const letter of 'GDEFHIJKLMNOPQRSTUVWXYZ') for (const name of MY_DRIVE_NAMES) candidates.push(`${letter}:\\${name}`);
  } else if (platform === 'darwin') {
    candidates.push(join(home, 'Google Drive', 'My Drive'), join(home, 'Google Drive', 'Meu Drive'));
  }
  // Mirror mode and older versions: a folder in the user profile.
  for (const name of MY_DRIVE_NAMES) candidates.push(join(home, 'Google Drive', name));
  candidates.push(join(home, 'Google Drive'));
  return candidates.find((c) => exists(c)) ?? null;
}
