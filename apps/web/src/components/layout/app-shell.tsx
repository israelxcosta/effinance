import { Suspense, useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '@/features/auth/auth-context';
import { TransactionActionsProvider } from '@/features/transactions/transaction-actions';
import { Skeleton } from '@/components/ui/skeleton';
import { Sidebar } from './sidebar';
import { QuickBar } from './quick-bar';
import { MobileNav } from './mobile-nav';
import { CommandPalette } from './command-palette';
import { IS_DEMO } from '@/lib/demo';
import { DemoBanner } from './demo-banner';

export function AppShell() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  if (loading) return <FullPageLoader />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;

  return (
    <TransactionActionsProvider>
      <div className="min-h-dvh">
        <Sidebar />
        <div className="lg:pl-[76px]">
          <main className="mx-auto max-w-[1440px] px-4 pt-6 pb-28 sm:px-6 lg:pt-8 lg:pb-32">
            <DemoBanner />
            <Suspense fallback={<PageLoader />}>
              <Outlet />
            </Suspense>
          </main>
        </div>
        <QuickBar onSearch={() => setPaletteOpen(true)} />
        <MobileNav onSearch={() => setPaletteOpen(true)} />
        <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      </div>
    </TransactionActionsProvider>
  );
}

export function FullPageLoader() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3" aria-busy="true">
      <span className="text-lg font-extrabold tracking-tight text-fg">effinance</span>
      <span className="h-1 w-24 overflow-hidden rounded-full bg-bg-subtle">
        <span className="block h-full w-1/2 animate-shimmer rounded-full bg-primary" />
      </span>
      {IS_DEMO ? <span className="text-xs text-muted">Preparando o ambiente de testes…</span> : null}
    </div>
  );
}

function PageLoader() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <Skeleton className="h-8 w-60" />
      <div className="grid gap-4 md:grid-cols-3">
        <Skeleton className="h-36 rounded-xl" />
        <Skeleton className="h-36 rounded-xl" />
        <Skeleton className="h-36 rounded-xl" />
      </div>
      <Skeleton className="h-80 rounded-xl" />
    </div>
  );
}
