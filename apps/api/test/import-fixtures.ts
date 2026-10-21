import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/imports');

/** Synthetic bank exports (no real people, accounts or documents). */
export const fixture = (name: string) => readFileSync(path.join(dir, name), 'utf8');
