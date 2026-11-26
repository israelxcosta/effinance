// PROTÓTIPO VISUAL (dados fictícios) — só para aprovação do layout; não vai para o commit.
import { useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Download, Percent } from 'lucide-react';
import { formatBRL } from '@effinance/shared';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { CategoryIcon } from '@/components/ui/category-icon';

const MONTHS = ['Dez/25', 'Jan/26', 'Fev/26', 'Mar/26', 'Abr/26', 'Mai/26', 'Jun/26', 'Jul/26', 'Ago/26', 'Set/26', 'Out/26', 'Nov/26'];
const CURRENT = 11;

interface Row {
  name: string;
  icon: string;
  color: string;
  values: number[];
  children?: Row[];
}

const v = (...xs: number[]) => xs.map((x) => Math.round(x * 100));

const INCOME: Row[] = [
  { name: 'Salário', icon: 'briefcase', color: '#12A150', values: v(8500, 8500, 8500, 8500, 8500, 8500, 8500, 8500, 8500, 8500, 8500, 8500) },
  { name: 'Pró-labore', icon: 'wallet', color: '#0EA5E9', values: v(0, 0, 0, 0, 0, 0, 0, 0, 0, 5693, 0, 0) },
  { name: 'Freelance', icon: 'laptop', color: '#8B5CF6', values: v(1200, 0, 2400, 0, 800, 0, 1500, 0, 0, 0, 2100, 3800) },
  { name: 'Rendimentos', icon: 'trending-up', color: '#0F766E', values: v(185, 190, 192, 201, 205, 210, 214, 220, 226, 230, 238, 245) },
];

const EXPENSE: Row[] = [
  { name: 'Moradia', icon: 'house', color: '#152B61', values: v(3142, 3142, 3142, 3142, 3142, 3142, 3260, 3260, 3260, 3260, 3260, 3400) },
  {
    name: 'Alimentação',
    icon: 'utensils',
    color: '#F97316',
    values: v(1420, 1180, 1250, 1390, 1310, 1280, 1460, 1370, 1290, 1340, 1410, 1075),
    children: [
      { name: 'Mercado', icon: 'shopping-cart', color: '#F97316', values: v(820, 760, 790, 850, 800, 780, 860, 820, 790, 810, 830, 640) },
      { name: 'Restaurantes', icon: 'utensils', color: '#F97316', values: v(380, 270, 300, 330, 310, 300, 380, 340, 300, 320, 360, 250) },
      { name: 'Delivery', icon: 'bike', color: '#F97316', values: v(220, 150, 160, 210, 200, 200, 220, 210, 200, 210, 220, 185) },
    ],
  },
  { name: 'Transporte', icon: 'car', color: '#3F64BE', values: v(690, 640, 610, 720, 680, 650, 700, 740, 690, 660, 710, 520) },
  { name: 'Saúde', icon: 'heart-pulse', color: '#E5484D', values: v(410, 380, 1250, 420, 400, 390, 450, 430, 708, 690, 708, 1077) },
  { name: 'Educação', icon: 'graduation-cap', color: '#7C3AED', values: v(530, 530, 530, 530, 530, 530, 530, 530, 530, 530, 530, 530) },
  { name: 'Lazer', icon: 'film', color: '#EC4899', values: v(320, 180, 240, 560, 210, 190, 880, 260, 230, 300, 280, 150) },
  { name: 'Assinaturas', icon: 'tv', color: '#64748B', values: v(129, 129, 129, 129, 145, 145, 145, 145, 145, 145, 145, 145) },
  { name: 'Pets', icon: 'paw-print', color: '#78716C', values: v(106, 0, 103, 0, 98, 0, 103, 0, 106, 103, 0, 0) },
];

const sumCols = (rows: Row[]) => MONTHS.map((_, i) => rows.reduce((a, r) => a + r.values[i]!, 0));
const total = (xs: number[]) => xs.reduce((a, x) => a + x, 0);
const avg = (xs: number[]) => Math.round(total(xs) / xs.length);
const money = (c: number) => formatBRL(c).replace('R$', '').trim();

const incomeTotals = sumCols(INCOME);
const expenseTotals = sumCols(EXPENSE);
const result = MONTHS.map((_, i) => incomeTotals[i]! - expenseTotals[i]!);

