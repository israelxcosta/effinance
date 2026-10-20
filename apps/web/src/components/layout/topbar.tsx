import { firstName, greeting } from '@/lib/utils';
import { useAuth } from '@/features/auth/auth-context';

/**
 * Greeting band. Actions live elsewhere: search and quick actions in the floating bar (and ⌘K),
 * notifications next to "Fatura", theme in the avatar menu and Configurações.
 */
export function Topbar() {
  const { user } = useAuth();
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-bg/85 backdrop-blur-md">
      <div className="mx-auto flex h-[72px] max-w-[1440px] items-center px-4 sm:px-6">
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold tracking-tight text-fg sm:text-[22px]">
          {greeting()}, {firstName(user?.name) || 'você'} <span aria-hidden>👋</span>
        </h1>
      </div>
    </header>
  );
}
