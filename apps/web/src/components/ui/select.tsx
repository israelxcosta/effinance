import {
  Children,
  Fragment,
  forwardRef,
  isValidElement,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { Select as RS } from 'radix-ui';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { inputClasses } from './input';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  wrapperClassName?: string;
  size_?: 'sm' | 'md';
}

interface OptionItem {
  value: string;
  label: string;
  disabled?: boolean;
}

interface OptionGroup {
  label: string;
  options: OptionItem[];
}

type Entry = OptionItem | OptionGroup;

const isGroup = (e: Entry): e is OptionGroup => 'options' in e;

// Radix items cannot use '' as a value; native "Todas"/"Nenhuma" options do.
const EMPTY = '__effinance_empty__';
const toRadix = (v: string) => (v === '' ? EMPTY : v);
const fromRadix = (v: string) => (v === EMPTY ? '' : v);

function textOf(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
  return '';
}

/** Reads `<option>` / `<optgroup>` children (fragments and arrays included). */
function collect(children: ReactNode): Entry[] {
  const out: Entry[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const props = child.props as { value?: unknown; label?: string; disabled?: boolean; children?: ReactNode };
    if (child.type === Fragment) out.push(...collect(props.children));
    else if (child.type === 'optgroup') {
      out.push({ label: props.label ?? '', options: collect(props.children).filter((e): e is OptionItem => !isGroup(e)) });
    } else if (child.type === 'option') {
      const label = textOf(props.children);
      out.push({ value: props.value === undefined ? label : String(props.value), label, disabled: props.disabled });
    }
  });
  return out;
}

const itemClass =
  'relative flex cursor-pointer select-none items-center rounded-lg py-2 pr-9 pl-3 text-sm text-fg outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-bg-subtle data-[state=checked]:font-semibold';

/**
 * Design-system select: the same API as a native `<select>` (children are `<option>`/`<optgroup>`,
 * works with `value`/`onChange` and with react-hook-form `register`), rendered as a rounded Radix
 * listbox. A visually hidden native select keeps the form value, ref and change events.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  {
    className,
    wrapperClassName,
    size_ = 'md',
    children,
    id,
    value,
    defaultValue,
    disabled,
    'aria-label': ariaLabel,
    'aria-invalid': ariaInvalid,
    'aria-describedby': ariaDescribedBy,
    ...nativeProps
  },
  ref,
) {
  const nativeRef = useRef<HTMLSelectElement | null>(null);
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue != null ? String(defaultValue) : '');
  const current = controlled ? String(value ?? '') : inner;

  const entries = collect(children);
  const options = entries.flatMap((e) => (isGroup(e) ? e.options : [e]));
  // Like a native select, an unknown value shows the first option.
  const selected = options.find((o) => o.value === current) ?? options[0];

  const setRefs = useCallback(
    (el: HTMLSelectElement | null) => {
      nativeRef.current = el;
      if (typeof ref === 'function') ref(el);
      else if (ref) ref.current = el;
    },
    [ref],
  );

  // Uncontrolled use (react-hook-form): mirror programmatic `el.value = …` writes from reset/setValue.
  useLayoutEffect(() => {
    const el = nativeRef.current;
    if (!el || controlled) return;
    const native = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!;
    Object.defineProperty(el, 'value', {
      configurable: true,
      get: () => native.get!.call(el) as string,
      set: (v: string) => {
        native.set!.call(el, v);
        setInner(native.get!.call(el) as string);
      },
    });
    return () => {
      delete (el as { value?: string }).value;
    };
  }, [controlled]);

  // Options can change under the native select (async lists); keep the shown value in sync.
  useLayoutEffect(() => {
    const el = nativeRef.current;
    if (el && !controlled) setInner((prev) => (prev === el.value ? prev : el.value));
  });

  function commit(next: string) {
    const el = nativeRef.current;
    if (!el) return;
    el.value = next;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function renderItem(o: OptionItem) {
    return (
      <RS.Item key={o.value} value={toRadix(o.value)} disabled={o.disabled} className={itemClass}>
        <RS.ItemText>{o.label}</RS.ItemText>
        <RS.ItemIndicator className="absolute right-3 inline-flex text-primary">
          <Check className="size-4" />
        </RS.ItemIndicator>
      </RS.Item>
    );
  }

  return (
    <div className={cn('relative', wrapperClassName)}>
      <RS.Root
        value={selected ? toRadix(selected.value) : ''}
        onValueChange={(v) => commit(fromRadix(v))}
        onOpenChange={(open) => {
          if (!open) nativeRef.current?.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
        }}
        disabled={disabled}
      >
        <RS.Trigger
          id={id}
          aria-label={ariaLabel}
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedBy}
          className={cn(
            inputClasses,
            'group/select flex cursor-pointer items-center justify-between gap-2 text-left data-[state=open]:border-brand-500 data-[state=open]:ring-[3px] data-[state=open]:ring-brand-500/15',
            size_ === 'sm' && 'h-9 rounded-[10px] text-[13px]',
            className,
          )}
        >
          <span className="min-w-0 flex-1 truncate">
            <RS.Value>{selected?.label ?? ''}</RS.Value>
          </span>
          <RS.Icon className="inline-flex shrink-0 text-muted transition-transform duration-150 group-data-[state=open]/select:rotate-180">
            <ChevronDown className="size-4" />
          </RS.Icon>
        </RS.Trigger>
        <RS.Portal>
          <RS.Content
            position="popper"
            sideOffset={6}
            collisionPadding={12}
            className="z-50 max-h-[min(360px,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl border border-border bg-surface shadow-lg data-[state=open]:animate-fade-in"
          >
            <RS.ScrollUpButton className="flex h-7 items-center justify-center text-muted">
              <ChevronUp className="size-4" />
            </RS.ScrollUpButton>
            <RS.Viewport className="p-1.5">
              {entries.map((e, i) =>
                isGroup(e) ? (
                  <RS.Group key={`g-${e.label}-${i}`}>
                    {i > 0 ? <RS.Separator className="mx-2 my-1.5 h-px bg-border" /> : null}
                    <RS.Label className="px-3 pt-1.5 pb-1 text-[11px] font-semibold tracking-[0.08em] text-subtle uppercase">
                      {e.label}
                    </RS.Label>
                    {e.options.map(renderItem)}
                  </RS.Group>
                ) : (
                  renderItem(e)
                ),
              )}
            </RS.Viewport>
            <RS.ScrollDownButton className="flex h-7 items-center justify-center text-muted">
              <ChevronDown className="size-4" />
            </RS.ScrollDownButton>
          </RS.Content>
        </RS.Portal>
      </RS.Root>
      {/* Form value holder: keeps `name`, refs, onChange/onBlur and RHF registration working. */}
      <select
        ref={setRefs}
        {...nativeProps}
        {...(controlled ? { value } : { defaultValue })}
        disabled={disabled}
        tabIndex={-1}
        aria-hidden
        className="sr-only"
      >
        {children}
      </select>
    </div>
  );
});
