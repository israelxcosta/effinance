// Periods of the Evolução report: past, past + future, future (projection) or a custom month range.
import { addMonthKey } from '@effinance/shared';

export type EvolutionPreset = 'past6' | 'past12' | 'past24' | 'past36' | 'around6' | 'next6' | 'next12' | 'custom';

export const EVOLUTION_PRESETS: { value: EvolutionPreset; label: string }[] = [
  { value: 'past6', label: 'Últimos 6 meses' },
  { value: 'past12', label: 'Últimos 12 meses' },
  { value: 'past24', label: 'Últimos 24 meses' },
  { value: 'past36', label: 'Últimos 36 meses' },
  { value: 'around6', label: '6 meses antes e 6 depois' },
  { value: 'next6', label: 'Próximos 6 meses' },
  { value: 'next12', label: 'Próximos 12 meses' },
  { value: 'custom', label: 'Personalizado' },
];

export const MAX_EVOLUTION_MONTHS = 36;

/** Months between two 'YYYY-MM' keys, both included. */
export function monthSpan(from: string, to: string): number {
  return (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + (Number(to.slice(5, 7)) - Number(from.slice(5, 7))) + 1;
}

/** API query (`to` + `months`) for a preset around the active month; custom ranges are ordered and capped. */
export function evolutionRange(
  preset: EvolutionPreset,
  activeMonth: string,
  custom?: { from: string; to: string },
): { from: string; to: string; months: number } {
  const past = (n: number) => ({ from: addMonthKey(activeMonth, -(n - 1)), to: activeMonth, months: n });
  switch (preset) {
    case 'past6':
      return past(6);
    case 'past12':
      return past(12);
    case 'past24':
      return past(24);
    case 'past36':
      return past(36);
    case 'around6':
      return { from: addMonthKey(activeMonth, -6), to: addMonthKey(activeMonth, 6), months: 13 };
    case 'next6':
      return { from: activeMonth, to: addMonthKey(activeMonth, 5), months: 6 };
    case 'next12':
      return { from: activeMonth, to: addMonthKey(activeMonth, 11), months: 12 };
    case 'custom': {
      let from = custom?.from ?? activeMonth;
      let to = custom?.to ?? activeMonth;
      if (from > to) [from, to] = [to, from];
      const months = Math.min(MAX_EVOLUTION_MONTHS, monthSpan(from, to));
      return { from: addMonthKey(to, -(months - 1)), to, months };
    }
  }
}
