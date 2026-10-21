import { Checkbox as C } from 'radix-ui';
import { Check, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CheckboxProps {
  checked: boolean | 'indeterminate';
  onCheckedChange: (checked: boolean) => void;
  id?: string;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
}

/** Square checkbox (raio 5px): checked/indeterminate = primary fill, focus ring like inputs. */
export function Checkbox({ className, checked, onCheckedChange, ...props }: CheckboxProps) {
  return (
    <C.Root
      checked={checked}
      onCheckedChange={(c) => onCheckedChange(c === true)}
      className={cn(
        'peer flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border-[1.5px] border-border-strong bg-surface text-primary-fg shadow-xs outline-none transition-colors hover:border-muted focus-visible:ring-[3px] focus-visible:ring-brand-500/25 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary',
        className,
      )}
      {...props}
    >
      <C.Indicator className="flex items-center justify-center">
        {checked === 'indeterminate' ? <Minus className="size-3" strokeWidth={3} /> : <Check className="size-3" strokeWidth={3} />}
      </C.Indicator>
    </C.Root>
  );
}
