import { addMonths, endOfMonth, endOfYear, formatDateBR, startOfMonth, startOfYear, todayISO } from '@effinance/shared';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

export const PRESETS = {
  'this-month': 'Este mês',
  'last-3': 'Últimos 3 meses',
  'last-6': 'Últimos 6 meses',
  'last-12': 'Últimos 12 meses',
  'this-year': 'Este ano',
  'next-6': 'Próximos 6 meses (projeção)',
  custom: 'Personalizado',
} as const;
export type Preset = keyof typeof PRESETS;

export function presetRange(preset: Preset, custom?: { from?: string | null; to?: string | null }): { from: string; to: string } {
  const t = todayISO();
  switch (preset) {
    case 'this-month':
      return { from: startOfMonth(t), to: endOfMonth(t) };
    case 'last-3':
      return { from: startOfMonth(addMonths(t, -2)), to: endOfMonth(t) };
    case 'last-6':
      return { from: startOfMonth(addMonths(t, -5)), to: endOfMonth(t) };
    case 'last-12':
      return { from: startOfMonth(addMonths(t, -11)), to: endOfMonth(t) };
    case 'this-year':
      return { from: startOfYear(t), to: endOfYear(t) };
    case 'next-6':
      return { from: startOfMonth(t), to: endOfMonth(addMonths(t, 5)) };
    case 'custom': {
      const from = custom?.from || startOfMonth(addMonths(t, -5));
      const to = custom?.to || endOfMonth(t);
      return from <= to ? { from, to } : { from: to, to: from };
    }
  }
}

interface PeriodFilterProps {
  preset: Preset;
  from: string;
  to: string;
  onChange: (preset: Preset, range?: { from: string; to: string }) => void;
}

export function PeriodFilter({ preset, from, to, onChange }: PeriodFilterProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={preset} onChange={(e) => onChange(e.target.value as Preset)} aria-label="Período" className="h-10 min-w-[210px] bg-surface font-medium">
        {Object.entries(PRESETS).map(([k, label]) => (
          <option key={k} value={k}>
            {label}
          </option>
        ))}
      </Select>
      {preset === 'custom' ? (
        <div className="flex items-center gap-2">
          <Input type="date" value={from} onChange={(e) => onChange('custom', { from: e.target.value, to })} className="h-10 w-[150px]" aria-label="De" />
          <span className="text-xs text-muted">até</span>
          <Input type="date" value={to} onChange={(e) => onChange('custom', { from, to: e.target.value })} className="h-10 w-[150px]" aria-label="Até" />
        </div>
      ) : (
        <span className="text-xs text-muted">
          {formatDateBR(from)} – {formatDateBR(to)}
        </span>
      )}
    </div>
  );
}
