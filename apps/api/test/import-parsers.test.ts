// Pure parsers of bank statements (OFX 1.x/2.x, CSV exports of Brazilian banks). Fixtures in
// test/fixtures/imports are synthetic (no real people, accounts or documents).

import { describe, expect, it } from 'vitest';
import { csvMappingSchema } from '@effinance/shared';
import { detectDelimiter, parseCsv, splitCsv } from '../src/modules/imports/csv';
import {
  cleanDescription,
  installmentHint,
  isBalanceLine,
  isCardBillPayment,
  normalizeDescription,
  paymentMethodHint,
  significantPrefix,
} from '../src/modules/imports/describe';
import { bankFromCompe, looksLikeOfx, parseOfx } from '../src/modules/imports/ofx';
import { detectFormat, parseImportFile } from '../src/modules/imports/parse';
import { detectDateFormat, parseAmount, parseDate, parseOfxDate } from '../src/modules/imports/values';
import { fixture } from './import-fixtures';


describe('values', () => {
  it.each([
    ['R$ -1.234,56', ',', -123456],
    ['(1.234,56)', ',', -123456],
    ['1,234.56', '.', 123456],
    ['-50', ',', -5000],
    ['50,00-', ',', -5000],
    ['50,00 D', ',', -5000],
    ['50,00 C', ',', 5000],
    ['12.50', ',', 1250],
    ['12,5', ',', 1250],
    ['R$ 0,00', ',', 0],
    ['+3.000,00', ',', 300000],
    ['1.234.567,891', ',', 123456789],
    ['1.234.567,895', ',', 123456790],
    ['-1534.27', '.', -153427],
    ['abc', ',', null],
    ['', ',', null],
    ['1,2,3', ',', null],
  ] as const)('parseAmount(%j, %j) = %j', (text, decimal, cents) => {
    expect(parseAmount(text, decimal)).toBe(cents);
  });

  it('reads the calendar formats of the contract and rejects impossible dates', () => {
    expect(parseDate('05/10/2026', 'DD/MM/YYYY')).toBe('2026-10-05');
    expect(parseDate('05/10/26', 'DD/MM/YY')).toBe('2026-10-05');
    expect(parseDate('2026-10-05', 'YYYY-MM-DD')).toBe('2026-10-05');
    expect(parseDate('10/05/2026', 'MM/DD/YYYY')).toBe('2026-10-05');
    expect(parseDate('05/10/2026 14:33', 'DD/MM/YYYY')).toBe('2026-10-05');
    expect(parseDate('31/02/2026', 'DD/MM/YYYY')).toBeNull();
    expect(parseDate('05/10/0000', 'DD/MM/YYYY')).toBeNull();
    expect(detectDateFormat(['01/10/2026', '13/10/2026'])).toBe('DD/MM/YYYY');
    expect(detectDateFormat(['10/01/2026', '10/31/2026'])).toBe('MM/DD/YYYY');
    expect(detectDateFormat(['01/10/26'])).toBe('DD/MM/YY');
    expect(detectDateFormat(['2026-10-01'])).toBe('YYYY-MM-DD');
    expect(detectDateFormat(['ontem'])).toBeNull();
  });

  it('takes the OFX date as written in the file time zone', () => {
    expect(parseOfxDate('20261012000000.000[-03:EST]')).toBe('2026-10-12');
    expect(parseOfxDate('20261005120000[-3:BRT]')).toBe('2026-10-05');
    expect(parseOfxDate('20261005')).toBe('2026-10-05');
    expect(parseOfxDate('2026-10-05')).toBeNull();
    expect(parseOfxDate('20261340')).toBeNull();
  });
});

