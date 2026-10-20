import { getBank } from '@effinance/shared';
import { Wallet } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BankLogoProps {
  bank: string | null | undefined;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
  /** Fallback color when there is no bank (e.g. wallet). */
  color?: string;
}

const SIZES = {
  xs: 'size-6 text-[9px]',
  sm: 'size-8 text-[10px]',
  md: 'size-10 text-[11px]',
  lg: 'size-12 text-xs',
} as const;

/** Round badge with the bank's brand color and short name (no trademarked artwork). */
export function BankLogo({ bank, size = 'md', className, color }: BankLogoProps) {
  const info = getBank(bank);
  if (!info) {
    return (
      <span
        className={cn('inline-flex shrink-0 items-center justify-center rounded-full text-white', SIZES[size], className)}
        style={{ backgroundColor: color ?? 'var(--app-muted)' }}
        aria-hidden
      >
        <Wallet className="size-[45%]" />
      </span>
    );
  }
  return (
    <span
      title={info.name}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-extrabold tracking-tight ring-2 ring-surface select-none',
        SIZES[size],
        className,
      )}
      style={{ backgroundColor: info.color, color: info.textColor }}
      aria-label={info.name}
      role="img"
    >
      {info.short}
    </span>
  );
}
