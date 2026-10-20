import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}

export function EmptyState({ icon, title, description, action, className, compact }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border border-dashed border-border-strong/80 text-center',
        compact ? 'gap-1.5 px-4 py-6' : 'gap-2 px-6 py-10',
        className,
      )}
    >
      {icon ? (
        <div className="mb-1 flex size-11 items-center justify-center rounded-md bg-bg-subtle text-muted [&_svg]:size-5">
          {icon}
        </div>
      ) : null}
      <p className="text-sm font-semibold text-fg">{title}</p>
      {description ? <p className="max-w-sm text-xs leading-relaxed text-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
