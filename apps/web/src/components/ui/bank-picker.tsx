import { BANKS } from '@effinance/shared';
import { cn } from '@/lib/utils';
import { BankLogo } from './bank-logo';

interface BankPickerProps {
  value: string | null;
  onChange: (code: string | null) => void;
  allowNone?: boolean;
}

/** Grid of the main Brazilian banks (brand colored badges). */
export function BankPicker({ value, onChange, allowNone = true }: BankPickerProps) {
  return (
    <div role="radiogroup" aria-label="Banco" className="grid grid-cols-4 gap-2 sm:grid-cols-5">
      {allowNone ? (
        <BankOption active={!value} label="Nenhum" onClick={() => onChange(null)}>
          <BankLogo bank={null} color="#9A9EA5" size="sm" />
        </BankOption>
      ) : null}
      {BANKS.map((b) => (
        <BankOption key={b.code} active={value === b.code} label={b.name} onClick={() => onChange(b.code)}>
          <BankLogo bank={b.code} size="sm" />
        </BankOption>
      ))}
    </div>
  );
}

function BankOption({ active, label, onClick, children }: { active: boolean; label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      title={label}
      className={cn(
        'flex flex-col items-center gap-1.5 rounded-md border px-1 py-2 text-[10px] font-medium transition-all',
        active ? 'border-brand-500 bg-primary-soft/60 text-fg ring-1 ring-brand-500' : 'border-border text-muted hover:border-border-strong hover:text-fg',
      )}
    >
      {children}
      <span className="w-full truncate text-center">{label}</span>
    </button>
  );
}