describe('description heuristics', () => {
  it('normalizes for matching and finds the significant prefix', () => {
    expect(normalizeDescription('UBER *TRIP HELP.UBER.COM 1234')).toBe('uber trip help uber com');
    expect(normalizeDescription('Pão de Açúcar — Loja 12')).toBe('pao de acucar loja');
    expect(significantPrefix('compra no debito padaria pao quente')).toBe('padaria pao');
    expect(significantPrefix('pix transf fulano')).toBe('fulano');
    expect(significantPrefix('pix enviado')).toBeNull();
    expect(significantPrefix('uber trip help uber com')).toBe('uber trip');
  });

  it('recognizes card bill payments on both sides', () => {
    for (const d of ['Pagamento recebido', 'PAGTO FATURA CARTAO OUROCARD', 'PAG FATURA NUBANK', 'Pagamento de fatura', 'PAGAMENTO EFETUADO', 'PGTO CARTAO CREDITO', 'Pagamento - Obrigado']) {
      expect(isCardBillPayment(d), d).toBe(true);
    }
    for (const d of ['Pagamento de boleto', 'Pix enviado', 'Pagamento conta de luz', 'Cartão Presente Loja']) {
      expect(isCardBillPayment(d), d).toBe(false);
    }
  });

  it('extracts installment hints', () => {
    expect(installmentHint('MAGAZINE EXEMPLO PARC 02/10', false)).toEqual({ number: 2, total: 10 });
    expect(installmentHint('Loja de Moveis - Parcela 2/10', false)).toEqual({ number: 2, total: 10 });
    expect(installmentHint('Notebook parcela 3 de 12', false)).toEqual({ number: 3, total: 12 });
    expect(installmentHint('LOJA EXEMPLO 03/06', true)).toEqual({ number: 3, total: 6 });
    expect(installmentHint('LOJA EXEMPLO 03/06', false)).toBeNull();
    expect(installmentHint('PIX 12/05', true)).toBeNull();
    expect(installmentHint('PARC 11/10', false)).toBeNull();
  });

  it('suggests payment methods, drops balance lines and cleans descriptions', () => {
    expect(paymentMethodHint('Pix enviado - Fulano')).toBe('pix');
    expect(paymentMethodHint('PAGTO TITULO BANCO X')).toBe('bank_slip');
    expect(paymentMethodHint('DEB AUTOMATICO LUZ')).toBe('auto_debit');
    expect(paymentMethodHint('TED RECEBIDA')).toBe('transfer');
    expect(paymentMethodHint('Compra no débito - Padaria')).toBe('debit_card');
    expect(paymentMethodHint('Mensalidade academia')).toBeNull();
    expect(isBalanceLine('Saldo Anterior')).toBe(true);
    expect(isBalanceLine('S A L D O')).toBe(true);
    expect(isBalanceLine('SALDO DO DIA')).toBe(true);
    expect(isBalanceLine('Saldão de móveis Exemplo')).toBe(false);
    expect(cleanDescription('  A\tB\u0000  C ')).toBe('A B C');
    expect(cleanDescription('x'.repeat(300))).toHaveLength(200);
  });
});

describe('OFX', () => {
  it('reads OFX 1.x (SGML) bank statements: unclosed tags, "," decimals, TRNTYPE, entities', () => {
    const content = fixture('bb-extrato-ofx1.ofx');
    expect(looksLikeOfx(content)).toBe(true);
    const st = parseOfx(content);
    expect(st).toMatchObject({
      kind: 'bank',
      institution: 'Banco do Brasil',
      accountHint: '7654',
      period: { from: '2026-10-01', to: '2026-10-15' },
    });
    expect(st.transactions.map((t) => [t.date, t.amount, t.fitId])).toEqual([
      ['2026-10-05', 520000, '20261005001'],
      ['2026-10-06', -8990, '20261006001'],
      ['2026-10-06', -8990, '20261006001'],
      ['2026-10-10', -153427, '20261010001'],
      ['2026-10-12', -15000, '20261012001'],
      ['2026-10-14', 0, '20261014001'],
    ]);
    // NAME + MEMO are combined unless one contains the other.
    expect(st.transactions[0]!.description).toBe('Pix recebido - SALARIO EMPRESA EXEMPLO LTDA');
    expect(st.transactions[4]!.description).toBe('Pix enviado - Joao Exemplo & Cia');
  });

  it('reads OFX 2.x (XML) credit card statements', () => {
    const st = parseOfx(fixture('nubank-fatura-ofx2.ofx'));
    expect(st).toMatchObject({
      kind: 'credit_card',
      institution: 'NU PAGAMENTOS S.A.',
      accountHint: '0041',
      period: { from: '2026-09-03', to: '2026-10-03' },
    });
    expect(st.transactions.map((t) => [t.amount, t.description])).toEqual([
      [-4590, 'Padaria Pao & Cia'],
      [-25000, 'Loja de Moveis - Parcela 2/10'],
      [153427, 'Pagamento recebido'],
      [1990, 'Estorno - Streaming Exemplo'],
      [-123456, 'Companhia Aerea Exemplo'],
    ]);
  });

  it('maps COMPE codes and refuses non-OFX content', () => {
    expect(bankFromCompe('0260')).toBe('nubank');
    expect(bankFromCompe('341')).toBe('itau');
    expect(bankFromCompe('999')).toBeNull();
    expect(() => parseOfx('data;valor')).toThrow(/OFX inválido/);
    expect(detectFormat('  ﻿OFXHEADER:100')).toBe('ofx');
    expect(detectFormat('Data;Valor')).toBe('csv');
  });
});

