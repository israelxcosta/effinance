import { getIcon } from '@/lib/icons';
import { alpha, cn } from '@/lib/utils';
import { useTone } from '@/lib/theme';

interface CategoryIconProps {
  icon: string | null | undefined;
  color: string | null | undefined;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZES = {
  sm: 'size-8 rounded-[10px] [&_svg]:size-4',
  md: 'size-10 rounded-md [&_svg]:size-[18px]',
  lg: 'size-12 rounded-lg [&_svg]:size-5',
} as const;

export function CategoryIcon({ icon, color, size = 'md', className }: CategoryIconProps) {
  const Icon = getIcon(icon);
  const tone = useTone();
  const c = tone(color ?? '#6B6F76');
  return (
    <span
      aria-hidden
      className={cn('inline-flex shrink-0 items-center justify-center', SIZES[size], className)}
      style={{ backgroundColor: alpha(c, 0.12), color: c }}
    >
      <Icon />
    </span>
  );
}
