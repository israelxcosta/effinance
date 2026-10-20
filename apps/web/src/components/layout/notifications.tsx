import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { formatBRL, formatDateBR, todayISO, type TransactionListResponse } from '@effinance/shared';
import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { cn } from '@/lib/utils';
import { useTransactionActions } from '@/features/transactions/transaction-actions';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/** Overdue bills (payables and receivables). Card purchases are settled through the invoice. */
export function useOverdueBills() {
  return useQuery({
    queryKey: qk.transactions({ status: 'overdue', bell: true }),
    queryFn: () =>
      api<TransactionListResponse>('/transactions', {
        query: { status: 'overdue', to: todayISO(), pageSize: 100, sort: 'date_asc' },
      }),
    staleTime: 60_000,
    select: (data) => data.items.filter((t) => !(t.creditCardId && t.type !== 'transfer')),
  });
}

/** Bell with the overdue count; lives in the floating quick-action bar. */
export function Notifications({ className }: { className?: string }) {
  const navigate = useNavigate();
  const actions = useTransactionActions();
  const items = useOverdueBills().data ?? [];
  const count = items.length;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'relative inline-flex size-9 items-center justify-center rounded-full text-muted transition-colors hover:bg-bg-subtle hover:text-fg [&_svg]:size-4',
            className,
          )}
          aria-label={`Notificações${count ? ` (${count} vencidas)` : ''}`}
        >
          <Bell />
          {count ? (
            <span className="absolute -top-0.5 -right-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white ring-2 ring-surface">
              {count > 9 ? '9+' : count}
            </span>
          ) : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-80" side="top" align="end" sideOffset={12}>
        <DropdownMenuLabel>Vencidas</DropdownMenuLabel>
        {count === 0 ? (
          <p className="px-2.5 py-3 text-sm text-muted">Tudo em dia por aqui. 🎉</p>
        ) : (
          items.slice(0, 6).map((t) => (
            <DropdownMenuItem key={t.id} onSelect={() => actions.edit(t)}>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{t.description}</span>
                <span className="text-xs text-danger">Venceu em {formatDateBR(t.date)}</span>
              </span>
              <span className={t.type === 'income' ? 'tabular font-semibold text-success' : 'tabular font-semibold text-danger'}>
                {formatBRL(t.amount)}
              </span>
            </DropdownMenuItem>
          ))
        )}
        {count > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => navigate('/contas-a-pagar?status=overdue')}>Ver todas as vencidas</DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
