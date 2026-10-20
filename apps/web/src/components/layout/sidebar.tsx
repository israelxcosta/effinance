import { Link, NavLink, useLocation, useNavigate } from 'react-router';
import { LogOut, Moon, Settings, Sun, UserRound } from 'lucide-react';
import { cn, initials } from '@/lib/utils';
import { useTheme } from '@/lib/theme';
import { useAuth } from '@/features/auth/auth-context';
import { Tooltip } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { NAV_ITEMS, SETTINGS_ITEM } from './nav';

export function Sidebar() {
  const { user, logout } = useAuth();
  const { resolved, toggle } = useTheme();
  const navigate = useNavigate();

  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[76px] flex-col items-center border-r border-border bg-bg-subtle py-5 lg:flex">
      <NavLink to="/" className="mb-6 text-[13px] font-extrabold tracking-tight text-fg" aria-label="Effinance — início">
        Effinance
      </NavLink>
      <nav aria-label="Navegação principal" className="flex flex-1 flex-col items-center gap-1.5 overflow-y-auto scrollbar-thin">
        {NAV_ITEMS.map((item) => (
          <SidebarLink key={item.to} {...item} />
        ))}
      </nav>
      <div className="mt-4 flex flex-col items-center gap-3">
        <SidebarLink {...SETTINGS_ITEM} />
        <span className="rounded-md bg-primary px-1.5 py-0.5 text-[10px] font-extrabold tracking-wider text-primary-fg">PRO</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex size-10 items-center justify-center rounded-full bg-primary-soft text-[13px] font-bold text-primary-soft-fg ring-2 ring-surface transition-transform hover:scale-105"
              aria-label="Menu do usuário"
            >
              {initials(user?.name)}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="end" sideOffset={12}>
            <DropdownMenuLabel>Conta</DropdownMenuLabel>
            <div className="px-2.5 pb-2">
              <p className="text-sm font-semibold">{user?.name}</p>
              <p className="text-xs text-muted">{user?.email}</p>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem icon={<UserRound />} onSelect={() => navigate('/configuracoes')}>
              Perfil
            </DropdownMenuItem>
            <DropdownMenuItem icon={resolved === 'dark' ? <Sun /> : <Moon />} onSelect={toggle}>
              {resolved === 'dark' ? 'Tema claro' : 'Tema escuro'}
            </DropdownMenuItem>
            <DropdownMenuItem icon={<Settings />} onSelect={() => navigate('/configuracoes')}>
              Configurações
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              icon={<LogOut />}
              tone="danger"
              onSelect={async () => {
                await logout();
                navigate('/login', { replace: true });
              }}
            >
              Sair
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}

function SidebarLink({ to, label, icon: Icon }: { to: string; label: string; icon: React.ComponentType<{ className?: string }> }) {
  const { pathname } = useLocation();
  const isActive = to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`);
  // Plain Link with a string className: Tooltip's Slot cannot merge NavLink's function className.
  return (
    <Tooltip content={label} side="right" delay={150}>
      <Link
        to={to}
        aria-label={label}
        aria-current={isActive ? 'page' : undefined}
        className={cn(
          'flex size-11 shrink-0 items-center justify-center rounded-md transition-all duration-150',
          isActive
            ? 'bg-surface text-primary shadow-sm ring-1 ring-border dark:text-fg'
            : 'text-muted hover:bg-surface/70 hover:text-fg',
        )}
      >
        <Icon className="size-5" />
      </Link>
    </Tooltip>
  );
}
