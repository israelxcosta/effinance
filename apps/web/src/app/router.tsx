import { lazy } from 'react';
import { createBrowserRouter, createHashRouter, isRouteErrorResponse, Link, useRouteError } from 'react-router';
import { AppShell } from '@/components/layout/app-shell';
import { Button } from '@/components/ui/button';
import { IS_DESKTOP, IS_LOCAL_API } from '@/lib/demo';

const LoginPage = lazy(() => import('@/features/auth/pages/login'));
const RegisterPage = lazy(() => import('@/features/auth/pages/register'));
const ForgotPasswordPage = lazy(() => import('@/features/auth/pages/forgot-password'));
const ResetPasswordPage = lazy(() => import('@/features/auth/pages/reset-password'));
const InvitePage = lazy(() => import('@/features/workspaces/pages/invite'));
const TermsPage = lazy(() => import('@/features/legal/pages/legal').then((m) => ({ default: m.TermsPage })));
const PrivacyPage = lazy(() => import('@/features/legal/pages/legal').then((m) => ({ default: m.PrivacyPage })));
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
const InvestmentsPage = lazy(() => import('@/features/investments/pages/investments'));
const ContactsPage = lazy(() => import('@/features/contacts/pages/contacts'));
const ReportsPage = lazy(() => import('@/features/reports/pages/reports'));
const SettingsPage = lazy(() => import('@/features/settings/pages/settings'));
// Inlined env check: only the desktop build carries the restore screen (and the database it needs).
const RestorePage = import.meta.env.VITE_DESKTOP === 'true' ? lazy(() => import('@/desktop/restore-page')) : () => null;

function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
      <p className="eyebrow text-brand-text">Erro 404</p>
      <h1 className="text-heading font-semibold tracking-tight">Página não encontrada</h1>
      <p className="text-sm text-muted">O endereço acessado não existe ou foi movido.</p>
      <Button asChild className="mt-2">
        <Link to="/">Voltar ao início</Link>
      </Button>
    </div>
  );
}

/**
 * Any error thrown while rendering a screen (a crafted link, a chunk missing after a deploy). It
 * replaces React Router's default page, which prints the message and the stack trace in English;
 * the details stay out of the screen.
 */
function RouteError() {
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  return (
    <div role="alert" className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 py-24 text-center">
      <p className="eyebrow text-brand-text">{notFound ? 'Erro 404' : 'Algo deu errado'}</p>
      <h1 className="text-heading font-semibold tracking-tight">
        {notFound ? 'Página não encontrada' : 'Não foi possível abrir esta tela'}
      </h1>
      <p className="max-w-md text-sm text-muted">
        {notFound
          ? 'O endereço acessado não existe ou foi movido.'
          : 'Recarregue a página. Se o problema continuar, volte ao início e tente de novo.'}
      </p>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        {notFound ? null : <Button onClick={() => window.location.reload()}>Recarregar</Button>}
        <Button asChild variant={notFound ? 'primary' : 'outline'}>
          <Link to="/" replace>
            Voltar ao início
          </Link>
        </Button>
      </div>
    </div>
  );
}

// The demo and desktop builds are served from a single static page, so they route on the URL hash.
export const router = (IS_LOCAL_API ? createHashRouter : createBrowserRouter)([
  {
    // Pathless root: only catches errors of every screen below.
    errorElement: <RouteError />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/cadastro', element: <RegisterPage /> },
      { path: '/esqueci-senha', element: <ForgotPasswordPage /> },
      { path: '/redefinir-senha', element: <ResetPasswordPage /> },
      { path: '/convite/:token', element: <InvitePage /> },
      // Same screen after the token leaves the address bar (it stays in the history state).
      { path: '/convite', element: <InvitePage /> },
      { path: '/termos', element: <TermsPage /> },
      { path: '/privacidade', element: <PrivacyPage /> },
      // Desktop app: restore a backup before any account exists on this computer.
      ...(IS_DESKTOP ? [{ path: '/restaurar', element: <RestorePage /> }] : []),
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
          { path: 'investimentos', element: <InvestmentsPage /> },
          { path: 'contatos', element: <ContactsPage /> },
          { path: 'relatorios', element: <ReportsPage /> },
          { path: 'configuracoes', element: <SettingsPage /> },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
]);
