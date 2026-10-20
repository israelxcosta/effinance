import { lazy } from 'react';
import { createBrowserRouter, createHashRouter, Link } from 'react-router';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { IS_DEMO } from '@/lib/demo';

const LoginPage = lazy(() => import('@/features/auth/pages/login'));
const RegisterPage = lazy(() => import('@/features/auth/pages/register'));
const DashboardPage = lazy(() => import('@/features/dashboard/pages/dashboard'));
const StatementPage = lazy(() => import('@/features/statement/pages/statement'));
const PayablesPage = lazy(() => import('@/features/transactions/pages/payables'));
const ReceivablesPage = lazy(() => import('@/features/transactions/pages/receivables'));
const TransfersPage = lazy(() => import('@/features/transfers/pages/transfers'));
const AccountsPage = lazy(() => import('@/features/accounts/pages/accounts'));
const CardsPage = lazy(() => import('@/features/cards/pages/cards'));
const CardDetailPage = lazy(() => import('@/features/cards/pages/card-detail'));
const CategoriesPage = lazy(() => import('@/features/categories/pages/categories'));
const GoalsPage = lazy(() => import('@/features/goals/pages/goals'));
const ContactsPage = lazy(() => import('@/features/contacts/pages/contacts'));
const ReportsPage = lazy(() => import('@/features/reports/pages/reports'));
const SettingsPage = lazy(() => import('@/features/settings/pages/settings'));

function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
      <p className="eyebrow text-brand-text">Erro 404</p>
      <h1 className="text-2xl font-semibold tracking-tight">Página não encontrada</h1>
      <p className="text-sm text-muted">O endereço acessado não existe ou foi movido.</p>
      <Button asChild className="mt-2">
        <Link to="/">Voltar ao início</Link>
      </Button>
    </div>
  );
}

// The demo build is served from a single static page, so it routes on the URL hash.
export const router = (IS_DEMO ? createHashRouter : createBrowserRouter)([
  { path: '/login', element: <LoginPage /> },
  { path: '/cadastro', element: <RegisterPage /> },
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'extrato', element: <StatementPage /> },
      { path: 'contas-a-pagar', element: <PayablesPage /> },
      { path: 'contas-a-receber', element: <ReceivablesPage /> },
      { path: 'transferencias', element: <TransfersPage /> },
      { path: 'contas', element: <AccountsPage /> },
      { path: 'cartoes', element: <CardsPage /> },
      { path: 'cartoes/:id', element: <CardDetailPage /> },
      { path: 'categorias', element: <CategoriesPage /> },
      { path: 'metas', element: <GoalsPage /> },
      { path: 'contatos', element: <ContactsPage /> },
      { path: 'relatorios', element: <ReportsPage /> },
      { path: 'configuracoes', element: <SettingsPage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]);
