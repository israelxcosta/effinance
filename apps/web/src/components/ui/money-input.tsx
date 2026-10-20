import { forwardRef, type InputHTMLAttributes } from 'react';
import { formatDecimal } from '@effinance/shared';
import { cn } from '@/lib/utils';
import { inputClasses } from './input';

interface MoneyInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'size'> {
  /** Value in cents. */
  value: number | null | undefined;
  onChange: (cents: number) => void;
  allowNegative?: boolean;
  size?: 'md' | 'lg';
}

/**
 * Bank-style money input: digits fill from the right (typing 1, 2, 3 → 1,23).
 * Value is kept as integer cents.
 */
export const MoneyInput = forwardRef<HTMLInputElement, MoneyInputProps>(function MoneyInput(
  { value, onChange, allowNegative, size = 'md', className, ...props },
  ref,
) {
  const cents = value ?? 0;
  const negative = cents < 0;
  const display = formatDecimal(Math.abs(cents));

  function handleChange(raw: string) {
    const digits = raw.replace(/\D/g, '').slice(0, 13);
    const abs = digits ? parseInt(digits, 10) : 0;
    onChange(allowNegative && negative && abs !== 0 ? -abs : abs);
  }

  return (
    <div className={cn('relative', allowNegative && 'mr-11', className)}>
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 font-semibold text-muted',
          size === 'lg' ? 'text-base' : 'text-sm',
        )}
      >
        {negative ? '-R$' : 'R$'}
      </span>
      <input
        ref={ref}
        inputMode="numeric"
        autoComplete="off"
        className={cn(
          inputClasses,
          'tabular text-right font-semibold',
          size === 'lg' ? 'h-14 pl-12 text-2xl tracking-tight' : negative ? 'pl-12' : 'pl-10',
          negative && 'text-danger',
        )}
        value={display}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={(e) => {
          if (allowNegative && e.key === '-') {
            e.preventDefault();
            onChange(-cents);
          }
        }}
        onFocus={(e) => {
          const el = e.currentTarget;
          requestAnimationFrame(() => el.setSelectionRange(el.value.length, el.value.length));
        }}
        {...props}
      />
      {allowNegative ? (
        <button
          type="button"
          onClick={() => onChange(-cents)}
          className="absolute top-1/2 right-[-2.75rem] flex size-9 -translate-y-1/2 items-center justify-center rounded-md border border-border bg-surface text-sm font-semibold text-muted hover:text-fg"
          aria-label={negative ? 'Tornar positivo' : 'Tornar negativo'}
          title="Alternar sinal (+/−)"
        >
          ±
        </button>
      ) : null}
    </div>
  );
});
