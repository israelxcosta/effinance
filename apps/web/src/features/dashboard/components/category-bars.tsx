import { formatBRL, formatPercent, type CategoryAmount } from '@effinance/shared';
import { Tooltip } from '@/components/ui/tooltip';
import { useTone } from '@/lib/theme';
import { cn } from '@/lib/utils';

/**
 * Horizontal bars by category (length = share of the biggest), amount and share on hover.
 * `expense`: bar on the left growing rightwards, legend on the right. `income`: mirrored — legend on
 * the left, bar growing leftwards from the right edge.
 */
export function CategoryBars({
  data,
  maxItems = 8,
  onSelect,
  direction = 'expense',
  fill = false,
}: {
  data: CategoryAmount[];
  maxItems?: number;
  onSelect?: (c: CategoryAmount) => void;
  direction?: 'expense' | 'income';
  /** Spread the rows over the available height (card taller than the list). */
  fill?: boolean;
}) {
  const mirrored = direction === 'income';
  const tone = useTone();
  const sorted = [...data].sort((a, b) => b.amount - a.amount);
  const head = sorted.slice(0, maxItems);
  const rest = sorted.slice(maxItems);
  const items = rest.length
    ? [...head, { categoryId: null, name: 'Outros', icon: 'tag', color: '#9A9EA5', amount: rest.reduce((s, r) => s + r.amount, 0), share: rest.reduce((s, r) => s + r.share, 0) } as CategoryAmount]
    : head;
  const max = Math.max(1, ...items.map((i) => i.amount));
  return (
    <ul className={cn('flex flex-col gap-2.5', fill && 'h-full justify-between')}>
      {items.map((c) => {
        const color = tone(c.color || '#9A9EA5');
        const clickable = Boolean(onSelect && c.categoryId);
        return (
          <li key={c.categoryId ?? c.name}>
            <Tooltip
              content={
                <span className="tabular">
                  {c.name}: <strong>{formatBRL(c.amount)}</strong> · {formatPercent(c.share, 0)}
                </span>
              }
            >
              <button
                type="button"
                onClick={() => clickable && onSelect?.(c)}
                className={cn(
                  'group grid w-full items-center gap-3 rounded-md py-0.5 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-brand-500/25',
                  mirrored ? 'grid-cols-[9.5rem_minmax(0,1fr)]' : 'grid-cols-[minmax(0,1fr)_9.5rem]',
                  !clickable && 'cursor-default',
                )}
                aria-label={`${c.name}: ${formatBRL(c.amount)} (${formatPercent(c.share, 0)})`}
              >
                <span className={cn('flex h-7 overflow-hidden rounded-md bg-bg-subtle', mirrored && 'order-2 justify-end')}>
                  <span
                    className="block h-full rounded-md transition-[filter,width] duration-300 group-hover:brightness-110"
                    style={{ width: `${Math.max(3, (c.amount / max) * 100)}%`, backgroundColor: color }}
                  />
                </span>
                <span className={cn('flex min-w-0 items-center gap-2 text-label', mirrored && 'order-1')}>
                  <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                  <span className="truncate text-fg">{c.name}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted tabular">{formatPercent(c.share, 0)}</span>
                </span>
              </button>
            </Tooltip>
          </li>
        );
      })}
    </ul>
  );
}
