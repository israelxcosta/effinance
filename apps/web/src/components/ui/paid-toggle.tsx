import { useEffect, useRef, useState } from 'react';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip } from './tooltip';

interface PaidToggleProps {
  paid: boolean;
  onToggle: (paid: boolean) => void;
  /** 'expense' → Pago/Pendente; 'income' → Recebido/A receber. */
  kind?: 'expense' | 'income' | 'transfer';
  disabled?: boolean;
  disabledReason?: string;
  size?: 'sm' | 'md';
  loading?: boolean;
}

/** 👍 paid / 👎 pending (default). Pops when toggled. */
export function PaidToggle({ paid, onToggle, kind = 'expense', disabled, disabledReason, size = 'md', loading }: PaidToggleProps) {
  const [animate, setAnimate] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setAnimate(true);
    const t = setTimeout(() => setAnimate(false), 300);
    return () => clearTimeout(t);
  }, [paid]);

  const paidLabel = kind === 'income' ? 'Recebido' : kind === 'transfer' ? 'Efetivada' : 'Pago';
  const pendingLabel = kind === 'income' ? 'A receber' : kind === 'transfer' ? 'Agendada' : 'Pendente';
  const label = paid ? `${paidLabel} — clique para marcar como ${pendingLabel.toLowerCase()}` : `${pendingLabel} — clique para marcar como ${paidLabel.toLowerCase()}`;
  const Icon = paid ? ThumbsUp : ThumbsDown;

  return (
    <Tooltip content={disabled ? disabledReason : paid ? paidLabel : pendingLabel}>
      <button
        type="button"
        aria-pressed={paid}
        aria-label={disabled ? (disabledReason ?? label) : label}
        disabled={disabled || loading}
        onClick={(e) => {
          e.stopPropagation();
          onToggle(!paid);
        }}
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded-full transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60',
          size === 'sm' ? 'size-8' : 'size-9',
          paid ? 'bg-success-soft text-success hover:brightness-95' : 'bg-danger-soft text-danger hover:brightness-95',
          animate && 'animate-pop',
          loading && 'opacity-70',
        )}
      >
        <Icon className={size === 'sm' ? 'size-3.5' : 'size-4'} aria-hidden fill={paid ? 'currentColor' : 'none'} fillOpacity={0.15} />
      </button>
    </Tooltip>
  );
}
