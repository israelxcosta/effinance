import { useNavigate } from 'react-router';
import { ArrowLeftRight, CreditCard, Plus, Search } from 'lucide-react';
import { useTransactionActions } from '@/features/transactions/transaction-actions';
import { cn } from '@/lib/utils';
import { WriteGate } from '@/features/auth/permissions';
import { Notifications } from './notifications';

/** Floating quick-action bar (desktop), Graniq style. */
export function QuickBar({ onSearch }: { onSearch: () => void }) {
  const actions = useTransactionActions();
  const navigate = useNavigate();
  const btn =
    'inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold transition-colors hover:bg-bg-subtle disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-4';
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-20 hidden justify-center lg:flex lg:pl-[76px]">
      <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-border bg-surface/95 p-1.5 pl-2 shadow-lg backdrop-blur">
        <button type="button" onClick={onSearch} className="mr-1 flex h-9 items-center gap-2 rounded-full pr-3 pl-1 text-sm text-subtle hover:text-muted">
          <span className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-fg">
            <Search className="size-4" />
          </span>
          <span className="w-44 text-left">Buscar ou executar ação…</span>
        </button>
        <span className="h-6 w-px bg-border" aria-hidden />
        <WriteGate>
          <button type="button" className={cn(btn, 'text-danger')} onClick={() => actions.openTransaction({ type: 'expense' })}>
            <Plus /> Despesa
          </button>
        </WriteGate>
        <WriteGate>
          <button type="button" className={cn(btn, 'text-success')} onClick={() => actions.openTransaction({ type: 'income' })}>
            <Plus /> Receita
          </button>
        </WriteGate>
        <WriteGate>
          <button type="button" className={cn(btn, 'text-muted hover:text-fg')} onClick={() => actions.openTransfer('transfer')}>
            <ArrowLeftRight /> Transferir
          </button>
        </WriteGate>
        <button type="button" className={cn(btn, 'text-muted hover:text-fg')} onClick={() => navigate('/cartoes')}>
          <CreditCard /> Fatura
        </button>
        <span className="mx-0.5 h-6 w-px bg-border" aria-hidden />
        <Notifications />
      </div>
    </div>
  );
}

