import { cn } from '@/lib/utils';

interface ProgressBarProps {
  /** 0..1 */
  value: number;
  color?: string;
  tone?: 'brand' | 'success' | 'danger' | 'warning';
  className?: string;
  size?: 'sm' | 'md';
  label?: string;
}

const TONES = {
  brand: 'bg-primary',
  success: 'bg-success',
  danger: 'bg-danger',
  warning: 'bg-warning',
} as const;

export function ProgressBar({ value, color, tone = 'brand', className, size = 'md', label }: ProgressBarProps) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)) * 100;
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-label={label}
      className={cn('w-full overflow-hidden rounded-full bg-primary-soft', size === 'sm' ? 'h-1.5' : 'h-2', className)}
    >
      <div
        className={cn('h-full rounded-full transition-[width] duration-500 ease-out', !color && TONES[tone])}
        style={{ width: `${pct}%`, ...(color ? { backgroundColor: color } : {}) }}
      />
    </div>
  );
}
