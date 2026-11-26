import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { ChartNoAxesColumn, ChevronDown, ChevronRight, Download, Percent } from 'lucide-react';
import {
  MONTH_SHORT,
  formatBRL,
  type EvolutionGroup,
  type EvolutionInterval,
  type EvolutionPeriod,
  type EvolutionReportResponse,
  type EvolutionRow,
} from '@effinance/shared';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { CategoryIcon } from '@/components/ui/category-icon';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/misc';
import { Skeleton } from '@/components/ui/skeleton';
import { useActiveMonth } from '@/lib/active-month';
import { useEvolutionReport } from '../api';
import { downloadText, evolutionToCsv } from '../lib/evolution-csv';

type Kind = 'income' | 'expense';

const INTERVALS: { value: EvolutionInterval; label: string }[] = [
  { value: 'month', label: 'Mensal' },
  { value: 'quarter', label: 'Trimestral' },
  { value: 'year', label: 'Anual' },
];

/** Amount without "R$" (the column header already says it is money). */
const money = (cents: number) => formatBRL(cents).replace(/R\$\s?/, '').trim();
const pct = (part: number, whole: number) => `${((part / whole) * 100).toFixed(1).replace('.', ',')}%`;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const monthLabel = (iso: string) => `${MONTH_SHORT[Number(iso.slice(5, 7)) - 1]}/${iso.slice(2, 4)}`;

// Average and Total stay pinned on the right while the periods scroll.
const PIN_AVG = 'sticky right-[112px] z-10 w-[104px] min-w-[104px] border-l border-border shadow-[-8px_0_12px_-10px_rgba(0,0,0,0.18)]';
const PIN_TOTAL = 'sticky right-0 z-10 w-[112px] min-w-[112px]';
const cellBase = 'px-2.5 text-right tabular whitespace-nowrap';

/**
 * Relatórios → Evolução: categories × periods (month, quarter or year), income and expense with
 * subcategories, % of the period's income, heat map on expenses, pinned average/total and the
 * result line. Dates follow the due date; installments count month by month.
 */
