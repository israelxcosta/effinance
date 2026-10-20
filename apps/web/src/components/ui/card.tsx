import type { HTMLAttributes, ReactNode } from 'react';
import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip } from './tooltip';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-xl border border-border bg-surface shadow-xs', className)} {...props} />;
}

interface CardHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  info?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}

export function CardHeader({ title, subtitle, info, action, icon, className }: CardHeaderProps) {
  return (
    <div className={cn('flex items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <h2 className="truncate text-[15px] font-semibold tracking-tight text-fg">{title}</h2>
          {info ? (
            <Tooltip content={info}>
              <button type="button" className="text-subtle hover:text-muted" aria-label="Mais informações">
                <Info className="size-3.5" />
              </button>
            </Tooltip>
          ) : null}
        </div>
        {subtitle ? <p className="mt-0.5 text-xs text-muted">{subtitle}</p> : null}
      </div>
      {action ?? (icon ? <span className="text-muted [&_svg]:size-4">{icon}</span> : null)}
    </div>
  );
}

export function SectionLabel({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('eyebrow text-brand-text', className)} {...props} />;
}
