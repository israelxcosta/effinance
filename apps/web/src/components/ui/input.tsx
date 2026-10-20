import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes, cloneElement, isValidElement, type ReactElement } from 'react';
import { cn } from '@/lib/utils';

export const inputClasses =
  'h-11 w-full rounded-md border border-border bg-surface px-3.5 text-sm text-fg shadow-xs outline-none transition-[border-color,box-shadow] placeholder:text-subtle hover:border-border-strong focus:border-brand-500 focus:ring-[3px] focus:ring-brand-500/15 disabled:cursor-not-allowed disabled:bg-surface-muted disabled:opacity-70 aria-[invalid=true]:border-danger aria-[invalid=true]:focus:ring-danger/15';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cn(inputClasses, className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, rows = 3, ...props }, ref) {
    return <textarea ref={ref} rows={rows} className={cn(inputClasses, 'h-auto resize-y py-2.5', className)} {...props} />;
  },
);

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('text-[13px] font-medium text-fg', className)} {...props} />;
}

interface FieldProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | undefined;
  className?: string;
  /** Rendered next to the label (e.g. a small action). */
  aside?: ReactNode;
  /** A single form control; it receives id / aria-invalid / aria-describedby. */
  children: ReactNode;
}

export function Field({ label, hint, error, className, aside, children }: FieldProps) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
        id: (children.props as { id?: string }).id ?? id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedBy,
      })
    : children;
  const controlId = isValidElement(children) ? ((children.props as { id?: string }).id ?? id) : id;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label || aside ? (
        <div className="flex items-center justify-between gap-2">
          {label ? <Label htmlFor={controlId}>{label}</Label> : <span />}
          {aside}
        </div>
      ) : null}
      {control}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