export function EvolutionTab() {
  const [activeMonth] = useActiveMonth();
  const [interval, setInterval] = useState<EvolutionInterval>('month');
  const [months, setMonths] = useState(12);
  const [showPct, setShowPct] = useState(true);
  const report = useEvolutionReport({ to: activeMonth, months, interval });
  const d = report.data;

  if (report.isError) return <ErrorState error={report.error} onRetry={() => report.refetch()} />;

  const empty = d && d.income.rows.length === 0 && d.expense.rows.length === 0;
  const range = d ? `${monthLabel(d.periods[0]!.start)} – ${monthLabel(d.periods[d.periods.length - 1]!.end)}` : '';

  return (
    <div className="flex flex-col gap-4">
      <Totals d={d} interval={interval} />

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
          <div>
            <h2 className="text-title font-semibold tracking-tight text-fg">Evolução por categoria</h2>
            <p className="mt-0.5 text-xs text-muted">
              {range ? `${range} · ` : ''}valores pelo vencimento · parceladas mês a mês
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl ariaLabel="Intervalo" value={interval} onChange={setInterval} options={INTERVALS} />
            <Select aria-label="Período" value={String(months)} onChange={(e) => setMonths(Number(e.target.value))} className="h-10 w-[170px]" size_="sm">
              <option value="6">Últimos 6 meses</option>
              <option value="12">Últimos 12 meses</option>
              <option value="24">Últimos 24 meses</option>
              <option value="36">Últimos 36 meses</option>
            </Select>
            <Button variant={showPct ? 'soft' : 'outline'} onClick={() => setShowPct((s) => !s)} aria-pressed={showPct}>
              <Percent /> da receita
            </Button>
            <Button
              variant="outline"
              disabled={!d || empty}
              onClick={() => d && downloadText(evolutionToCsv(d), `effinance-evolucao-${d.periods[0]!.start.slice(0, 7)}-a-${activeMonth}.csv`)}
            >
              <Download /> Exportar
            </Button>
          </div>
        </div>

        {!d ? (
          <div className="flex flex-col gap-2 p-4">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : empty ? (
          <EmptyState
            icon={<ChartNoAxesColumn />}
            title="Nada lançado neste período"
            description="Assim que houver receitas ou despesas, a evolução por categoria aparece aqui."
            className="py-14"
          />
        ) : (
          <Matrix d={d} showPct={showPct} interval={interval} />
        )}

        {d && !empty ? (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-border bg-surface-muted px-4 py-2.5 text-xs text-muted">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-3 rounded-sm" style={{ background: 'color-mix(in srgb, var(--color-danger) 14%, transparent)' }} aria-hidden />
              mais forte = maior gasto
            </span>
            <span>— sem lançamentos</span>
            {showPct ? <span>% = parte da receita do período</span> : null}
            {interval !== 'quarter' ? <span className="ml-auto">Clique num valor para ver os lançamentos</span> : null}
          </div>
        ) : null}
      </Card>
    </div>
  );
}

function Totals({ d, interval }: { d: EvolutionReportResponse | undefined; interval: EvolutionInterval }) {
  const income = d?.income.total ?? 0;
  const expense = d?.expense.total ?? 0;
  const result = income - expense;
  const positive = d ? d.result.filter((r) => r > 0).length : 0;
  const active = d?.activePeriods ?? 0;
  const unit = interval === 'month' ? (active === 1 ? 'mês' : 'meses') : active === 1 ? 'período' : 'períodos';
  const per = interval === 'month' ? 'mês' : interval === 'quarter' ? 'trimestre' : 'ano';
  const cards = [
    { label: 'Receitas no período', value: formatBRL(income), tone: 'text-success', hint: d ? `média ${formatBRL(d.income.average)} por ${per}` : '' },
    { label: 'Despesas no período', value: formatBRL(expense), tone: 'text-danger', hint: d ? `média ${formatBRL(d.expense.average)} por ${per}` : '' },
    {
      label: 'Resultado',
      value: `${result > 0 ? '+' : ''}${formatBRL(result)}`,
      tone: result >= 0 ? 'text-success' : 'text-danger',
      hint: d ? `${positive} de ${active} ${unit} positivos` : '',
    },
    { label: 'Taxa de economia', value: income > 0 ? pct(result, income) : '—', tone: 'text-fg', hint: 'meta recomendada: 20%' },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map((k) => (
        <Card key={k.label} className="p-4">
          <p className="text-label font-medium text-muted">{k.label}</p>
          {d ? (
            <>
              <p className={cn('tabular mt-1.5 text-right text-lg font-semibold', k.tone)}>{k.value}</p>
              <p className="mt-0.5 text-right text-xs text-subtle">{k.hint}</p>
            </>
          ) : (
            <Skeleton className="mt-2 ml-auto h-7 w-32" />
          )}
        </Card>
      ))}
    </div>
  );
}

function Spark({ values, tone }: { values: number[]; tone: 'success' | 'danger' | 'brand' }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const points = values.map((x, i) => [(i / (values.length - 1)) * 72, 20 - ((x - min) / span) * 18] as const);
  const stroke = tone === 'success' ? 'var(--color-success)' : tone === 'danger' ? 'var(--color-danger)' : 'var(--color-brand-500)';
  const last = points[points.length - 1]!;
  return (
    <svg width="60" height="22" viewBox="0 0 72 22" aria-hidden className="shrink-0 overflow-visible">
      <polyline points={points.map((p) => p.join(',')).join(' ')} fill="none" stroke={stroke} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="2.2" fill={stroke} />
    </svg>
  );
}

