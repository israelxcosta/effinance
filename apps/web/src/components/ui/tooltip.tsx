import type { ReactNode } from 'react';
import { Tooltip as T } from 'radix-ui';

export const TooltipProvider = T.Provider;

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  delay?: number;
}

export function Tooltip({ content, children, side = 'top', delay }: TooltipProps) {
  if (!content) return <>{children}</>;
  return (
    <T.Root delayDuration={delay}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={8}
          className="z-[60] max-w-xs rounded-md bg-fg px-2.5 py-1.5 text-xs font-medium text-bg shadow-lg data-[state=delayed-open]:animate-fade-in"
        >
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
