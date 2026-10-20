import { forwardRef, type SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { inputClasses } from './input';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  wrapperClassName?: string;
  size_?: 'sm' | 'md';
}

/** Native select styled like the design system (accessible and mobile friendly). */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, wrapperClassName, size_ = 'md', children, ...props },
  ref,
) {
  return (
    <div className={cn('relative', wrapperClassName)}>
      <select
        ref={ref}
        className={cn(
          inputClasses,
          'cursor-pointer appearance-none pr-9',
          size_ === 'sm' && 'h-9 rounded-[10px] text-[13px]',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted"
      />
    </div>
  );
});
