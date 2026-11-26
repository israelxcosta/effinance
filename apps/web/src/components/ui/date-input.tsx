import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type InputHTMLAttributes,
  type KeyboardEvent,
} from 'react';
import { Popover } from 'radix-ui';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  MONTH_NAMES,
  MONTH_SHORT,
  addDays,
  addMonthKey,
  addMonths,
  daysInMonth,
  endOfWeek,
  formatMonthKey,
  isISODate,
  monthKey,
  startOfWeek,
  todayISO,
  type ISODate,
} from '@effinance/shared';
import { cn } from '@/lib/utils';
import { clampDate, formatDateText, isOutOfRange, maskDateText, monthGrid, parseDateText, spokenDate } from '@/lib/calendar';
import { inputClasses } from './input';

type DateInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'defaultValue'> & {
  value?: string;
  defaultValue?: string;
};

const WEEKDAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const WEEKDAY_NAMES = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

/**
 * Design-system date field: the same API as `<input type="date">` (ISO `YYYY-MM-DD` value,
 * `onChange` events, `min`/`max`, react-hook-form `register`), shown as a dd/mm/aaaa text box that
 * accepts typing plus a rounded calendar popover. A visually hidden native input keeps the form
 * value, ref and change/blur events, like `<Select>`.
 */