function Spark({ values, tone }: { values: number[]; tone: 'success' | 'danger' | 'brand' }) {
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const pts = values.map((x, i) => `${(i / (values.length - 1)) * 72},${22 - ((x - min) / (max - min || 1)) * 18 - 2}`).join(' ');
  const stroke = tone === 'success' ? 'var(--color-success)' : tone === 'danger' ? 'var(--color-danger)' : 'var(--color-brand-500)';
  return (
    <svg width="60" height="22" viewBox="0 0 72 22" aria-hidden className="overflow-visible">
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx="72" cy={pts.split(' ').at(-1)!.split(',')[1]} r="2.2" fill={stroke} />
    </svg>
  );
}

const cellBase = 'px-2.5 text-right tabular whitespace-nowrap';

export function EvolutionMock() {
  const [interval, setInterval] = useState<'month' | 'quarter' | 'year'>('month');
  const [showPct, setShowPct] = useState(true);
  const [open, setOpen] = useState<Set<string>>(new Set(['Alimentação']));
  const scrollRef = useRef<HTMLDivElement>(null);
  // Opens on the most recent months; older ones are a scroll away.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, []);
  const totalIncome = total(incomeTotals);
  const totalExpense = total(expenseTotals);

  function Cell({ value, i, kind, pctOf, strong, heat }: { value: number; i: number; kind: 'income' | 'expense' | 'result'; pctOf?: number; strong?: boolean; heat?: number }) {
    const zero = value === 0;
    const tint = heat && !zero ? Math.min(0.16, 0.03 + heat * 0.13) : 0;
    return (
      <td
        className={cn(cellBase, 'py-2', i === CURRENT && 'bg-brand-50/60')}
        style={tint ? { backgroundImage: `linear-gradient(color-mix(in srgb, var(--color-danger) ${tint * 100}%, transparent), color-mix(in srgb, var(--color-danger) ${tint * 100}%, transparent))` } : undefined}
      >
        {zero ? (
          <span className="text-subtle/60">—</span>
        ) : (
          <>
            <span
              className={cn(
                'block text-label',
                strong && 'font-semibold',
                kind === 'result' ? (value >= 0 ? 'text-success' : 'text-danger') : strong ? (kind === 'income' ? 'text-success' : 'text-danger') : 'text-fg',
              )}
            >
              {kind === 'result' && value > 0 ? '+' : ''}
              {money(value)}
            </span>
            {showPct && pctOf ? <span className="block text-2xs text-subtle">{((value / pctOf) * 100).toFixed(1).replace('.', ',')}%</span> : null}
          </>
        )}
      </td>
    );
  }

  function CategoryRow({ row, kind, depth = 0 }: { row: Row; kind: 'income' | 'expense'; depth?: number }) {
    const expandable = !!row.children?.length;
    const isOpen = open.has(row.name);
    const rowMax = Math.max(...EXPENSE.flatMap((r) => r.values));
    return (
      <>
        <tr className="group border-t border-border/70 hover:bg-bg-subtle/60">
          <th scope="row" className={cn('sticky left-0 z-10 bg-surface px-4 py-2 text-left font-normal group-hover:bg-bg-subtle', depth && 'pl-12')}>
            <div className="flex items-center gap-2.5">
              {expandable ? (
                <button
                  type="button"
                  onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(row.name)) n.delete(row.name); else n.add(row.name); return n; })}
                  className="-ml-1 grid size-5 place-items-center rounded text-muted hover:bg-bg-subtle hover:text-fg"
                  aria-label={isOpen ? 'Recolher' : 'Expandir'}
                >
                  {isOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                </button>
              ) : depth ? null : (
                <span className="w-4" />
              )}
              {depth ? (
                <span className="size-1.5 rounded-full" style={{ backgroundColor: row.color }} />
              ) : (
                <CategoryIcon icon={row.icon} color={row.color} size="sm" className="!size-7 !rounded-md [&_svg]:!size-3.5" />
              )}
              <span className={cn('min-w-0 flex-1 truncate text-label', depth ? 'text-muted' : 'font-medium text-fg')}>{row.name}</span>
              {depth ? null : <Spark values={row.values} tone={kind === 'income' ? 'success' : 'brand'} />}
            </div>
          </th>
          {row.values.map((x, i) => (
            <Cell key={i} value={x} i={i} kind={kind} pctOf={incomeTotals[i]} heat={kind === 'expense' && !depth ? x / rowMax : undefined} />
          ))}
          <td className={cn(cellBase, 'sticky right-[112px] z-10 w-[104px] min-w-[104px] border-l border-border shadow-[-8px_0_12px_-10px_rgba(0,0,0,0.18)] bg-surface-muted py-2 text-label text-muted')}>{money(avg(row.values))}</td>
          <td className={cn(cellBase, 'sticky right-0 z-10 w-[112px] min-w-[112px] bg-surface-muted py-2 text-label font-semibold text-fg')}>
            {money(total(row.values))}
            {showPct ? <span className="block text-2xs font-normal text-subtle">{((total(row.values) / totalIncome) * 100).toFixed(1).replace('.', ',')}%</span> : null}
          </td>
        </tr>
        {expandable && isOpen ? row.children!.map((c) => <CategoryRow key={c.name} row={c} kind={kind} depth={1} />) : null}
      </>
    );
  }

  function GroupRow({ label, values, kind }: { label: string; values: number[]; kind: 'income' | 'expense' }) {
    const tone = kind === 'income' ? 'success' : 'danger';
    return (
      <tr className={cn('border-t border-border', kind === 'income' ? 'bg-success-soft/60' : 'bg-danger-soft/60')}>
        <th scope="row" className={cn('sticky left-0 z-10 px-4 py-3 text-left', kind === 'income' ? 'bg-success-soft' : 'bg-danger-soft')}>
          <div className="flex items-center gap-2.5">
            <span className={cn('h-5 w-1 rounded-full', kind === 'income' ? 'bg-success' : 'bg-danger')} />
            <span className="text-label font-semibold text-fg">{label}</span>
            <span className="rounded-full bg-surface/80 px-1.5 text-2xs font-medium text-muted">{kind === 'income' ? INCOME.length : EXPENSE.length}</span>
            <span className="ml-auto"><Spark values={values} tone={tone} /></span>
          </div>
        </th>
        {values.map((x, i) => (
          <Cell key={i} value={x} i={i} kind={kind} strong pctOf={kind === 'expense' ? incomeTotals[i] : undefined} />
        ))}
        <td className={cn(cellBase, 'sticky right-[112px] z-10 w-[104px] min-w-[104px] border-l border-border shadow-[-8px_0_12px_-10px_rgba(0,0,0,0.18)] py-3 text-label font-semibold', kind === 'income' ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger')}>{money(avg(values))}</td>
        <td className={cn(cellBase, 'sticky right-0 z-10 w-[112px] min-w-[112px] py-3 text-label font-semibold', kind === 'income' ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger')}>{money(total(values))}</td>
      </tr>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Period totals */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Receitas no período', value: formatBRL(totalIncome), tone: 'text-success', hint: `média ${formatBRL(avg(incomeTotals))}/mês` },
          { label: 'Despesas no período', value: formatBRL(totalExpense), tone: 'text-danger', hint: `média ${formatBRL(avg(expenseTotals))}/mês` },
          { label: 'Resultado', value: `+${formatBRL(totalIncome - totalExpense)}`, tone: 'text-success', hint: '10 de 12 meses positivos' },
          { label: 'Taxa de economia', value: `${(((totalIncome - totalExpense) / totalIncome) * 100).toFixed(1).replace('.', ',')}%`, tone: 'text-fg', hint: 'meta recomendada: 20%' },
        ].map((k) => (
          <Card key={k.label} className="p-4">
            <p className="text-label font-medium text-muted">{k.label}</p>
            <p className={cn('tabular mt-1.5 text-right text-lg font-semibold', k.tone)}>{k.value}</p>
            <p className="mt-0.5 text-right text-xs text-subtle">{k.hint}</p>
          </Card>
        ))}
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
          <div>
            <h2 className="text-title font-semibold tracking-tight text-fg">Evolução por categoria</h2>
            <p className="mt-0.5 text-xs text-muted">Dez/25 – Nov/26 · valores pelo vencimento · parceladas mês a mês</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl
              ariaLabel="Intervalo"
              value={interval}
              onChange={setInterval}
              options={[
                { value: 'month', label: 'Mensal' },
                { value: 'quarter', label: 'Trimestral' },
                { value: 'year', label: 'Anual' },
              ]}
            />
            <Select aria-label="Período" defaultValue="12" size_="sm" className="h-10 w-[140px]">
              <option value="6">Últimos 6 meses</option>
              <option value="12">Últimos 12 meses</option>
              <option value="24">Últimos 24 meses</option>
            </Select>
            <Button variant={showPct ? 'soft' : 'outline'} onClick={() => setShowPct((s) => !s)} aria-pressed={showPct}>
              <Percent /> da receita
            </Button>
            <Button variant="outline">
              <Download /> Exportar
            </Button>
          </div>
        </div>

        <div ref={scrollRef} className="scrollbar-thin overflow-x-auto">
          <table className="w-full min-w-[1200px] border-collapse">
            <thead>
              <tr className="bg-surface-muted">
                <th scope="col" className="sticky left-0 z-20 w-[260px] min-w-[260px] bg-surface-muted px-4 py-2.5 text-left text-2xs font-semibold tracking-[0.08em] text-subtle uppercase">
                  Categoria
                </th>
                {MONTHS.map((m, i) => (
                  <th key={m} scope="col" className={cn('px-2.5 py-2.5 text-right text-xs font-semibold text-muted', i === CURRENT && 'bg-brand-50 text-brand-text')}>
                    {m}
                    {i === CURRENT ? <span className="block text-2xs font-medium text-brand-text/70">parcial</span> : null}
                  </th>
                ))}
                <th scope="col" className="sticky right-[112px] z-10 w-[104px] min-w-[104px] border-l border-border shadow-[-8px_0_12px_-10px_rgba(0,0,0,0.18)] bg-surface-muted px-2.5 py-2.5 text-right text-xs font-semibold text-muted">Média</th>
                <th scope="col" className="sticky right-0 z-10 w-[112px] min-w-[112px] bg-surface-muted px-2.5 py-2.5 text-right text-xs font-semibold text-fg">Total</th>
              </tr>
            </thead>
            <tbody>
              <GroupRow label="Receitas" values={incomeTotals} kind="income" />
              {INCOME.map((r) => <CategoryRow key={r.name} row={r} kind="income" />)}
              <GroupRow label="Despesas" values={expenseTotals} kind="expense" />
              {EXPENSE.map((r) => <CategoryRow key={r.name} row={r} kind="expense" />)}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border-strong bg-surface">
                <th scope="row" className="sticky left-0 z-10 bg-surface px-4 py-3 text-left">
                  <div className="flex items-center gap-2.5">
                    <div className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-fg">Resultado</span>
                      <span className="block text-2xs text-subtle">receitas − despesas</span>
                    </div>
                    <Spark values={result} tone="success" />
                  </div>
                </th>
                {result.map((x, i) => (
                  <td key={i} className={cn(cellBase, 'py-3', i === CURRENT && 'bg-brand-50/60')}>
                    <span className={cn('block text-label font-semibold', x >= 0 ? 'text-success' : 'text-danger')}>
                      {x > 0 ? '+' : ''}
                      {money(x)}
                    </span>
                    <span className="block text-2xs text-subtle">{((x / incomeTotals[i]!) * 100).toFixed(0)}% guardado</span>
                  </td>
                ))}
                <td className={cn(cellBase, 'sticky right-[112px] z-10 w-[104px] min-w-[104px] border-l border-border shadow-[-8px_0_12px_-10px_rgba(0,0,0,0.18)] bg-surface py-3 text-label font-semibold text-success')}>+{money(avg(result))}</td>
                <td className={cn(cellBase, 'sticky right-0 z-10 w-[112px] min-w-[112px] bg-surface py-3 text-sm font-semibold text-success')}>+{money(total(result))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-border bg-surface-muted px-4 py-2.5 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-3 rounded-sm" style={{ background: 'color-mix(in srgb, var(--color-danger) 14%, transparent)' }} /> mais forte = maior gasto
          </span>
          <span>— sem lançamentos</span>
          <span>% = parte da receita do mês</span>
          <span className="ml-auto">Clique numa célula para ver os lançamentos</span>
        </div>
      </Card>
    </div>
  );
}
