import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeftRight,
  Bell,
  CalendarDays,
  ChevronDown,
  Minus,
  Moon,
  Plus,
  Search,
  Sparkles,
  Sun,
  TrendingUp,
} from 'lucide-react';
import { formatBRL, formatDateBR, todayISO, type TransactionListResponse } from '@effinance/shared';
import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { firstName, greeting } from '@/lib/utils';
import { useTheme } from '@/lib/theme';
import { useAuth } from '@/features/auth/auth-context';
import { useTransactionActions } from '@/features/transactions/transaction-actions';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function Topbar({ onSearch }: { onSearch: () => void }) {
  const { user } = useAuth();
  const { resolved, toggle } = useTheme();
  const actions = useTransactionActions();
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-bg/85 backdrop-blur-md">
      <div className="mx-auto flex h-[72px] max-w-[1440px] items-center gap-3 px-4 sm:px-6">
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold tracking-tight text-fg sm:text-[22px]">
          {greeting()}, {firstName(user?.name) || 'você'} <span aria-hidden>👋</span>
        </h1>

        <button
          type="button"
          onClick={onSearch}
          className="hidden h-11 w-[300px] items-center gap-2.5 rounded-xl border border-border bg-surface px-3.5 text-sm text-subtle shadow-xs transition-colors hover:border-border-strong md:flex xl:w-[380px]"
          aria-label="Buscar (atalho Ctrl+K)"
        >
          <Search className="size-4 text-muted" />
          <span className="min-w-0 flex-1 truncate text-left">Buscar transações, contas ou categorias</span>
          <kbd className="rounded-md bg-bg-subtle px-1.5 py-0.5 text-[11px] font-semibold text-muted">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
        </button>
        <Button variant="outline" size="icon" className="rounded-xl md:hidden" onClick={onSearch} aria-label="Buscar">
          <Search />
        </Button>

        <Button variant="soft" size="lg" className="hidden rounded-xl xl:inline-flex" asChild>
          <Link to="/?aba=insights">
            <Sparkles /> Insights
          </Link>
        </Button>

        <Tooltip content="Contas a pagar">
          <Button variant="outline" size="icon" className="hidden rounded-xl sm:inline-flex" asChild>
            <Link to="/contas-a-pagar" aria-label="Contas a pagar">
              <CalendarDays />
            </Link>
          </Button>
        </Tooltip>
        <Notifications />
        <Tooltip content={resolved === 'dark' ? 'Tema claro' : 'Tema escuro'}>
          <Button variant="outline" size="icon" className="hidden rounded-xl sm:inline-flex" onClick={toggle} aria-label="Alternar tema">
            {resolved === 'dark' ? <Sun /> : <Moon />}
          </Button>
        </Tooltip>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="lg" className="hidden rounded-xl sm:inline-flex">
              <Plus /> <span className="hidden lg:inline">Nova transação</span>
              <ChevronDown className="opacity-70" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem icon={<Plus className="text-success" />} onSelect={() => actions.openTransaction({ type: 'income' })}>
              Receita
            </DropdownMenuItem>
            <DropdownMenuItem icon={<Minus className="text-danger" />} onSelect={() => actions.openTransaction({ type: 'expense' })}>
              Despesa
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem icon={<ArrowLeftRight />} onSelect={() => actions.openTransfer('transfer')}>
              Transferência
            </DropdownMenuItem>
            <DropdownMenuItem icon={<TrendingUp />} onSelect={() => actions.openTransfer('investment')}>
              Investimento
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

function Notifications() {
  const navigate = useNavigate();
  const actions = useTransactionActions();
  const overdue = useQuery({
    queryKey: qk.transactions({ status: 'overdue', bell: true }),
    queryFn: () =>
      api<TransactionListResponse>('/transactions', {
        query: { status: 'overdue', to: todayISO(), pageSize: 100, sort: 'date_asc' },
      }),
    staleTime: 60_000,
    // Card purchases are settled through the invoice, so they are not "overdue bills".
    select: (data) => data.items.filter((t) => !(t.creditCardId && t.type !== 'transfer')),
  });
  const items = overdue.data ?? [];
  const count = items.length;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" className="relative rounded-xl" aria-label={`Notificações${count ? ` (${count} vencidas)` : ''}`}>
          <Bell />
          {count ? (
            <span className="absolute -top-1 -right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
              {count > 9 ? '9+' : count}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-80">
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
