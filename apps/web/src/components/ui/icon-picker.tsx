import { ICON_NAMES, type IconName } from '@effinance/shared';
import { ICONS } from '@/lib/icons';
import { alpha, cn } from '@/lib/utils';

interface IconPickerProps {
  value: string;
  onChange: (icon: IconName) => void;
  color?: string;
}

export function IconPicker({ value, onChange, color = '#152B61' }: IconPickerProps) {
  return (
    <div role="radiogroup" aria-label="Ícone" className="grid grid-cols-8 gap-1.5">
      {ICON_NAMES.map((name) => {
        const Icon = ICONS[name];
        const active = value === name;
        return (
          <button
            key={name}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={name}
            title={name}
            onClick={() => onChange(name)}
            className={cn(
              'flex aspect-square items-center justify-center rounded-[10px] border transition-all [&_svg]:size-[18px]',
              active ? 'border-transparent ring-2 ring-offset-1 ring-offset-surface' : 'border-border text-muted hover:border-border-strong hover:text-fg',
            )}
            style={active ? { backgroundColor: alpha(color, 0.12), color, ['--tw-ring-color' as string]: color } : undefined}
          >
            <Icon />
          </button>
        );
      })}
    </div>
  );
}
