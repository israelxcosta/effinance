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
import { evolutionLayout } from '../lib/evolution-layout';

type Kind = 'income' | 'expense';

const INTERVALS: { value: EvolutionInterval; label: string }[] = [
  { value: 'month', label: 'Mensal' },
  { value: 'quarter', label: 'Trimestral' },
  { value: 'year', label: 'Anual' },
];

/** Amount without "R$" (the column header already says it is money). */
const money = (cents: number) => formatBRL(cents).replace(/R\$\s?/, '').trim();
const noCents = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const moneyNoCents = (cents: number) => noCents.format(Math.round(cents / 100));
const pct = (part: number, whole: number) => `${((part / whole) * 100).toFixed(1).replace('.', ',')}%`;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const monthLabel = (iso: string) => `${MONTH_SHORT[Number(iso.slice(5, 7)) - 1]}/${iso.slice(2, 4)}`;

const cellBase = 'overflow-hidden px-2 text-right tabular whitespace-nowrap';

/**
 * Relatórios → Evolução: categories × periods (month, quarter or year), income and expense with
 * subcategories, % of the period's income, heat map on expenses, average/total and the result
 * line. It always fits its card (no horizontal scrollbar): see `evolutionLayout`. Dates follow the due date; installments count month by month.
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

function Matrix({ d, showPct, interval }: { d: EvolutionReportResponse; showPct: boolean; interval: EvolutionInterval }) {
  const navigate = useNavigate();
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const incomeTotals = d.income.values;
  const totalIncome = d.income.total;
  // Heat map scale: the biggest single expense cell among the categories.
  const heatMax = useMemo(() => Math.max(1, ...d.expense.rows.flatMap((r) => r.values)), [d]);

  // The table always fits the card: fewer cents, then fewer (older) periods as the screen narrows.
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const layout = evolutionLayout(width || 1200, d.periods.length);
  const first = d.periods.length - layout.visible;
  const cols = d.periods.map((_, i) => i).slice(first);
  const fmt = (cents: number) => (layout.cents ? money(cents) : moneyNoCents(cents));

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
    const share =
      kind === 'result'
        ? incomeTotals[i]
          ? `${Math.round((value / incomeTotals[i]!) * 100)}%${layout.cents ? ' guardado' : ''}`
          : null
        : showPct && !noShare && incomeTotals[i]
          ? pct(value, incomeTotals[i]!)
          : null;
    const content = (
      <>
        <span className={cn('block truncate text-label', (strong || kind === 'result') && 'font-semibold', color)}>
          {kind === 'result' && value > 0 ? '+' : ''}
          {fmt(value)}
        </span>
        {share ? <span className="block truncate text-2xs text-subtle">{share}</span> : null}
      </>
    );
    return (
      <td
        className={cn(cellBase, 'py-2', current && 'bg-brand-50/60')}
        style={tint ? { backgroundImage: `linear-gradient(color-mix(in srgb, var(--color-danger) ${tint}%, transparent), color-mix(in srgb, var(--color-danger) ${tint}%, transparent))` } : undefined}
        title={layout.cents ? undefined : formatBRL(value)}
      >
        {href ? (
          <button
            type="button"
            onClick={() => navigate(href)}
            className="-mx-1 -my-1 max-w-full rounded-md px-1 py-1 text-right outline-none hover:bg-black/5 focus-visible:ring-[3px] focus-visible:ring-brand-500/30"
            aria-label={`Ver lançamentos: ${formatBRL(value)}`}
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
    const narrow = layout.categoryWidth < 170;
    return (
      <>
        <tr className="group border-t border-border/70 hover:bg-bg-subtle/60">
          <th scope="row" className={cn('px-3 py-2 text-left font-normal sm:px-4', depth && (narrow ? 'pl-8' : 'pl-12'))}>
            <div className="flex min-w-0 items-center gap-2">
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
              ) : narrow ? null : (
                <CategoryIcon icon={row.icon} color={row.color} size="sm" className="!size-7 !rounded-md [&_svg]:!size-3.5" />
              )}
              <span className={cn('min-w-0 flex-1 truncate text-label', depth ? 'text-muted' : 'font-medium text-fg')} title={row.name}>
                {row.name}
              </span>
            </div>
          </th>
          {cols.map((i) => (
            <Value key={i} value={row.values[i]!} i={i} kind={kind} heat={kind === 'expense' && !depth} href={linkFor(kind, row, d.periods[i]!)} />
          ))}
          {layout.showAverage ? (
            <td className={cn(cellBase, 'border-l border-border bg-surface-muted py-2 text-label text-muted')}>{row.average ? fmt(row.average) : '—'}</td>
          ) : null}
          <td className={cn(cellBase, 'bg-surface-muted py-2 text-label font-semibold text-fg', !layout.showAverage && 'border-l border-border')}>
            <span className="block truncate">{fmt(row.total)}</span>
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
          <th scope="row" className={cn('px-3 py-3 text-left sm:px-4', soft)}>
            <div className="flex min-w-0 items-center gap-2.5">
              <span className={cn('h-5 w-1 shrink-0 rounded-full', kind === 'income' ? 'bg-success' : 'bg-danger')} aria-hidden />
              <span className="truncate text-label font-semibold text-fg">{label}</span>
              <span className="rounded-full bg-surface/80 px-1.5 text-2xs font-medium text-muted">{group.rows.length}</span>
            </div>
          </th>
          {cols.map((i) => (
            <Value key={i} value={group.values[i]!} i={i} kind={kind} strong noShare={kind === 'income'} />
          ))}
          {layout.showAverage ? <td className={cn(cellBase, 'border-l border-border py-3 text-label font-semibold', soft, text)}>{fmt(group.average)}</td> : null}
          <td className={cn(cellBase, 'py-3 text-label font-semibold', soft, text, !layout.showAverage && 'border-l border-border')}>{fmt(group.total)}</td>
        </tr>
        {group.rows.map((r) => (
          <CategoryRow key={r.categoryId ?? 'none'} row={r} kind={kind} />
        ))}
      </>
    );
  }

  const resultTotal = sum(d.result);
  const resultTone = resultTotal >= 0 ? 'text-success' : 'text-danger';
  return (
    <div ref={boxRef} className="w-full">
      {layout.visible < d.periods.length ? (
        <p className="border-b border-border bg-brand-50/60 px-4 py-2 text-xs text-brand-text">
          {layout.visible === 1 ? 'Mostrando só o último período' : `Mostrando os últimos ${layout.visible} períodos`} para caber na tela. Média e Total consideram todo o período
          escolhido; use Trimestral ou Anual para ver tudo de uma vez.
        </p>
      ) : null}
      <table className="w-full table-fixed border-collapse">
        <colgroup>
          <col style={{ width: layout.categoryWidth }} />
          {cols.map((i) => (
            <col key={i} />
          ))}
          {layout.showAverage ? <col style={{ width: 96 }} /> : null}
          <col style={{ width: 104 }} />
        </colgroup>
        <thead>
          <tr className="bg-surface-muted">
            <th scope="col" className="px-3 py-2.5 text-left text-2xs font-semibold tracking-[0.08em] text-subtle uppercase sm:px-4">
              Categoria
            </th>
            {cols.map((i) => {
              const p = d.periods[i]!;
              return (
                <th key={p.key} scope="col" className={cn('truncate px-2 py-2.5 text-right text-xs font-semibold text-muted', p.current && 'bg-brand-50 text-brand-text')}>
                  {p.label}
                  {p.current ? <span className="block text-2xs font-medium text-brand-text/70">parcial</span> : null}
                </th>
              );
            })}
            {layout.showAverage ? <th scope="col" className="border-l border-border px-2 py-2.5 text-right text-xs font-semibold text-muted">Média</th> : null}
            <th scope="col" className={cn('px-2 py-2.5 text-right text-xs font-semibold text-fg', !layout.showAverage && 'border-l border-border')}>
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
            <th scope="row" className="px-3 py-3 text-left sm:px-4">
              <span className="block truncate text-sm font-semibold text-fg">Resultado</span>
              <span className="block truncate text-2xs font-normal text-subtle">receitas − despesas</span>
            </th>
            {cols.map((i) => (
              <Value key={i} value={d.result[i]!} i={i} kind="result" />
            ))}
            {layout.showAverage ? (
              <td className={cn(cellBase, 'border-l border-border py-3 text-label font-semibold', resultTone)}>
                {resultTotal > 0 ? '+' : ''}
                {fmt(Math.round(resultTotal / Math.max(1, d.activePeriods)))}
              </td>
            ) : null}
            <td className={cn(cellBase, 'py-3 text-sm font-semibold', resultTone, !layout.showAverage && 'border-l border-border')}>
              {resultTotal > 0 ? '+' : ''}
              {fmt(resultTotal)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
