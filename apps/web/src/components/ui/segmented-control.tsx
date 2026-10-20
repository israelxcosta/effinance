import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  /** Classes applied when this option is active (e.g. red for "Despesa"). */
  activeClassName?: string;
  title?: string;
}

interface SegmentedControlProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: SegmentOption<T>[];
  /** 'subtle' = white pill on gray track; 'solid' = navy active (main tabs); 'card' = large (sheet). */
  variant?: 'subtle' | 'solid' | 'card';
  size?: 'sm' | 'md';
  className?: string;
  fullWidth?: boolean;
  ariaLabel?: string;
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  variant = 'subtle',
  size = 'md',
  className,
  fullWidth,
  ariaLabel,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        'inline-flex items-center gap-1',
        variant === 'subtle' && 'rounded-md bg-bg-subtle p-1',
        variant === 'solid' && 'rounded-lg border border-border bg-surface p-1 shadow-xs',
        variant === 'card' && 'rounded-xl bg-bg-subtle p-1.5',
        fullWidth && 'flex w-full',
        className,
      )}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        const idx = options.findIndex((o) => o.value === value);
        const next = options[(idx + (e.key === 'ArrowRight' ? 1 : -1) + options.length) % options.length];
        if (next) onChange(next.value);
      }}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            title={opt.title}
            onClick={() => onChange(opt.value)}
            className={cn(
              'inline-flex items-center justify-center gap-1.5 font-semibold whitespace-nowrap transition-all duration-150 [&_svg]:size-4',
              fullWidth && 'flex-1',
              size === 'sm' ? 'h-7 rounded-[8px] px-2.5 text-xs' : 'h-9 rounded-[10px] px-3.5 text-[13px]',
              variant === 'card' && 'h-12 rounded-lg text-[15px]',
              active
                ? (opt.activeClassName ??
                    (variant === 'solid'
                      ? 'bg-primary text-primary-fg shadow-xs'
                      : 'bg-surface text-fg shadow-sm'))
                : 'text-muted hover:text-fg',
            )}
          >
            {opt.icon}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
