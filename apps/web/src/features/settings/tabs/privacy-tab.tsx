import { useState } from 'react';
import { useNavigate } from 'react-router';
import { ChevronLeft, ChevronRight, Download, History, Trash2, UserX } from 'lucide-react';
import { toast } from 'sonner';
import { todayISO, type AuditLogEntry } from '@effinance/shared';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Modal } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, Input } from '@/components/ui/input';
import { ErrorState } from '@/components/ui/misc';
import { SkeletonRows } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/datetime';
import { toastError } from '@/lib/notify';
import { useAuth } from '@/features/auth/auth-context';
import { useDeleteAccount } from '@/features/auth/api';
import { usePermissions } from '@/features/auth/permissions';
import { PasswordInput } from '@/features/auth/pages/login';
import { useSwitchWorkspace } from '@/features/workspaces/workspace-switcher';
import { exportWorkspaceData, useAuditLog, useDeleteWorkspace } from '@/features/workspaces/api';

export function PrivacyTab() {
  const { isOwner } = usePermissions();
  const { workspace } = useAuth();
  return (
    <>
      <ExportCard />
      {isOwner ? <AuditCard /> : null}
      {isOwner && workspace?.kind !== 'personal' ? <DeleteWorkspaceCard /> : null}
      <DeleteAccountCard />
    </>
  );
}

