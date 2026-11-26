import { useState, type ReactNode } from 'react';
import { Popover } from 'radix-ui';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { MONTH_NAMES, MONTH_SHORT, todayISO } from '@effinance/shared';
import { cn } from '@/lib/utils';
import { Button } from './button';

const navButton =
  'grid size-8 place-items-center rounded-full text-muted transition-colors hover:bg-bg-subtle hover:text-fg focus-visible:ring-[3px] focus-visible:ring-brand-500/25 outline-none';
const cell =
  'h-11 rounded-xl text-label font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-brand-500/30';

/** Year arrows + 12 months. `value` and the result are 'YYYY-MM'. */
export function MonthPickerPanel({ value, onSelect }: { value: string; onSelect: (month: string) => void }) {
  const [year, setYear] = useState(() => Number(value.slice(0, 4)));
  const current = todayISO().slice(0, 7);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <button type="button" className={navButton} aria-label="Ano anterior" onClick={() => setYear((y) => y - 1)}>
          <ChevronLeft className="size-4" />
        </button>
        <span className="text-title font-semibold text-fg tabular" aria-live="polite">
          {year}
        </span>
        <button type="button" className={navButton} aria-label="Próximo ano" onClick={() => setYear((y) => y + 1)}>
          <ChevronRight className="size-4" />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {MONTH_SHORT.map((label, i) => {
          const key = `${year}-${String(i + 1).padStart(2, '0')}`;
          const active = key === value;
          return (
            <button
              key={key}
              type="button"
              aria-label={`${MONTH_NAMES[i]} de ${year}`}
              aria-pressed={active}
              onClick={() => onSelect(key)}
              className={cn(
                cell,
                active ? 'bg-primary font-semibold text-primary-fg shadow-xs' : 'text-fg hover:bg-bg-subtle',
                !active && key === current && 'text-brand-text ring-1 ring-brand-500/40 ring-inset',
              )}
            >
              {label}
            </button>
          );
        })}
      </div>
      <div className="flex justify-end border-t border-border pt-2">
        <button
          type="button"
          onClick={() => onSelect(current)}
          className="h-8 rounded-full bg-primary-soft px-3.5 text-label font-semibold text-primary-soft-fg transition-colors hover:bg-brand-200/70 focus-visible:ring-[3px] focus-visible:ring-brand-500/25 outline-none"
        >
          Mês atual
        </button>
      </div>
    </div>
  );
}

/** Twelve years around `value`, with arrows to move by a dozen. */
export function YearPickerPanel({ value, onSelect }: { value: number; onSelect: (year: number) => void }) {
  const [start, setStart] = useState(() => value - 5);
  const current = Number(todayISO().slice(0, 4));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <button type="button" className={navButton} aria-label="Anos anteriores" onClick={() => setStart((s) => s - 12)}>
          <ChevronLeft className="size-4" />
        </button>
        <span className="text-title font-semibold text-fg tabular">
          {start} – {start + 11}
        </span>
        <button type="button" className={navButton} aria-label="Próximos anos" onClick={() => setStart((s) => s + 12)}>
          <ChevronRight className="size-4" />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {Array.from({ length: 12 }, (_, i) => start + i).map((y) => (
          <button
            key={y}
            type="button"
            aria-pressed={y === value}
            onClick={() => onSelect(y)}
            className={cn(
              cell,
              'tabular',
              y === value ? 'bg-primary font-semibold text-primary-fg shadow-xs' : 'text-fg hover:bg-bg-subtle',
              y !== value && y === current && 'text-brand-text ring-1 ring-brand-500/40 ring-inset',
            )}
          >
            {y}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Rounded popover used by the period navigators (same look as the date picker). */
export function PickerPopover({
  open,
  onOpenChange,
  trigger,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactNode;
  children: ReactNode;
}) {
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="center"
          sideOffset={8}
          collisionPadding={12}
          className="z-50 w-[296px] rounded-2xl border border-border bg-surface p-3 shadow-lg data-[state=open]:animate-fade-in"
        >
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export const navigatorLabelClasses =
  'min-w-[150px] rounded-md px-2 py-1 text-center text-label font-semibold text-fg tabular transition-colors hover:bg-bg-subtle focus-visible:ring-[3px] focus-visible:ring-brand-500/25 outline-none data-[state=open]:bg-bg-subtle';

/** ‹ Novembro 2026 ›: arrows move one month; clicking the name opens the month/year grid. */
export function MonthNavigator({ value, onChange, className }: { value: string; onChange: (month: string) => void; className?: string }) {
  const [open, setOpen] = useState(false);
  const y = Number(value.slice(0, 4));
  const m = Number(value.slice(5, 7));
  const shift = (delta: number) => {
    const total = y * 12 + (m - 1) + delta;
    onChange(`${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`);
  };
  return (
    <div className={cn('flex h-10 items-center gap-1 rounded-md border border-border bg-surface px-1 shadow-xs', className)}>
      <Button variant="ghost" size="icon-sm" aria-label="Mês anterior" onClick={() => shift(-1)}>
        <ChevronLeft />
      </Button>
      <PickerPopover
        open={open}
        onOpenChange={setOpen}
        trigger={
          <button type="button" className={navigatorLabelClasses} aria-label={`${MONTH_NAMES[m - 1]} ${y} — escolher mês e ano`}>
            {MONTH_NAMES[m - 1]} {y}
          </button>
        }
      >
        <MonthPickerPanel
          value={value}
          onSelect={(next) => {
            onChange(next);
            setOpen(false);
          }}
        />
      </PickerPopover>
      <Button variant="ghost" size="icon-sm" aria-label="Próximo mês" onClick={() => shift(1)}>
        <ChevronRight />
      </Button>
    </div>
  );
}
