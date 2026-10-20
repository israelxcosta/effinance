import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router';
import { ArrowLeftRight, LogOut, Menu, Minus, Plus, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/features/auth/auth-context';
import { useTransactionActions } from '@/features/transactions/transaction-actions';
import { Sheet } from '@/components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { NAV_ITEMS, SETTINGS_ITEM } from './nav';

export function MobileNav() {
  const actions = useTransactionActions();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const items = NAV_ITEMS.filter((i) => i.mobile);
  const link = ({ isActive }: { isActive: boolean }) =>
    cn('flex flex-1 flex-col items-center gap-1 py-2 text-[10px] font-semibold', isActive ? 'text-primary dark:text-brand-300' : 'text-muted');

  return (
    <>
      <nav
        aria-label="Navegação"
        className="fixed inset-x-0 bottom-0 z-30 flex items-center border-t border-border bg-surface/95 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      >
        {items.slice(0, 2).map((i) => (
          <NavLink key={i.to} to={i.to} end={i.to === '/'} className={link}>
            <i.icon className="size-5" />
            {i.label.split(' ')[0]}
          </NavLink>
        ))}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Nova transação"
              className="mx-2 -mt-6 flex size-14 items-center justify-center rounded-full bg-primary text-primary-fg shadow-lg ring-4 ring-bg"
            >
              <Plus className="size-6" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" side="top" sideOffset={10}>
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
        {items.slice(2, 3).map((i) => (
          <NavLink key={i.to} to={i.to} className={link}>
            <i.icon className="size-5" />
            {i.label.split(' ')[0]}
          </NavLink>
        ))}
        <button type="button" className="flex flex-1 flex-col items-center gap-1 py-2 text-[10px] font-semibold text-muted" onClick={() => setMenuOpen(true)}>
          <Menu className="size-5" />
          Mais
        </button>
      </nav>
      <Sheet open={menuOpen} onOpenChange={setMenuOpen} title="Menu" description="Todas as seções do Effinance">
        <div className="flex flex-col gap-1">
          {[...NAV_ITEMS, SETTINGS_ITEM].map((i) => (
            <NavLink
              key={i.to}
              to={i.to}
              end={i.to === '/'}
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) =>
                cn('flex items-center gap-3 rounded-md px-3 py-3 text-sm font-semibold', isActive ? 'bg-primary-soft text-primary-soft-fg' : 'text-fg hover:bg-bg-subtle')
              }
            >
              <i.icon className="size-5" /> {i.label}
            </NavLink>
          ))}
          <button
            type="button"
            className="mt-2 flex items-center gap-3 rounded-md px-3 py-3 text-sm font-semibold text-danger hover:bg-danger-soft"
            onClick={async () => {
              await logout();
              navigate('/login', { replace: true });
            }}
          >
            <LogOut className="size-5" /> Sair
          </button>
        </div>
      </Sheet>
    </>
  );
}