export const DateInput = forwardRef<HTMLInputElement, DateInputProps>(function DateInput(
  {
    className,
    id,
    value,
    defaultValue,
    disabled,
    min,
    max,
    placeholder = 'dd/mm/aaaa',
    'aria-label': ariaLabel,
    'aria-invalid': ariaInvalid,
    'aria-describedby': ariaDescribedBy,
    ...nativeProps
  },
  ref,
) {
  const nativeRef = useRef<HTMLInputElement | null>(null);
  const textRef = useRef<HTMLInputElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue ?? '');
  const current = controlled ? (value ?? '') : inner;
  const [text, setText] = useState(() => formatDateText(current));
  const [open, setOpen] = useState(false);
  const [focusGrid, setFocusGrid] = useState(false);
  const minISO = typeof min === 'string' && isISODate(min) ? min : undefined;
  const maxISO = typeof max === 'string' && isISODate(max) ? max : undefined;

  // The visible text follows the value (picked in the calendar, reset by the form, …).
  useEffect(() => setText(formatDateText(current)), [current]);

  const setRefs = useCallback(
    (el: HTMLInputElement | null) => {
      nativeRef.current = el;
      // react-hook-form focuses the registered element on a validation error.
      if (el) el.focus = () => textRef.current?.focus();
      if (typeof ref === 'function') ref(el);
      else if (ref) ref.current = el;
    },
    [ref],
  );

  // Uncontrolled use (react-hook-form): mirror programmatic `el.value = …` writes from reset/setValue.
  useLayoutEffect(() => {
    const el = nativeRef.current;
    if (!el || controlled) return;
    const native = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!;
    setInner(native.get!.call(el) as string);
    Object.defineProperty(el, 'value', {
      configurable: true,
      get: () => native.get!.call(el) as string,
      set: (v: string) => {
        native.set!.call(el, v);
        setInner(v);
      },
    });
    return () => {
      delete (el as { value?: string }).value;
    };
  }, [controlled]);

  function commit(next: string) {
    const el = nativeRef.current;
    if (!el || next === current) return;
    // The prototype setter skips React's value tracker, so React sees a real change.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, next);
    if (!controlled) setInner(next);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function blurForm() {
    nativeRef.current?.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  }

  function onType(raw: string) {
    const masked = maskDateText(raw);
    setText(masked);
    if (masked === '') commit('');
    const parsed = parseDateText(masked);
    if (parsed && !isOutOfRange(parsed, minISO, maxISO)) commit(parsed);
  }

  function onTextKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || (e.altKey && e.key === 'ArrowDown')) {
      e.preventDefault();
      setFocusGrid(true);
      setOpen(true);
    } else if ((e.key === 'Escape' || e.key === 'Enter' || e.key === 'Tab') && open) {
      if (e.key === 'Escape') e.preventDefault();
      setOpen(false);
      setFocusGrid(false);
    }
  }

  function close() {
    setOpen(false);
    setFocusGrid(false);
    textRef.current?.focus();
  }

  function pick(next: string) {
    commit(next);
    close();
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setFocusGrid(false);
          blurForm();
        }
      }}
    >
      <Popover.Anchor asChild>
        <div
          ref={wrapperRef}
          aria-invalid={ariaInvalid}
          className={cn(
            inputClasses,
            'flex cursor-text items-center gap-1 pr-1.5 focus-within:border-brand-500 focus-within:ring-[3px] focus-within:ring-brand-500/15 aria-[invalid=true]:focus-within:ring-danger/15',
            open && 'border-brand-500 ring-[3px] ring-brand-500/15',
            disabled && 'pointer-events-none bg-surface-muted opacity-70',
            className,
          )}
          onClick={() => {
            if (!disabled) {
              textRef.current?.focus();
              setOpen(true);
            }
          }}
        >
          <input
            ref={textRef}
            id={id}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            maxLength={10}
            placeholder={placeholder}
            value={text}
            disabled={disabled}
            aria-label={ariaLabel}
            aria-invalid={ariaInvalid}
            aria-describedby={ariaDescribedBy}
            aria-haspopup="dialog"
            aria-expanded={open}
            className="h-full w-full min-w-0 flex-1 bg-transparent tabular outline-none placeholder:text-subtle"
            onChange={(e) => onType(e.target.value)}
            onKeyDown={onTextKeyDown}
            onBlur={(e) => {
              // Half-typed or out-of-range text goes back to the saved date.
              if (!parseDateText(text) || isOutOfRange(parseDateText(text)!, minISO, maxISO)) {
                if (text !== '') setText(formatDateText(current));
              }
              const to = e.relatedTarget as Node | null;
              if (!open && !wrapperRef.current?.contains(to)) blurForm();
            }}
          />
          <button
            type="button"
            tabIndex={-1}
            disabled={disabled}
            aria-label={open ? 'Fechar calendário' : 'Abrir calendário'}
            className={cn(
              'grid size-7 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-bg-subtle hover:text-fg',
              open && 'bg-primary-soft text-primary-soft-fg hover:bg-primary-soft hover:text-primary-soft-fg',
            )}
            onClick={(e) => {
              e.stopPropagation();
              textRef.current?.focus();
              setOpen((o) => !o);
            }}
          >
            <CalendarDays className="size-4" />
          </button>
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          collisionPadding={12}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => {
            // Clicks on the field itself toggle the calendar there, not here.
            if (wrapperRef.current?.contains(e.target as Node)) e.preventDefault();
          }}
          className="z-50 w-[296px] rounded-2xl border border-border bg-surface p-3 shadow-lg data-[state=open]:animate-fade-in"
        >
          <Calendar
            value={isISODate(current) ? current : ''}
            min={minISO}
            max={maxISO}
            autoFocus={focusGrid}
            onSelect={pick}
            onClear={() => pick('')}
            onEscape={close}
          />
        </Popover.Content>
      </Popover.Portal>
      {/* Form value holder: keeps `name`, refs, onChange/onBlur and RHF registration working. */}
      <input
        ref={setRefs}
        {...nativeProps}
        {...(controlled ? { value, onChange: nativeProps.onChange ?? (() => {}) } : { defaultValue })}
        type="text"
        disabled={disabled}
        tabIndex={-1}
        aria-hidden
        className="sr-only"
      />
    </Popover.Root>
  );
});

interface CalendarProps {
  value: ISODate | '';
  min?: string | undefined;
  max?: string | undefined;
  autoFocus?: boolean;
  onSelect: (value: ISODate) => void;
  onClear: () => void;
  onEscape: () => void;
}

