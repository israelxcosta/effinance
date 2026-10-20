import type { ComponentProps, ReactNode } from 'react';
import { DropdownMenu as DM } from 'radix-ui';
import { cn } from '@/lib/utils';

export const DropdownMenu = DM.Root;
export const DropdownMenuTrigger = DM.Trigger;

export function DropdownMenuContent({ className, align = 'end', sideOffset = 6, ...props }: ComponentProps<typeof DM.Content>) {
  return (
    <DM.Portal>
      <DM.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'z-50 min-w-[200px] overflow-hidden rounded-lg border border-border bg-surface p-1.5 shadow-lg data-[state=open]:animate-fade-in',
          className,
        )}
        {...props}
      />
    </DM.Portal>
  );
}

interface ItemProps extends ComponentProps<typeof DM.Item> {
  icon?: ReactNode;
  tone?: 'default' | 'danger';
}

export function DropdownMenuItem({ className, icon, tone = 'default', children, ...props }: ItemProps) {
  return (
    <DM.Item
      className={cn(
        'flex cursor-pointer select-none items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-bg-subtle [&_svg]:size-4',
        tone === 'danger' ? 'text-danger data-[highlighted]:bg-danger-soft' : 'text-fg',
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </DM.Item>
  );
}

export function DropdownMenuSeparator({ className }: { className?: string }) {
  return <DM.Separator className={cn('my-1 h-px bg-border', className)} />;
}

export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof DM.Label>) {
  return <DM.Label className={cn('eyebrow px-2.5 pt-1.5 pb-1 text-subtle', className)} {...props} />;
}
