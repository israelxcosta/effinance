import { describe, expect, it } from 'vitest';
import { csvMappingSchema, type ImportPreviewRow } from '@effinance/shared';
import { defaultCsvMapping, duplicateKind } from './labels';

describe('defaultCsvMapping (fallback when the API cannot detect the CSV layout)', () => {
  it('debit/credit columns, short dates and comma decimals (Banco do Brasil style)', () => {
    const csv = 'Lançamento;Histórico;Débito (R$);Crédito (R$);Saldo\n02/10/26;Pagto água;89,90;;910,10\n03/10/26;Depósito;;500,00;1.410,10\n';
    const m = defaultCsvMapping(csv);
    expect(m).toMatchObject({
      delimiter: ';',
      hasHeader: true,
      dateColumn: 0,
      descriptionColumn: 1,
      amountColumn: null,
      debitColumn: 2,
      creditColumn: 3,
      dateFormat: 'DD/MM/YY',
      decimalSeparator: ',',
    });
    expect(csvMappingSchema.safeParse(m).success).toBe(true);
  });

  it('single amount column after the description, ISO dates and dot decimals', () => {
    const m = defaultCsvMapping('date,title,amount\n2026-09-12,Padaria Pão Quente,18.50\n2026-09-14,Uber *Trip,23.90\n');
    expect(m).toMatchObject({ delimiter: ',', dateColumn: 0, descriptionColumn: 1, amountColumn: 2, idColumn: null, dateFormat: 'YYYY-MM-DD', decimalSeparator: '.' });
  });

  it('bank id column (Nubank account "Identificador") becomes idColumn, not the description', () => {
    const m = defaultCsvMapping('Data,Valor,Identificador,Descrição\n01/10/2026,-45.90,6710a1b2-0001,Compra no débito - Padaria\n');
    expect(m).toMatchObject({ dateColumn: 0, amountColumn: 1, idColumn: 2, descriptionColumn: 3, decimalSeparator: '.' });
    expect(csvMappingSchema.safeParse(m).success).toBe(true);
  });

  it('files without header: picks the date-looking and the longest text columns', () => {
    const m = defaultCsvMapping('-45,90;01/10/2026;Compra no débito Padaria\n3.500,00;02/10/2026;Pix recebido Empresa XYZ\n');
    expect(m).toMatchObject({ hasHeader: false, dateColumn: 1, descriptionColumn: 2, amountColumn: 0, dateFormat: 'DD/MM/YYYY', decimalSeparator: ',' });
  });
});

describe('duplicateKind', () => {
  const row = (patch: Partial<ImportPreviewRow>) => ({ duplicate: false, duplicateKind: null, note: null, ...patch }) as ImportPreviewRow;
  it('comes from the API field', () => {
    expect(duplicateKind(row({}))).toBeNull();
    expect(duplicateKind(row({ duplicate: true, duplicateKind: 'imported', note: 'Qualquer texto' }))).toBe('imported');
    expect(duplicateKind(row({ duplicate: true, duplicateKind: 'similar', note: 'Já importado' }))).toBe('similar');
  });

  it('falls back to the note when the API does not send the field', () => {
    const legacy = (patch: Partial<ImportPreviewRow>) => {
      const r = row(patch) as Partial<ImportPreviewRow>;
      delete r.duplicateKind;
      return r as ImportPreviewRow;
    };
    expect(duplicateKind(legacy({ duplicate: true, note: 'Já importado' }))).toBe('imported');
    expect(duplicateKind(legacy({ duplicate: true, note: 'Possível duplicado' }))).toBe('similar');
    expect(duplicateKind(legacy({ duplicate: false, note: 'Já importado' }))).toBeNull();
  });
});