describe('CSV', () => {
  it('splits quoted fields with delimiters, doubled quotes and line breaks', () => {
    expect(splitCsv('a;"b;c";"d ""e"""\r\n"f\ng";h', ';')).toEqual([
      ['a', 'b;c', 'd "e"'],
      ['f\ng', 'h'],
    ]);
    expect(detectDelimiter('Data;Valor;Descrição\n01/10/2026;-1,00;x\n')).toBe(';');
    expect(detectDelimiter('date,title,amount\n2026-10-01,x,1.00\n')).toBe(',');
    expect(detectDelimiter('a\tb\tc\n1\t2\t3\n')).toBe('\t');
  });

  it('Nubank card invoice: BOM, positive purchases inverted, quoted commas', () => {
    const r = parseCsv(fixture('nubank-cartao.csv'));
    expect(r.institution).toBe('Nubank');
    expect(r.columns).toEqual(['date', 'title', 'amount']);
    expect(r.mapping).toMatchObject({
      delimiter: ',',
      hasHeader: true,
      dateColumn: 0,
      descriptionColumn: 1,
      amountColumn: 2,
      dateFormat: 'YYYY-MM-DD',
      decimalSeparator: '.',
      invertSign: true,
    });
    expect(csvMappingSchema.safeParse(r.mapping).success).toBe(true);
    expect(r.rows.map((x) => [x.date, x.amount, x.description])).toEqual([
      ['2026-09-05', -4590, 'Padaria Pao Quente'],
      ['2026-09-12', -25000, 'Loja de Moveis - Parcela 2/10'],
      ['2026-09-15', 153427, 'Pagamento recebido'],
      ['2026-09-20', -8840, 'Restaurante Sabor, Arte & Cia'],
      ['2026-09-20', -8840, 'Restaurante Sabor, Arte & Cia'],
    ]);
  });

  it('Nubank account: the "Identificador" column becomes the file id', () => {
    const r = parseCsv(fixture('nubank-conta.csv'));
    expect(r.mapping).toMatchObject({ dateColumn: 0, amountColumn: 1, idColumn: 2, descriptionColumn: 3, dateFormat: 'DD/MM/YYYY', decimalSeparator: '.', invertSign: false });
    expect(r.rows.map((x) => [x.amount, x.fileId])).toEqual([
      [520000, '6526e1f0-7a1b-4c2d-8e3f-000000000001'],
      [-3590, '6526e1f0-7a1b-4c2d-8e3f-000000000002'],
      [-120000, '6526e1f0-7a1b-4c2d-8e3f-000000000003'],
      [-153427, '6526e1f0-7a1b-4c2d-8e3f-000000000004'],
    ]);
  });

  it('Inter: preamble lines before the header, balance lines dropped, "," decimals', () => {
    const r = parseCsv(fixture('inter-extrato.csv'));
    expect(r.columns).toEqual(['Data Lançamento', 'Histórico', 'Descrição', 'Valor', 'Saldo']);
    expect(r.mapping).toMatchObject({ delimiter: ';', dateColumn: 0, descriptionColumn: 2, amountColumn: 3, decimalSeparator: ',' });
    expect(r.rows.map((x) => [x.date, x.amount, x.description])).toEqual([
      ['2026-10-02', 125000, 'Maria Exemplo'],
      ['2026-10-03', -8990, 'Mercado Central'],
      ['2026-10-04', -24513, 'Conta de Luz Exemplo'],
      ['2026-10-05', -3250, 'Farmacia Exemplo'],
    ]);
  });

  it('Bradesco and C6: separate credit/debit columns (signed or not)', () => {
    const b = parseCsv(fixture('bradesco-extrato.csv'));
    expect(b.mapping).toMatchObject({ amountColumn: null, creditColumn: 3, debitColumn: 4, descriptionColumn: 1 });
    expect(b.rows.map((x) => x.amount)).toEqual([50000, -12045, -3500]);

    const c6 = parseCsv(fixture('c6-extrato.csv'));
    expect(c6.mapping).toMatchObject({ delimiter: ',', dateColumn: 0, creditColumn: 4, debitColumn: 5, amountColumn: null });
    expect(c6.rows.map((x) => [x.amount, x.description])).toEqual([
      [30000, 'Pix recebido de Fulano'],
      [-12000, 'Pix enviado para Mercado Bom'],
      [-20050, 'Compra no débito - Posto Exemplo'],
    ]);
  });

  it('files without a header: columns guessed from the values', () => {
    const r = parseCsv(fixture('itau-sem-cabecalho.csv'));
    expect(r.columns).toEqual(['Coluna 1', 'Coluna 2', 'Coluna 3']);
    expect(r.mapping).toMatchObject({ hasHeader: false, dateColumn: 0, descriptionColumn: 1, amountColumn: 2, dateFormat: 'DD/MM/YY' });
    expect(r.rows.map((x) => x.amount)).toEqual([-15000, -21035, 300000]);
  });

  it('honors a mapping chosen by the user and reports unknown layouts without rows', () => {
    const custom = parseCsv(fixture('itau-sem-cabecalho.csv'), {
      delimiter: ';',
      hasHeader: false,
      dateColumn: 0,
      descriptionColumn: 1,
      amountColumn: 2,
      debitColumn: null,
      creditColumn: null,
      dateFormat: 'DD/MM/YY',
      decimalSeparator: ',',
      invertSign: true,
    });
    expect(custom.rows.map((x) => x.amount)).toEqual([15000, 21035, -300000]);
    expect(custom.mapping?.idColumn).toBeNull();

    const unknown = parseCsv('foo;bar\nx;y\n');
    expect(unknown.mapping).toBeNull();
    expect(unknown.rows).toEqual([]);
    expect(unknown.columns).toEqual(['foo', 'bar']);
  });
});

