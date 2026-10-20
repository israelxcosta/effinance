import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { GitCompareArrows, LayoutDashboard, Tags, Users, Waves } from 'lucide-react';
import { PageHeader } from '@/components/ui/misc';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { CashflowTab } from '../components/cashflow-tab';
import { CategoriesTab } from '../components/categories-tab';
import { ComparisonTab } from '../components/comparison-tab';
import { ContactsTab } from '../components/contacts-tab';
import { OverviewTab } from '../components/overview-tab';
import { useActiveMonth } from '@/lib/active-month';
import { PeriodFilter, presetRange, type ReportPeriod } from '../components/period-filter';

type Tab = 'overview' | 'categories' | 'contacts' | 'comparison' | 'cashflow';

/**
 * Each report keeps its own period while the app is open. The default ("Mês") follows the
 * active month and moving it moves the active month everywhere; multi-month choices stay local.
 */
const savedPeriods = new Map<Tab, ReportPeriod>();

export default function ReportsPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('aba') as Tab) || 'overview';
  const [activeMonth, setActiveMonth] = useActiveMonth();
  const [periods, setPeriods] = useState(() => new Map(savedPeriods));
  const period = periods.get(tab) ?? { preset: 'month' };
  const range = presetRange(period, activeMonth);

  function setPeriod(next: ReportPeriod) {
    savedPeriods.set(tab, next);
    setPeriods(new Map(savedPeriods));
  }

  function update(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (!v) next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        overline="Análises"
        title="Relatórios"
        description="Evolução, projeções, comparações e fluxo de caixa para decidir com contexto."
        actions={
          tab !== 'comparison' ? (
            <PeriodFilter value={period} activeMonth={activeMonth} onChange={setPeriod} onMonthChange={setActiveMonth} />
          ) : null
        }
      />

      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <SegmentedControl
          variant="solid"
          ariaLabel="Relatório"
          value={tab}
          onChange={(t) => update({ aba: t === 'overview' ? null : t })}
          options={[
            { value: 'overview', label: 'Visão geral', icon: <LayoutDashboard /> },
            { value: 'categories', label: 'Categorias', icon: <Tags /> },
            { value: 'contacts', label: 'Contatos', icon: <Users /> },
            { value: 'comparison', label: 'Comparação', icon: <GitCompareArrows /> },
            { value: 'cashflow', label: 'Fluxo de caixa', icon: <Waves /> },
          ]}
        />
      </div>

      {tab === 'overview' ? <OverviewTab from={range.from} to={range.to} /> : null}
      {tab === 'categories' ? <CategoriesTab from={range.from} to={range.to} /> : null}
      {tab === 'contacts' ? <ContactsTab from={range.from} to={range.to} /> : null}
      {tab === 'comparison' ? <ComparisonTab /> : null}
      {tab === 'cashflow' ? <CashflowTab from={range.from} to={range.to} /> : null}
    </div>
  );
}
