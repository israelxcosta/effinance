import { describe, expect, it } from 'vitest';
import { MAX_IMPORT_CONTENT_CHARS } from '@effinance/shared';
import type { ImportBatch } from '@effinance/shared';
import { decodeImportBytes, displayFileName, ImportFileError, MAX_IMPORT_FILE_BYTES, readImportFile } from './decode';
import { batchTitle } from './labels';

const utf8 = (s: string) => new TextEncoder().encode(s);
const CSV = 'Data;Descrição;Valor\n01/10/2026;Mercado;-10,00\n';

describe('import file hardening', () => {
  it('strips direction overrides and invisible characters from the displayed file name', () => {
    // "fatura‮xfo.exe" renders as "fatuaexe.ofx" style spoofs; U+202E must not survive.
    expect(displayFileName('fatura‮exe.ofx')).toBe('faturaexe.ofx');
    expect(displayFileName('extrato\u0000​⁦.csv')).toBe('extrato.csv');
    expect(displayFileName('  ‮  ')).toBe('extrato');
    expect(displayFileName('a'.repeat(300) + '.csv')).toHaveLength(255);
    // Surrogate pairs are never cut in half.
    expect(displayFileName('😀'.repeat(300))).toBe('😀'.repeat(255));
    expect(decodeImportBytes(utf8(CSV), 'banco‮vsc.csv').fileName).toBe('bancovsc.csv');
  });

  it('refuses oversized files before reading their bytes', async () => {
    let read = false;
    const huge = {
      name: 'grande.csv',
      size: MAX_IMPORT_FILE_BYTES + 1,
      arrayBuffer: async () => {
        read = true;
        return new ArrayBuffer(0);
      },
    } as unknown as File;
    await expect(readImportFile(huge)).rejects.toBeInstanceOf(ImportFileError);
    expect(read).toBe(false);
    expect(MAX_IMPORT_FILE_BYTES).toBe(MAX_IMPORT_CONTENT_CHARS * 2 + 4);
  });

  it('refuses binaries renamed to an accepted extension and other extensions', () => {
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00]);
    expect(() => decodeImportBytes(zip, 'extrato.csv')).toThrow(ImportFileError);
    expect(() => decodeImportBytes(utf8(CSV), 'extrato.html')).toThrow(/Formato não suportado/);
    expect(() => decodeImportBytes(utf8(CSV), 'extrato.svg')).toThrow(/Formato não suportado/);
  });

  it('keeps markup in the content as plain text (rendered by React as text, never as HTML)', () => {
    const file = decodeImportBytes(utf8('Data;Descrição;Valor\n01/10/2026;<img src=x onerror=alert(1)>;-1,00\n'), 'x.csv');
    expect(file.content).toContain('<img src=x onerror=alert(1)>');
    expect(file.format).toBe('csv');
  });
});