describe('externalId', () => {
  it('uses FITID / file ids, disambiguates repeats and is stable across parses', async () => {
    const ofx = await parseImportFile({ content: fixture('bb-extrato-ofx1.ofx') });
    expect(ofx.rows.map((r) => r.externalId).slice(0, 3)).toEqual(['fitid:20261005001', 'fitid:20261006001', 'fitid:20261006001#1']);
    const csv = await parseImportFile({ content: fixture('nubank-conta.csv') });
    expect(csv.rows[0]!.externalId).toBe('id:6526e1f0-7a1b-4c2d-8e3f-000000000001');
    expect(csv).toMatchObject({ format: 'csv', period: { from: '2026-10-01', to: '2026-10-05' } });

    const first = await parseImportFile({ content: fixture('nubank-cartao.csv') });
    const again = await parseImportFile({ content: fixture('nubank-cartao.csv') });
    expect(again.rows.map((r) => r.externalId)).toEqual(first.rows.map((r) => r.externalId));
    // Two identical purchases on the same day are two transactions (n-th occurrence in the hash).
    const [a, b] = [first.rows[3]!.externalId, first.rows[4]!.externalId];
    expect(a).toMatch(/^h:[0-9a-f]{40}$/);
    expect(a).not.toBe(b);
    // Whitespace/case/accents in the description do not change the hash.
    const tweaked = await parseImportFile({ content: fixture('nubank-cartao.csv').replace('Padaria Pao Quente', 'PADARIA  PÃO quente') });
    expect(tweaked.rows[0]!.externalId).toBe(first.rows[0]!.externalId);
  });
});
