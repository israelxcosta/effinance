import { formatBRL, formatPercent, type CategoryAmount } from '@effinance/shared';
import { Tooltip } from '@/components/ui/tooltip';
import { useTone } from '@/lib/theme';
import { cn } from '@/lib/utils';

/**
 * Horizontal bars by category: bar on the left (length = share of the biggest), legend on the right,
 * amount and share on hover.
 */
export function CategoryBars({
  data,
  maxItems = 8,
  onSelect,
}: {
  data: CategoryAmount[];
  maxItems?: number;
  onSelect?: (c: CategoryAmount) => void;
}) {
  const tone = useTone();
  const sorted = [...data].sort((a, b) => b.amount - a.amount);
  const head = sorted.slice(0, maxItems);
  const rest = sorted.slice(maxItems);
  const items = rest.length
    ? [...head, { categoryId: null, name: 'Outros', icon: 'tag', color: '#9A9EA5', amount: rest.reduce((s, r) => s + r.amount, 0), share: rest.reduce((s, r) => s + r.share, 0) } as CategoryAmount]
    : head;
  const max = Math.max(1, ...items.map((i) => i.amount));
  return (
    <ul className="flex flex-col gap-2.5">
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
                  'group grid w-full grid-cols-[minmax(0,1fr)_9.5rem] items-center gap-3 rounded-md py-0.5 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-brand-500/25',
                  !clickable && 'cursor-default',
                )}
                aria-label={`${c.name}: ${formatBRL(c.amount)} (${formatPercent(c.share, 0)})`}
              >
                <span className="h-7 overflow-hidden rounded-md bg-bg-subtle">
                  <span
                    className="block h-full rounded-md transition-[filter,width] duration-300 group-hover:brightness-110"
                    style={{ width: `${Math.max(3, (c.amount / max) * 100)}%`, backgroundColor: color }}
                  />
                </span>
                <span className="flex min-w-0 items-center gap-2 text-label">
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