function Matrix({ d, showPct, interval }: { d: EvolutionReportResponse; showPct: boolean; interval: EvolutionInterval }) {
  const navigate = useNavigate();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const incomeTotals = d.income.values;
  const totalIncome = d.income.total;
  // Heat map scale: the biggest single expense cell among the categories.
  const heatMax = useMemo(() => Math.max(1, ...d.expense.rows.flatMap((r) => r.values)), [d]);

  // Opens on the most recent periods; older ones are a scroll away.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [d.periods.length, d.periods[0]?.key]);

  function linkFor(kind: Kind, row: EvolutionRow, period: EvolutionPeriod): string | null {
    if (!row.categoryId || interval === 'quarter') return null;
    const base = kind === 'expense' ? '/contas-a-pagar' : '/contas-a-receber';
    const when = interval === 'year' ? `modo=year&data=${period.start.slice(0, 4)}-01-01` : `data=${period.start}`;
    return `${base}?categoria=${row.categoryId}&${when}`;
  }

  function toggle(key: string) {
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function Value({ value, i, kind, strong, heat, href, noShare }: { value: number; i: number; kind: Kind | 'result'; strong?: boolean; heat?: boolean; href?: string | null; noShare?: boolean }) {
    const current = d.periods[i]!.current;
    if (value === 0) {
      return (
        <td className={cn(cellBase, 'py-2', current && 'bg-brand-50/60')}>
          <span className="text-subtle/60">—</span>
        </td>
      );
    }
    const tint = heat ? Math.min(16, 3 + (value / heatMax) * 13) : 0;
    const color =
      kind === 'result' ? (value >= 0 ? 'text-success' : 'text-danger') : strong ? (kind === 'income' ? 'text-success' : 'text-danger') : 'text-fg';
    const share = kind === 'result' ? (incomeTotals[i] ? `${Math.round((value / incomeTotals[i]!) * 100)}% guardado` : null) : showPct && !noShare && incomeTotals[i] ? pct(value, incomeTotals[i]!) : null;
    const content = (
      <>
        <span className={cn('block', kind === 'result' ? 'text-label font-semibold' : 'text-label', strong && 'font-semibold', color)}>
          {kind === 'result' && value > 0 ? '+' : ''}
          {money(value)}
        </span>
        {share ? <span className="block text-2xs text-subtle">{share}</span> : null}
      </>
    );
    return (
      <td
        className={cn(cellBase, 'py-2', current && 'bg-brand-50/60')}
        style={tint ? { backgroundImage: `linear-gradient(color-mix(in srgb, var(--color-danger) ${tint}%, transparent), color-mix(in srgb, var(--color-danger) ${tint}%, transparent))` } : undefined}
      >
        {href ? (
          <button
            type="button"
            onClick={() => navigate(href)}
            className="-mx-1.5 -my-1 rounded-md px-1.5 py-1 text-right outline-none hover:bg-black/5 focus-visible:ring-[3px] focus-visible:ring-brand-500/30"
            aria-label={`Ver lançamentos: ${money(value)}`}
          >
            {content}
          </button>
        ) : (
          content
        )}
      </td>
    );
  }

  function CategoryRow({ row, kind, parent }: { row: EvolutionRow; kind: Kind; parent?: EvolutionRow }) {
    const key = `${kind}:${row.categoryId ?? 'none'}`;
    const expandable = row.children.length > 0;
    const isOpen = open.has(key);
    const depth = parent ? 1 : 0;
    return (
      <>
        <tr className="group border-t border-border/70 hover:bg-bg-subtle/60">
          <th scope="row" className={cn('sticky left-0 z-10 bg-surface px-4 py-2 text-left font-normal group-hover:bg-bg-subtle', depth && 'pl-12')}>
            <div className="flex items-center gap-2.5">
              {expandable ? (
                <button
                  type="button"
                  onClick={() => toggle(key)}
                  aria-expanded={isOpen}
                  aria-label={`${isOpen ? 'Recolher' : 'Mostrar'} subcategorias de ${row.name}`}
                  className="-ml-1 grid size-5 shrink-0 place-items-center rounded text-muted hover:bg-bg-subtle hover:text-fg"
                >
                  {isOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                </button>
              ) : depth ? null : (
                <span className="w-4 shrink-0" />
              )}
              {depth ? (
                <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: row.color }} aria-hidden />
              ) : (
                <CategoryIcon icon={row.icon} color={row.color} size="sm" className="!size-7 !rounded-md [&_svg]:!size-3.5" />
              )}
              <span className={cn('min-w-0 flex-1 truncate text-label', depth ? 'text-muted' : 'font-medium text-fg')} title={row.name}>
                {row.name}
              </span>
              {depth ? null : <Spark values={row.values} tone={kind === 'income' ? 'success' : 'brand'} />}
            </div>
          </th>
          {row.values.map((x, i) => (
            <Value key={i} value={x} i={i} kind={kind} heat={kind === 'expense' && !depth} href={linkFor(kind, row, d.periods[i]!)} />
          ))}
          <td className={cn(cellBase, PIN_AVG, 'bg-surface-muted py-2 text-label text-muted')}>{row.average ? money(row.average) : '—'}</td>
          <td className={cn(cellBase, PIN_TOTAL, 'bg-surface-muted py-2 text-label font-semibold text-fg')}>
            {money(row.total)}
            {showPct && totalIncome ? <span className="block text-2xs font-normal text-subtle">{pct(row.total, totalIncome)}</span> : null}
          </td>
        </tr>
        {expandable && isOpen ? row.children.map((c) => <CategoryRow key={c.categoryId ?? 'none'} row={c} kind={kind} parent={row} />) : null}
      </>
    );
  }

  function GroupRows({ label, group, kind }: { label: string; group: EvolutionGroup; kind: Kind }) {
    const soft = kind === 'income' ? 'bg-success-soft' : 'bg-danger-soft';
    const text = kind === 'income' ? 'text-success' : 'text-danger';
    return (
      <>
        <tr className={cn('border-t border-border', kind === 'income' ? 'bg-success-soft/60' : 'bg-danger-soft/60')}>
          <th scope="row" className={cn('sticky left-0 z-10 px-4 py-3 text-left', soft)}>
            <div className="flex items-center gap-2.5">
              <span className={cn('h-5 w-1 shrink-0 rounded-full', kind === 'income' ? 'bg-success' : 'bg-danger')} aria-hidden />
              <span className="text-label font-semibold text-fg">{label}</span>
              <span className="rounded-full bg-surface/80 px-1.5 text-2xs font-medium text-muted">{group.rows.length}</span>
              <span className="ml-auto">
                <Spark values={group.values} tone={kind === 'income' ? 'success' : 'danger'} />
              </span>
            </div>
          </th>
          {group.values.map((x, i) => (
            <Value key={i} value={x} i={i} kind={kind} strong noShare={kind === 'income'} />
          ))}
          <td className={cn(cellBase, PIN_AVG, soft, text, 'py-3 text-label font-semibold')}>{money(group.average)}</td>
          <td className={cn(cellBase, PIN_TOTAL, soft, text, 'py-3 text-label font-semibold')}>{money(group.total)}</td>
        </tr>
        {group.rows.map((r) => (
          <CategoryRow key={r.categoryId ?? 'none'} row={r} kind={kind} />
        ))}
      </>
    );
  }

  const resultTotal = sum(d.result);
  return (
    <div ref={scrollRef} className="scrollbar-thin overflow-x-auto">
      <table className="w-full border-collapse" style={{ minWidth: 260 + 216 + d.periods.length * 100 }}>
        <thead>
          <tr className="bg-surface-muted">
            <th scope="col" className="sticky left-0 z-20 w-[260px] min-w-[260px] bg-surface-muted px-4 py-2.5 text-left text-2xs font-semibold tracking-[0.08em] text-subtle uppercase">
              Categoria
            </th>
            {d.periods.map((p) => (
              <th key={p.key} scope="col" className={cn('px-2.5 py-2.5 text-right text-xs font-semibold whitespace-nowrap text-muted', p.current && 'bg-brand-50 text-brand-text')}>
                {p.label}
                {p.current ? <span className="block text-2xs font-medium text-brand-text/70">parcial</span> : null}
              </th>
            ))}
            <th scope="col" className={cn(PIN_AVG, 'bg-surface-muted px-2.5 py-2.5 text-right text-xs font-semibold text-muted')}>
              Média
            </th>
            <th scope="col" className={cn(PIN_TOTAL, 'bg-surface-muted px-2.5 py-2.5 text-right text-xs font-semibold text-fg')}>
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {d.income.rows.length ? <GroupRows label="Receitas" group={d.income} kind="income" /> : null}
          {d.expense.rows.length ? <GroupRows label="Despesas" group={d.expense} kind="expense" /> : null}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-border-strong bg-surface">
            <th scope="row" className="sticky left-0 z-10 bg-surface px-4 py-3 text-left">
              <div className="flex items-center gap-2.5">
                <div className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-fg">Resultado</span>
                  <span className="block text-2xs font-normal text-subtle">receitas − despesas</span>
                </div>
                <Spark values={d.result} tone={resultTotal >= 0 ? 'success' : 'danger'} />
              </div>
            </th>
            {d.result.map((x, i) => (
              <Value key={i} value={x} i={i} kind="result" />
            ))}
            <td className={cn(cellBase, PIN_AVG, 'bg-surface py-3 text-label font-semibold', resultTotal >= 0 ? 'text-success' : 'text-danger')}>
              {resultTotal > 0 ? '+' : ''}
              {money(Math.round(resultTotal / Math.max(1, d.activePeriods)))}
            </td>
            <td className={cn(cellBase, PIN_TOTAL, 'bg-surface py-3 text-sm font-semibold', resultTotal >= 0 ? 'text-success' : 'text-danger')}>
              {resultTotal > 0 ? '+' : ''}
              {money(resultTotal)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