function slug(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Saves a JSON file through a temporary object URL. */
function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ExportCard() {
  const { workspace } = useAuth();
  const { isOwner } = usePermissions();
  const [exporting, setExporting] = useState(false);

  async function run() {
    setExporting(true);
    try {
      const data = await exportWorkspaceData();
      downloadJson(data, `effinance-${slug(workspace?.name ?? 'dados')}-${todayISO()}.json`);
      toast.success('Exportação concluída');
    } catch (error) {
      toastError(error);
    } finally {
      setExporting(false);
    }
  }

  return (
    <Card className="p-6">
      <CardHeader
        title="Exportar dados"
        subtitle="Baixe uma cópia completa dos dados deste espaço em JSON (portabilidade, LGPD art. 18)."
        icon={<Download />}
      />
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-muted px-4 py-3">
        <p className="max-w-lg text-[13px] text-muted">
          {isOwner
            ? 'Inclui contas, cartões, lançamentos, categorias, metas e contatos, com os campos protegidos já decifrados. Guarde o arquivo com cuidado.'
            : 'Somente o proprietário pode exportar os dados deste espaço.'}
        </p>
        <Button variant="outline" onClick={() => void run()} loading={exporting} disabled={!isOwner}>
          <Download /> Exportar JSON
        </Button>
      </div>
    </Card>
  );
}

const AUDIT_LABELS: Record<string, string> = {
  'auth.register': 'Conta criada',
  'auth.login': 'Login',
  'auth.login_failed': 'Tentativa de login falhou',
  'auth.logout': 'Logout',
  'auth.mfa_enabled': '2FA ativada',
  'auth.mfa_disabled': '2FA desativada',
  'auth.mfa_failed': 'Código 2FA inválido',
  'auth.password_changed': 'Senha alterada',
  'auth.password_reset_requested': 'Recuperação de senha solicitada',
  'auth.password_reset': 'Senha redefinida',
  'auth.session_revoked': 'Sessão encerrada',
  'auth.refresh_token_reuse': 'Reuso de sessão bloqueado',
  'workspace.created': 'Espaço criado',
  'workspace.renamed': 'Espaço renomeado',
  'workspace.deleted': 'Espaço excluído',
  'data.exported': 'Dados exportados',
  'member.invited': 'Convite enviado',
  'member.joined': 'Membro entrou',
  'member.role_changed': 'Permissão alterada',
  'member.removed': 'Membro removido',
  'member.left': 'Membro saiu',
  'invite.revoked': 'Convite revogado',
  'billing.checkout_started': 'Checkout iniciado',
  'billing.activated': 'Assinatura ativada',
  'billing.canceled': 'Assinatura cancelada',
  'billing.webhook': 'Atualização do Mercado Pago',
  'account.deleted': 'Conta excluída',
};

function auditLabel(entry: AuditLogEntry): string {
  return AUDIT_LABELS[entry.action] ?? entry.action.replace(/[._]/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

function AuditCard() {
  const [page, setPage] = useState(1);
  const audit = useAuditLog(page, true);
  const totalPages = audit.data ? Math.max(1, Math.ceil(audit.data.total / audit.data.pageSize)) : 1;

  return (
    <Card className="p-6">
      <CardHeader title="Registro de auditoria" subtitle="Ações sensíveis neste espaço: acessos, membros, assinatura e exportações." icon={<History />} />
      <div className="mt-4">
        {audit.isPending ? (
          <SkeletonRows rows={3} />
        ) : audit.isError ? (
          <ErrorState error={audit.error} onRetry={() => audit.refetch()} />
        ) : audit.data.items.length === 0 ? (
          <EmptyState compact title="Nenhum registro ainda" description="As ações sensíveis aparecerão aqui." />
        ) : (
          <div className="-mx-2 overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-[13px]">
              <thead>
                <tr className="text-xs text-muted">
                  <th className="px-2 py-2 font-medium">Quando</th>
                  <th className="px-2 py-2 font-medium">Ação</th>
                  <th className="px-2 py-2 font-medium">Quem</th>
                  <th className="px-2 py-2 font-medium">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {audit.data.items.map((e) => (
                  <tr key={e.id} className={audit.isPlaceholderData ? 'opacity-60' : undefined}>
                    <td className="tabular px-2 py-2.5 whitespace-nowrap text-muted">{formatDateTime(e.createdAt)}</td>
                    <td className="px-2 py-2.5 font-medium">{auditLabel(e)}</td>
                    <td className="px-2 py-2.5">{e.userName ?? '—'}</td>
                    <td className="tabular px-2 py-2.5 text-muted">{e.ip ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {totalPages > 1 ? (
        <div className="mt-3 flex items-center justify-end gap-2 text-xs text-muted">
          <span className="tabular">
            Página {page} de {totalPages}
          </span>
          <Button variant="outline" size="icon-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Página anterior">
            <ChevronLeft />
          </Button>
          <Button variant="outline" size="icon-sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} aria-label="Próxima página">
            <ChevronRight />
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

function DeleteWorkspaceCard() {
  const { workspace, workspaces } = useAuth();
  const remove = useDeleteWorkspace();
  const { switchTo } = useSwitchWorkspace();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  if (!workspace) return null;
  const matches = typed.trim() === workspace.name;

  async function confirm() {
    if (!workspace || !matches) return;
    try {
      await remove.mutateAsync(typed.trim());
      setOpen(false);
      toast.success(`${workspace.name} foi excluído`);
      const next = workspaces.find((w) => w.id !== workspace.id && w.kind === 'personal') ?? workspaces.find((w) => w.id !== workspace.id);
      if (next) await switchTo(next, { silent: true });
    } catch (error) {
      toastError(error);
    }
  }

  return (
    <Card className="border-danger/30 p-6">
      <CardHeader title="Excluir este espaço" subtitle="Apaga todos os dados, cancela a assinatura e destrói a chave de criptografia. Não pode ser desfeito." icon={<Trash2 />} />
      <div className="mt-5">
        <Button variant="danger-soft" onClick={() => setOpen(true)}>
          <Trash2 /> Excluir {workspace.name}
        </Button>
      </div>
      <Modal
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (o) setTyped('');
        }}
        title={`Excluir ${workspace.name}?`}
        description="Todos os membros perdem o acesso e os dados são apagados definitivamente. Exporte antes, se precisar."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button variant="danger" disabled={!matches} loading={remove.isPending} onClick={() => void confirm()}>
              Excluir definitivamente
            </Button>
          </>
        }
      >
        <Field label={<>Digite <strong className="font-semibold">{workspace.name}</strong> para confirmar</>}>
          <Input autoFocus autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
        </Field>
      </Modal>
    </Card>
  );
}

function DeleteAccountCard() {
  const { clearSession } = useAuth();
  const remove = useDeleteAccount();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (!password) {
      setError('Informe sua senha');
      return;
    }
    try {
      await remove.mutateAsync({ password });
      setOpen(false);
      clearSession();
      navigate('/login', { replace: true });
      toast.success('Sua conta foi excluída. Sentiremos sua falta.');
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <Card className="border-danger/30 p-6">
      <CardHeader
        title="Excluir minha conta"
        subtitle="Remove sua conta, seu espaço pessoal e os espaços em que você é o único proprietário. Nos demais, você deixa de ser membro."
        icon={<UserX />}
      />
      <div className="mt-5">
        <Button variant="danger-soft" onClick={() => setOpen(true)}>
          <UserX /> Excluir conta
        </Button>
      </div>
      <Modal
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (o) {
            setPassword('');
            setError(null);
          }
        }}
        title="Excluir sua conta?"
        description="Esta ação é definitiva: os dados e as chaves de criptografia são destruídos e não podem ser recuperados."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => void confirm()}>
              Excluir minha conta
            </Button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void confirm();
          }}
          noValidate
        >
          <Field label="Confirme com sua senha" error={error ?? undefined}>
            <PasswordInput show={show} onToggle={() => setShow((s) => !s)} autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
        </form>
      </Modal>
    </Card>
  );
}
