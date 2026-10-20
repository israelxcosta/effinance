import { Suspense, useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { useAuth } from '@/features/auth/auth-context';
import { VIEWER_REASON } from '@/features/auth/permissions';
import { SubscriptionBanner } from '@/features/billing/subscription-banner';
import { onAccessError } from '@/lib/api';
import { TransactionActionsProvider } from '@/features/transactions/transaction-actions';
import { Skeleton } from '@/components/ui/skeleton';
import { Sidebar } from './sidebar';
import { QuickBar } from './quick-bar';
import { MobileNav } from './mobile-nav';
import { CommandPalette } from './command-palette';
import { IS_DEMO } from '@/lib/demo';
import { DemoBanner } from './demo-banner';

export function AppShell() {
  const { user, workspace, loading, refreshMe } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const role = workspace?.role;

  // 402/403 from any request: explain once (deduplicated toast) and refresh the session state,
  // since the subscription or the member's role may have changed since it was loaded.
  useEffect(() => {
    onAccessError((kind, error) => {
      void refreshMe();
      if (kind === 'subscription_required') {
        toast.error('Assinatura necessária', {
          id: 'subscription-required',
          description: 'O espaço está em modo somente leitura. Assine um plano para voltar a criar e editar.',
          action: role === 'owner' ? { label: 'Assinar', onClick: () => navigate('/configuracoes?aba=assinatura') } : undefined,
        });
      } else {
        toast.error(role === 'viewer' ? VIEWER_REASON : error.message, { id: 'forbidden' });
      }
    });
    return () => onAccessError(null);
  }, [navigate, refreshMe, role]);

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
            <SubscriptionBanner key={workspace?.id} />
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
