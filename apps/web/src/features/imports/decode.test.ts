import { describe, expect, it } from 'vitest';
import { MAX_IMPORT_CONTENT_CHARS } from '@effinance/shared';
import { csvSample, decodeImportBytes, declaredOfxCharset, guessDelimiter, ImportFileError, splitCsvLine } from './decode';

/** windows-1252 bytes for text in the Latin-1 range (accents used in Portuguese). */
function cp1252(text: string): Uint8Array {
  return Uint8Array.from([...text].map((ch) => {
    const code = ch.charCodeAt(0);
    if (code > 0xff) throw new Error(`not latin-1: ${ch}`);
    return code;
  }));
}

const utf8 = (text: string) => new TextEncoder().encode(text);

const SGML_HEADER = [
  'OFXHEADER:100',
  'DATA:OFXSGML',
  'VERSION:102',
  'SECURITY:NONE',
  'ENCODING:USASCII',
  'CHARSET:1252',
  'COMPRESSION:NONE',
  'OLDFILEUID:NONE',
  'NEWFILEUID:NONE',
  '',
].join('\r\n');

describe('decodeImportBytes', () => {
  it('OFX 1.x declared as CHARSET:1252 is read as windows-1252 (accents preserved)', () => {
    const text = `${SGML_HEADER}<OFX><STMTTRN><MEMO>Pão de Açúcar – São Paulo</MEMO></STMTTRN></OFX>`;
    // "–" (en dash) is 0x96 in windows-1252.
    const bytes = cp1252(text.replace('–', '\u0096'));
    const file = decodeImportBytes(bytes, 'extrato-itau.ofx');
    expect(file.format).toBe('ofx');
    expect(file.charset).toBe('windows-1252');
    expect(file.declaredCharset).toBe('windows-1252');
    expect(file.content).toContain('Pão de Açúcar – São Paulo');
  });

  it('OFX declared as 1252 but written in UTF-8 (common in Brazilian banks) is read as UTF-8', () => {
    const file = decodeImportBytes(utf8(`${SGML_HEADER}<OFX><MEMO>Farmácia São João</MEMO></OFX>`), 'nubank.ofx');
    expect(file.charset).toBe('utf-8');
    expect(file.declaredCharset).toBe('windows-1252');
    expect(file.content).toContain('Farmácia São João');
    expect(file.content).not.toContain('Ã');
  });

  it('OFX 2.x (XML) with encoding="UTF-8"', () => {
    const xml = '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<?OFX OFXHEADER="200" VERSION="220"?>\n<OFX><MEMO>Crédito salário</MEMO></OFX>';
    const file = decodeImportBytes(utf8(xml), 'extrato.qfx');
    expect(file).toMatchObject({ format: 'ofx', charset: 'utf-8', declaredCharset: 'utf-8' });
    expect(file.content).toContain('Crédito salário');
  });

  it('a UTF-8 declaration with invalid UTF-8 bytes falls back to windows-1252', () => {
    const xml = '<?xml version="1.0" encoding="UTF-8"?><OFX><MEMO>Débito</MEMO></OFX>';
    const file = decodeImportBytes(cp1252(xml), 'x.ofx');
    expect(file.charset).toBe('windows-1252');
    expect(file.content).toContain('Débito');
  });

  it('detects OFX by content even with a .txt extension', () => {
    const file = decodeImportBytes(utf8(`${SGML_HEADER}<OFX></OFX>`), 'download.txt');
    expect(file.format).toBe('ofx');
  });

  it('CSV in UTF-8 with BOM: BOM removed', () => {
    const file = decodeImportBytes(utf8('﻿data,descrição,valor\n2026-10-01,Padaria,-12.50\n'), 'nubank.csv');
    expect(file).toMatchObject({ format: 'csv', charset: 'utf-8' });
    expect(file.content.startsWith('data,descrição')).toBe(true);
  });

  it('CSV that is not valid UTF-8 falls back to windows-1252', () => {
    const file = decodeImportBytes(cp1252('Data;Histórico;Valor\n01/10/2026;Pagto conta de água;-80,00\n'), 'bb.csv');
    expect(file.charset).toBe('windows-1252');
    expect(file.content).toContain('Histórico');
    expect(file.content).toContain('conta de água');
  });

  it('UTF-16 (Excel "Unicode text") with BOM', () => {
    const text = 'Data\tDescrição\tValor\n';
    const bytes = new Uint8Array(2 + text.length * 2);
    bytes[0] = 0xff;
    bytes[1] = 0xfe;
    [...text].forEach((ch, i) => {
      bytes[2 + i * 2] = ch.charCodeAt(0) & 0xff;
      bytes[3 + i * 2] = ch.charCodeAt(0) >> 8;
    });
    const file = decodeImportBytes(bytes, 'planilha.txt');
    expect(file.charset).toBe('utf-16le');
    expect(file.content).toBe(text);
  });

  it('refuses empty, binary, oversized and unsupported files', () => {
    expect(() => decodeImportBytes(new Uint8Array(), 'a.csv')).toThrow(ImportFileError);
    expect(() => decodeImportBytes(utf8('  \n '), 'a.csv')).toThrow('vazio');
    // A renamed .xlsx (zip) has NUL bytes.
    expect(() => decodeImportBytes(Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]), 'a.csv')).toThrow('não parece');
    expect(() => decodeImportBytes(utf8('x'), 'fatura.pdf')).toThrow('Formato não suportado');
    const big = new Uint8Array(MAX_IMPORT_CONTENT_CHARS + 1).fill(0x41);
    expect(() => decodeImportBytes(big, 'a.csv')).toThrow('muito grande');
  });
});

describe('declaredOfxCharset', () => {
  it('reads SGML and XML declarations', () => {
    expect(declaredOfxCharset('OFXHEADER:100\nENCODING:UTF-8\nCHARSET:NONE')).toBe('utf-8');
    expect(declaredOfxCharset('OFXHEADER:100\nENCODING:USASCII\nCHARSET:ISO-8859-1')).toBe('windows-1252');
    expect(declaredOfxCharset('OFXHEADER:100\nENCODING:USASCII\nCHARSET:NONE')).toBeNull();
    expect(declaredOfxCharset('<?xml version="1.0" encoding=\'windows-1252\'?>')).toBe('windows-1252');
  });
});

describe('CSV helpers', () => {
  it('splits quoted cells and guesses the delimiter', () => {
    expect(splitCsvLine('"Supermercado; Centro";"-1.234,56";01/10/2026', ';')).toEqual(['Supermercado; Centro', '-1.234,56', '01/10/2026']);
    expect(splitCsvLine('a,"b ""c""",d', ',')).toEqual(['a', 'b "c"', 'd']);
    expect(guessDelimiter('date,title,amount\n2026-10-01,Uber,23.9')).toBe(',');
    expect(guessDelimiter('Data;Descrição;Valor\n01/10/2026;Uber;-23,90')).toBe(';');
    expect(csvSample('a;b\n\n1;2\n', ';')).toEqual([['a', 'b'], ['1', '2']]);
  });
});
