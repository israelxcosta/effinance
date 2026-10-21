import type { ReactNode } from 'react';
import { Dialog } from 'radix-ui';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /** Content between the header and the scrolling body (e.g. a segmented control). */
  headerExtra?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  /** md 460px (forms), lg 620px, xl 1040px (tables such as the import review). */
  width?: 'md' | 'lg' | 'xl';
}

/** Side panel used by every create/edit form (design: "Nova Transação"). */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  headerExtra,
  footer,
  children,
  className,
  width = 'md',
}: SheetProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/25 backdrop-blur-[2px] data-[state=open]:animate-fade-in dark:bg-black/50" />
        <Dialog.Content
          className={cn(
            'fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-surface shadow-lg outline-none data-[state=closed]:animate-sheet-out data-[state=open]:animate-sheet-in sm:inset-y-2 sm:right-2 sm:rounded-2xl sm:border sm:border-border',
            width === 'md' ? 'sm:max-w-[460px]' : width === 'lg' ? 'sm:max-w-[620px]' : 'sm:max-w-[1040px]',
            className,
          )}
          onOpenAutoFocus={(e) => {
            // Focus the first field instead of the close button.
            const target = (e.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>(
              '[data-autofocus], input:not([type=hidden]):not([disabled]), textarea, select',
            );
            if (target) {
              e.preventDefault();
              target.focus();
            }
          }}
        >
          <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-4">
            <div className="min-w-0">
              <Dialog.Title className="text-xl font-semibold tracking-tight text-fg">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-1 text-sm text-muted">{description}</Dialog.Description>
              ) : (
                <Dialog.Description className="sr-only">Formulário</Dialog.Description>
              )}
            </div>
            <Dialog.Close
              className="-mr-2 -mt-1 flex size-9 items-center justify-center rounded-md text-muted transition-colors hover:bg-bg-subtle hover:text-fg"
              aria-label="Fechar"
            >
              <X className="size-5" />
            </Dialog.Close>
          </div>
          {headerExtra ? <div className="px-6 pb-4">{headerExtra}</div> : null}
          <div className="scrollbar-thin flex-1 overflow-y-auto border-t border-border px-6 py-5">{children}</div>
          {footer ? (
            <div className="flex items-center justify-end gap-2 border-t border-border bg-surface px-6 py-4 sm:rounded-b-2xl">
              {footer}
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
