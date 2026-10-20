import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

interface CodeInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Called once all digits are filled (e.g. to submit automatically). */
  onComplete?: (value: string) => void;
  length?: number;
  disabled?: boolean;
  autoFocus?: boolean;
  invalid?: boolean;
  label?: string;
}

/** One box per digit (2FA codes): auto-advance, backspace to the previous box and paste of the whole code. */
export function CodeInput({ value, onChange, onComplete, length = 6, disabled, autoFocus, invalid, label = 'Código de verificação' }: CodeInputProps) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length }, (_, i) => value[i] ?? '');

  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus();
  }, [autoFocus]);

  function update(next: string, focusIndex: number) {
    const clean = next.replace(/\D/g, '').slice(0, length);
    onChange(clean);
    refs.current[Math.min(focusIndex, length - 1)]?.focus();
    if (clean.length === length) onComplete?.(clean);
  }

  return (
    <div role="group" aria-label={label} className="flex justify-between gap-2">
      {digits.map((digit, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={digit}
          disabled={disabled}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          aria-label={`Dígito ${i + 1} de ${length}`}
          aria-invalid={invalid || undefined}
          maxLength={length}
          className={cn(
            'tabular h-12 w-full min-w-0 rounded-md border border-border bg-surface text-center text-lg font-semibold text-fg shadow-xs outline-none transition-[border-color,box-shadow] focus:border-brand-500 focus:ring-[3px] focus:ring-brand-500/15 disabled:opacity-60 sm:h-13',
            invalid && 'border-danger focus:ring-danger/15',
          )}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => {
            const typed = e.target.value.replace(/\D/g, '');
            if (!typed) return;
            // Typing replaces this box; pasting/autofill of several digits fills from here on.
            update(value.slice(0, i) + typed + value.slice(i + typed.length), i + typed.length);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace') {
              e.preventDefault();
              if (digit) update(value.slice(0, i) + value.slice(i + 1), i);
              else if (i > 0) update(value.slice(0, i - 1) + value.slice(i), i - 1);
            } else if (e.key === 'ArrowLeft' && i > 0) {
              e.preventDefault();
              refs.current[i - 1]?.focus();
            } else if (e.key === 'ArrowRight' && i < length - 1) {
              e.preventDefault();
              refs.current[i + 1]?.focus();
            }
          }}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData('text').replace(/\D/g, '');
            if (!pasted) return;
            e.preventDefault();
            update(pasted, pasted.length);
          }}
        />
      ))}
    </div>
  );
}
