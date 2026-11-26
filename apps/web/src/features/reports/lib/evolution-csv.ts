// "Exportar" of the Evolução report: a CSV that opens straight in Excel / Google Sheets (pt-BR).
import type { EvolutionGroup, EvolutionReportResponse, EvolutionRow } from '@effinance/shared';

const SEP = ';';

/** Cents → "1234,56" (no thousands separator, so spreadsheets read it as a number). */
export function csvMoney(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
}

/** Quotes when needed and defuses formula injection (=, +, -, @, tab, CR at the start). */
export function csvText(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function evolutionToCsv(report: EvolutionReportResponse): string {
  const lines: string[] = [];
  const line = (cells: string[]) => lines.push(cells.join(SEP));
  const numbers = (values: number[], total: number, average: number) => [...values.map(csvMoney), csvMoney(average), csvMoney(total)];

  line(['Grupo', 'Categoria', 'Subcategoria', ...report.periods.map((p) => csvText(p.label)), 'Média', 'Total']);
  const group = (label: string, g: EvolutionGroup) => {
    line([label, 'Total', '', ...numbers(g.values, g.total, g.average)]);
    const row = (r: EvolutionRow, parent?: EvolutionRow) =>
      line([label, csvText(parent ? parent.name : r.name), parent ? csvText(r.name) : '', ...numbers(r.values, r.total, r.average)]);
    for (const r of g.rows) {
      row(r);
      for (const child of r.children) row(child, r);
    }
  };
  group('Receitas', report.income);
  group('Despesas', report.expense);
  const resultTotal = report.result.reduce((a, b) => a + b, 0);
  line(['Resultado', '', '', ...numbers(report.result, resultTotal, Math.round(resultTotal / Math.max(1, report.activePeriods)))]);
  // BOM: Excel only detects UTF-8 (accents) with it.
  return `﻿${lines.join('\r\n')}\r\n`;
}

export function downloadText(content: string, filename: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
