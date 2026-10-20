import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  addMonthKey,
  endOfMonth,
  endOfYear,
  formatDateBR,
  MONTH_NAMES,
  startOfYear,
} from '@effinance/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

/** Ranges are anchored on the active month (the one chosen on the dashboard), not on today. */
export const PRESETS = {
  month: 'Mês',
  'last-3': 'Últimos 3 meses',
  'last-6': 'Últimos 6 meses',
  'last-12': 'Últimos 12 meses',
  year: 'Ano',
  'next-6': 'Próximos 6 meses (projeção)',
  custom: 'Personalizado',
} as const;
export type Preset = keyof typeof PRESETS;

/** A report's own period. Only `month` follows (and moves) the active month; the rest are local. */
export interface ReportPeriod {
  preset: Preset;
  /** Year shown by the `year` preset (defaults to the active month's year). */
  year?: number;
  custom?: { from: string; to: string };
}

const first = (month: string) => `${month}-01`;

export function presetRange(
  period: ReportPeriod,
  activeMonth: string,
): { from: string; to: string } {
  const lastN = (n: number) => ({
    from: first(addMonthKey(activeMonth, -(n - 1))),
    to: endOfMonth(first(activeMonth)),
  });
  switch (period.preset) {
    case 'month':
      return { from: first(activeMonth), to: endOfMonth(first(activeMonth)) };
    case 'last-3':
      return lastN(3);
    case 'last-6':
      return lastN(6);
    case 'last-12':
      return lastN(12);
    case 'year': {
      const y = `${period.year ?? Number(activeMonth.slice(0, 4))}-01-01`;
      return { from: startOfYear(y), to: endOfYear(y) };
    }
    case 'next-6':
      return { from: first(activeMonth), to: endOfMonth(first(addMonthKey(activeMonth, 5))) };
    case 'custom': {
      const from = period.custom?.from || first(addMonthKey(activeMonth, -5));
      const to = period.custom?.to || endOfMonth(first(activeMonth));
      return from <= to ? { from, to } : { from: to, to: from };
    }
  }
}

interface PeriodFilterProps {
  value: ReportPeriod;
  activeMonth: string;
  onChange: (value: ReportPeriod) => void;
  onMonthChange: (month: string) => void;
}

export function PeriodFilter({ value, activeMonth, onChange, onMonthChange }: PeriodFilterProps) {
  const { from, to } = presetRange(value, activeMonth);
  const year = value.year ?? Number(activeMonth.slice(0, 4));
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={value.preset}
        onChange={(e) => {
          const preset = e.target.value as Preset;
          onChange(preset === 'custom' ? { preset, custom: { from, to } } : { preset });
        }}
        aria-label="Período"
        className="h-10 min-w-[210px] bg-surface font-medium"
      >
        {Object.entries(PRESETS).map(([k, label]) => (
          <option key={k} value={k}>
            {label}
          </option>
        ))}
      </Select>
      {value.preset === 'month' ? (
        <Stepper
          label={`${MONTH_NAMES[Number(activeMonth.slice(5, 7)) - 1]} ${activeMonth.slice(0, 4)}`}
          unit="Mês"
          onStep={(d) => onMonthChange(addMonthKey(activeMonth, d))}
        />
      ) : value.preset === 'year' ? (
        <Stepper
          label={String(year)}
          unit="Ano"
          onStep={(d) => onChange({ preset: 'year', year: year + d })}
        />
      ) : value.preset === 'custom' ? (
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={from}
            onChange={(e) => onChange({ preset: 'custom', custom: { from: e.target.value, to } })}
            className="h-10 w-[150px]"
            aria-label="De"
          />
          <span className="text-xs text-muted">até</span>
          <Input
            type="date"
            value={to}
            onChange={(e) => onChange({ preset: 'custom', custom: { from, to: e.target.value } })}
            className="h-10 w-[150px]"
            aria-label="Até"
          />
        </div>
      ) : (
        <span className="text-xs text-muted">
          {formatDateBR(from)} – {formatDateBR(to)}
        </span>
      )}
    </div>
  );
}

function Stepper({
  label,
  unit,
  onStep,
}: {
  label: string;
  unit: string;
  onStep: (delta: number) => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded-md border border-border bg-surface p-1 shadow-xs">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`${unit} anterior`}
        onClick={() => onStep(-1)}
      >
        <ChevronLeft />
      </Button>
      <span
        className="min-w-[120px] px-1 text-center text-[13px] font-semibold text-fg tabular"
        aria-live="polite"
      >
        {label}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Próximo ${unit.toLowerCase()}`}
        onClick={() => onStep(1)}
      >
        <ChevronRight />
      </Button>
    </div>
  );
}
