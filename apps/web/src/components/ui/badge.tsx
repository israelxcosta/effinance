import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const TONES = {
  brand: 'bg-primary-soft text-primary-soft-fg',
  success: 'bg-success-soft text-success',
  danger: 'bg-danger-soft text-danger',
  warning: 'bg-warning-soft text-warning',
  neutral: 'bg-bg-subtle text-muted',
  solid: 'bg-primary text-primary-fg',
} as const;

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: keyof typeof TONES;
  size?: 'sm' | 'md';
}

export function Badge({ tone = 'neutral', size = 'sm', className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full font-semibold whitespace-nowrap [&_svg]:size-3',
        size === 'sm' ? 'h-5 px-2 text-[11px]' : 'h-6 px-2.5 text-xs',
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}
