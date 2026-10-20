import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { MailWarning } from 'lucide-react';
import { toast } from 'sonner';
import { MEMBER_ROLE_HINTS, MEMBER_ROLE_LABELS, WORKSPACE_KIND_LABELS } from '@effinance/shared';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiRequestError, errorMessage } from '@/lib/api';
import { useAuth } from '@/features/auth/auth-context';
import { AuthLayout } from '@/features/auth/pages/auth-layout';
import { acceptInvite, useInvitePreview } from '../api';
import { WORKSPACE_KIND_ICONS } from '../kind-icon';

/** `/convite/:token` — public preview; accepting requires being signed in with the invited e-mail. */
export default function InvitePage() {
  const { token = '' } = useParams();
  const { user, loading, applySession, logout } = useAuth();
  const navigate = useNavigate();
  const preview = useInvitePreview(token);
  const [accepting, setAccepting] = useState(false);
  const back = { from: `/convite/${token}` };

  const footer = (
    <Link to="/" className="font-semibold text-brand-text hover:underline">
      Ir para o Effinance
    </Link>
  );

  if (loading || preview.isPending) {
    return (
      <AuthLayout title="Convite" subtitle="Carregando o convite…" footer={footer}>
        <Skeleton className="h-36 rounded-xl" />
      </AuthLayout>
    );
  }

  if (preview.isError || !preview.data) {
    const notFound = preview.error instanceof ApiRequestError && preview.error.status === 404;
    return (
      <AuthLayout
        title={notFound ? 'Convite não encontrado' : 'Não foi possível abrir o convite'}
        subtitle={notFound ? 'O link pode ter sido revogado ou digitado incorretamente.' : errorMessage(preview.error)}
        footer={footer}
      >
        {notFound ? null : (
          <Button variant="outline" onClick={() => preview.refetch()}>
            Tentar novamente
          </Button>
        )}
      </AuthLayout>
    );
  }

  const invite = preview.data;
  const Icon = WORKSPACE_KIND_ICONS[invite.workspaceKind];
  const sameEmail = user?.email.toLowerCase() === invite.email.toLowerCase();

  async function accept() {
    setAccepting(true);
    try {
      const session = await acceptInvite(token);
      applySession(session);
      toast.success(`Você agora faz parte de ${invite.workspaceName}`);
      navigate('/', { replace: true });
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setAccepting(false);
    }
  }

  return (
    <AuthLayout
      title={invite.expired ? 'Convite expirado' : `Convite para ${invite.workspaceName}`}
      subtitle={
        invite.expired
          ? 'Este convite não é mais válido. Peça um novo a quem convidou você.'
          : `${invite.invitedBy} convidou você para participar deste espaço no Effinance.`
      }
      footer={footer}
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3.5 rounded-xl border border-border bg-surface p-4 shadow-xs">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-[12px] bg-primary-soft text-primary-soft-fg">
            <Icon className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="truncate font-semibold">{invite.workspaceName}</p>
            <p className="text-xs text-muted">
              {WORKSPACE_KIND_LABELS[invite.workspaceKind]} · como <strong className="font-semibold text-fg">{MEMBER_ROLE_LABELS[invite.role]}</strong>
            </p>
            <p className="mt-0.5 text-xs text-subtle">{MEMBER_ROLE_HINTS[invite.role]}</p>
          </div>
        </div>

        {invite.expired ? null : !user ? (
          <>
            <p className="text-sm text-muted">
              Entre ou crie uma conta com <strong className="font-semibold text-fg">{invite.email}</strong> para aceitar.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <Button size="lg" onClick={() => navigate('/login', { state: back })}>
                Entrar
              </Button>
              <Button size="lg" variant="outline" onClick={() => navigate('/cadastro', { state: { ...back, email: invite.email } })}>
                Criar conta
              </Button>
            </div>
          </>
        ) : sameEmail ? (
          <Button size="lg" className="w-full" loading={accepting} onClick={accept}>
            Aceitar convite
          </Button>
        ) : (
          <div className="flex flex-col gap-3 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3.5 text-sm">
            <p className="inline-flex items-center gap-2 font-semibold text-warning">
              <MailWarning className="size-4" /> Convite para outro e-mail
            </p>
            <p className="text-muted">
              O convite foi enviado para <strong className="font-semibold text-fg">{invite.email}</strong>, mas você está
              conectado como <strong className="font-semibold text-fg">{user.email}</strong>.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              onClick={async () => {
                await logout();
                navigate('/login', { state: back });
              }}
            >
              Sair e entrar com {invite.email}
            </Button>
          </div>
        )}
      </div>
    </AuthLayout>
  );
}
