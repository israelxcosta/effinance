import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeftRight, CircleMinus, CirclePlus, CreditCard, Search } from 'lucide-react';
import { useTransactionActions } from '@/features/transactions/transaction-actions';
import { cn } from '@/lib/utils';
import { WriteGate } from '@/features/auth/permissions';
import { Tooltip } from '@/components/ui/tooltip';
import { Notifications } from './notifications';

/** Icon-only action: the name shows on hover/focus and is the button's accessible name. `disabled` comes from WriteGate. */
function Action({ label, className, onClick, disabled, children }: { label: string; className?: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        disabled={disabled}
        className={cn(
          'inline-flex size-9 items-center justify-center rounded-full transition-colors hover:bg-bg-subtle disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-[18px]',
          className,
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

/** Floating quick-action bar (desktop), Graniq style: icons only. */
export function QuickBar({ onSearch }: { onSearch: () => void }) {
  const actions = useTransactionActions();
  const navigate = useNavigate();
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-20 hidden justify-center lg:flex lg:pl-[76px]">
      <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-border bg-surface/95 p-1.5 shadow-lg backdrop-blur">
        <Action label="Buscar ou executar ação (Ctrl+K)" onClick={onSearch} className="bg-primary text-primary-fg hover:bg-primary-hover">
          <Search />
        </Action>
        <span className="mx-0.5 h-6 w-px bg-border" aria-hidden />
        {/* Different shapes, not only colors: minus for expense, plus for income. */}
        <WriteGate>
          <Action label="Nova despesa" className="text-danger" onClick={() => actions.openTransaction({ type: 'expense' })}>
            <CircleMinus />
          </Action>
        </WriteGate>
        <WriteGate>
          <Action label="Nova receita" className="text-success" onClick={() => actions.openTransaction({ type: 'income' })}>
            <CirclePlus />
          </Action>
        </WriteGate>
        <WriteGate>
          <Action label="Transferir" className="text-muted hover:text-fg" onClick={() => actions.openTransfer('transfer')}>
            <ArrowLeftRight />
          </Action>
        </WriteGate>
        <Action label="Faturas dos cartões" className="text-muted hover:text-fg" onClick={() => navigate('/cartoes')}>
          <CreditCard />
        </Action>
        <span className="mx-0.5 h-6 w-px bg-border" aria-hidden />
        <Notifications />
      </div>
    </div>
  );
}