const navButton =
  'grid size-8 place-items-center rounded-full text-muted transition-colors hover:bg-bg-subtle hover:text-fg focus-visible:ring-[3px] focus-visible:ring-brand-500/25 outline-none disabled:pointer-events-none disabled:opacity-40';

/** Month grid with month/year shortcut; arrows, PageUp/PageDown, Home/End and Enter work like a native picker. */
export function Calendar({ value, min, max, autoFocus, onSelect, onClear, onEscape }: CalendarProps) {
  const today = todayISO();
  const [focused, setFocused] = useState<ISODate>(() => clampDate(value || today, min, max));
  const [view, setView] = useState<string>(() => monthKey(value || clampDate(today, min, max)));
  const [mode, setMode] = useState<'days' | 'months'>('days');
  const [year, setYear] = useState(() => Number(view.slice(0, 4)));
  const gridRef = useRef<HTMLDivElement | null>(null);
  const keyboard = useRef(Boolean(autoFocus));

  useEffect(() => {
    if (!keyboard.current || mode !== 'days') return;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-date="${focused}"]`)?.focus();
  }, [focused, mode, view]);

  function moveFocus(next: ISODate) {
    const clamped = clampDate(next, min, max);
    keyboard.current = true;
    setFocused(clamped);
    setView(monthKey(clamped));
  }

  function onGridKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const moves: Record<string, () => ISODate> = {
      ArrowLeft: () => addDays(focused, -1),
      ArrowRight: () => addDays(focused, 1),
      ArrowUp: () => addDays(focused, -7),
      ArrowDown: () => addDays(focused, 7),
      Home: () => startOfWeek(focused),
      End: () => endOfWeek(focused),
      PageUp: () => addMonths(focused, e.shiftKey ? -12 : -1),
      PageDown: () => addMonths(focused, e.shiftKey ? 12 : 1),
    };
    const move = moves[e.key];
    if (move) {
      e.preventDefault();
      moveFocus(move());
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onEscape();
    }
  }

  function stepMonth(delta: number) {
    const next = addMonthKey(view, delta);
    setView(next);
    // Keep the roving focus inside the visible month.
    const day = Math.min(Number(focused.slice(8, 10)), daysInMonth(Number(next.slice(0, 4)), Number(next.slice(5, 7))));
    setFocused(clampDate(`${next}-${String(day).padStart(2, '0')}`, min, max));
  }

  const minMonth = min ? monthKey(min) : undefined;
  const maxMonth = max ? monthKey(max) : undefined;
  const canPrev = !minMonth || view > minMonth;
  const canNext = !maxMonth || view < maxMonth;
  const todayDisabled = isOutOfRange(today, min, max);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => {
            setYear(Number(view.slice(0, 4)));
            setMode((m) => (m === 'days' ? 'months' : 'days'));
          }}
          aria-label={mode === 'days' ? 'Escolher mês e ano' : 'Voltar aos dias'}
          className="group/head flex h-8 items-center gap-1.5 rounded-full px-2.5 text-title font-semibold text-fg transition-colors hover:bg-bg-subtle focus-visible:ring-[3px] focus-visible:ring-brand-500/25 outline-none"
        >
          {mode === 'days' ? formatMonthKey(view) : year}
          <ChevronDown className={cn('size-4 text-muted transition-transform duration-150', mode === 'months' && 'rotate-180')} />
        </button>
        <div className="flex items-center gap-0.5">
          {mode === 'days' ? (
            <>
              <button type="button" className={navButton} aria-label="Mês anterior" disabled={!canPrev} onClick={() => stepMonth(-1)}>
                <ChevronLeft className="size-4" />
              </button>
              <button type="button" className={navButton} aria-label="Próximo mês" disabled={!canNext} onClick={() => stepMonth(1)}>
                <ChevronRight className="size-4" />
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className={navButton}
                aria-label="Ano anterior"
                disabled={!!minMonth && year <= Number(minMonth.slice(0, 4))}
                onClick={() => setYear((y) => y - 1)}
              >
                <ChevronLeft className="size-4" />
              </button>
              <button
                type="button"
                className={navButton}
                aria-label="Próximo ano"
                disabled={!!maxMonth && year >= Number(maxMonth.slice(0, 4))}
                onClick={() => setYear((y) => y + 1)}
              >
                <ChevronRight className="size-4" />
              </button>
            </>
          )}
        </div>
      </div>

      {mode === 'days' ? (
        <div ref={gridRef} role="group" aria-label={formatMonthKey(view)} onKeyDown={onGridKeyDown}>
          <div className="grid grid-cols-7" aria-hidden>
            {WEEKDAYS.map((d, i) => (
              <span key={i} title={WEEKDAY_NAMES[i]} className="grid h-8 place-items-center text-2xs font-semibold text-subtle uppercase">
                {d}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-y-0.5">
            {monthGrid(view).map((day) => {
              const outside = monthKey(day) !== view;
              const selected = day === value;
              const isToday = day === today;
              const blocked = isOutOfRange(day, min, max);
              return (
                <div key={day} className="grid place-items-center">
                  <button
                    type="button"
                    data-date={day}
                    tabIndex={day === focused ? 0 : -1}
                    disabled={blocked}
                    aria-label={spokenDate(day, MONTH_NAMES)}
                    aria-pressed={selected}
                    aria-current={isToday ? 'date' : undefined}
                    onClick={() => onSelect(day)}
                    onFocus={() => setFocused(day)}
                    className={cn(
                      'relative grid size-9 place-items-center rounded-full text-label tabular transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-brand-500/30',
                      selected
                        ? 'bg-primary font-semibold text-primary-fg shadow-xs hover:bg-primary-hover'
                        : cn(
                            'hover:bg-bg-subtle',
                            outside ? 'text-subtle/70' : 'text-fg',
                            isToday && 'font-semibold text-brand-text ring-1 ring-brand-500/40 ring-inset',
                          ),
                      blocked && 'cursor-not-allowed opacity-35 hover:bg-transparent',
                    )}
                  >
                    {Number(day.slice(8, 10))}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-1.5 py-1">
          {MONTH_SHORT.map((label, i) => {
            const key = `${year}-${String(i + 1).padStart(2, '0')}`;
            const active = key === view;
            const blocked = (!!minMonth && key < minMonth) || (!!maxMonth && key > maxMonth);
            return (
              <button
                key={key}
                type="button"
                disabled={blocked}
                aria-label={`${MONTH_NAMES[i]} de ${year}`}
                aria-pressed={active}
                onClick={() => {
                  setView(key);
                  setFocused(clampDate(`${key}-01`, min, max));
                  setMode('days');
                }}
                className={cn(
                  'h-11 rounded-xl text-label font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-brand-500/30 disabled:pointer-events-none disabled:opacity-35',
                  active ? 'bg-primary font-semibold text-primary-fg shadow-xs' : 'text-fg hover:bg-bg-subtle',
                  !active && key === monthKey(today) && 'text-brand-text ring-1 ring-brand-500/40 ring-inset',
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-between border-t border-border pt-2">
        <button
          type="button"
          onClick={onClear}
          className="h-8 rounded-full px-3 text-label font-medium text-muted transition-colors hover:bg-bg-subtle hover:text-fg focus-visible:ring-[3px] focus-visible:ring-brand-500/25 outline-none"
        >
          Limpar
        </button>
        <button
          type="button"
          disabled={todayDisabled}
          onClick={() => onSelect(today)}
          className="h-8 rounded-full bg-primary-soft px-3.5 text-label font-semibold text-primary-soft-fg transition-colors hover:bg-brand-200/70 focus-visible:ring-[3px] focus-visible:ring-brand-500/25 outline-none disabled:pointer-events-none disabled:opacity-40"
        >
          Hoje
        </button>
      </div>
    </div>
  );
}
