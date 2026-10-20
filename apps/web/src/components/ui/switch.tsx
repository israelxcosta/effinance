import { Switch as S } from 'radix-ui';
import { cn } from '@/lib/utils';

interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  id?: string;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
}

export function Switch({ className, ...props }: SwitchProps) {
  return (
    <S.Root
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full bg-border-strong transition-colors data-[state=checked]:bg-primary disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <S.Thumb className="block size-5 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform duration-150 data-[state=checked]:translate-x-[22px]" />
    </S.Root>
  );
}
