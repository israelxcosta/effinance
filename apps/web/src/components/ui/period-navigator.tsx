import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { todayISO } from '@effinance/shared';
import { cn } from '@/lib/utils';
import { PERIOD_MODE_LABELS, periodLabel, shiftPeriod, type PeriodMode, type PeriodValue } from '@/lib/period';
import { SegmentedControl } from './segmented-control';
import { Button } from './button';
import { Calendar } from './date-input';
import { MonthPickerPanel, PickerPopover, YearPickerPanel, navigatorLabelClasses } from './month-picker';

interface PeriodNavigatorProps {
  value: PeriodValue;
  onChange: (value: PeriodValue) => void;
  modes?: PeriodMode[];
  className?: string;
}

/** Mode selector (Dia/Semana/Mês/Ano) + ‹ label › navigation. */
export function PeriodNavigator({ value, onChange, modes = ['day', 'week', 'month'], className }: PeriodNavigatorProps) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {modes.length > 1 ? (
        <SegmentedControl
          ariaLabel="Tipo de período"
          value={value.mode}
          onChange={(mode) => onChange({ mode, anchor: value.anchor })}
          options={modes.map((m) => ({ value: m, label: PERIOD_MODE_LABELS[m] }))}
        />
      ) : null}
      <div className="flex h-10 items-center gap-1 rounded-md border border-border bg-surface px-1 shadow-xs">
        <Button variant="ghost" size="icon-sm" aria-label="Período anterior" onClick={() => onChange(shiftPeriod(value, -1))}>
          <ChevronLeft />
        </Button>
        <PeriodLabelPicker value={value} onChange={onChange} />
        <Button variant="ghost" size="icon-sm" aria-label="Próximo período" onClick={() => onChange(shiftPeriod(value, 1))}>
          <ChevronRight />
        </Button>
      </div>
      <Button variant="ghost" onClick={() => onChange({ mode: value.mode, anchor: todayISO() })}>
        Hoje
      </Button>
    </div>
  );
}

/** The navigator's label: clicking it opens a month grid (month mode), a calendar (day/week) or years. */
function PeriodLabelPicker({ value, onChange }: { value: PeriodValue; onChange: (value: PeriodValue) => void }) {
  const [open, setOpen] = useState(false);
  const pick = (anchor: string) => {
    onChange({ mode: value.mode, anchor });
    setOpen(false);
  };
  const what = value.mode === 'month' ? 'mês e ano' : value.mode === 'year' ? 'ano' : 'data';
  return (
    <PickerPopover
      open={open}
      onOpenChange={setOpen}
      trigger={
        <button type="button" className={navigatorLabelClasses} aria-live="polite" aria-label={`${periodLabel(value)} — escolher ${what}`}>
          {periodLabel(value)}
        </button>
      }
    >
      {value.mode === 'month' ? (
        <MonthPickerPanel value={value.anchor.slice(0, 7)} onSelect={(m) => pick(`${m}-01`)} />
      ) : value.mode === 'year' ? (
        <YearPickerPanel value={Number(value.anchor.slice(0, 4))} onSelect={(y) => pick(`${y}-01-01`)} />
      ) : (
        <Calendar value={value.anchor} onSelect={pick} onClear={() => pick(todayISO())} onEscape={() => setOpen(false)} />
      )}
    </PickerPopover>
  );
}
