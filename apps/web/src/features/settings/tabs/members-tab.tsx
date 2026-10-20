import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Check, Copy, DoorOpen, Link2, MailPlus, Trash2, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import type { z } from 'zod';
import {
  inviteInputSchema,
  MEMBER_ROLE_HINTS,
  MEMBER_ROLE_LABELS,
  PLANS,
  WORKSPACE_KIND_LABELS,
  type Invite,
  type Member,
} from '@effinance/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, Input } from '@/components/ui/input';
import { ErrorState } from '@/components/ui/misc';
import { Select } from '@/components/ui/select';
import { SkeletonRows } from '@/components/ui/skeleton';
import { copyText } from '@/lib/clipboard';
import { formatDateTime } from '@/lib/datetime';
import { toastError } from '@/lib/notify';
import { cn, initials } from '@/lib/utils';
import { useAuth } from '@/features/auth/auth-context';
import { usePermissions } from '@/features/auth/permissions';
import { useSubscription } from '@/features/billing/api';
import { useSwitchWorkspace } from '@/features/workspaces/workspace-switcher';
import {
  useCreateInvite,
  useInvites,
  useMembers,
  useRemoveMember,
  useRenameWorkspace,
  useRevokeInvite,
  useUpdateMemberRole,
} from '@/features/workspaces/api';
import { WORKSPACE_KIND_ICONS } from '@/features/workspaces/kind-icon';

export function MembersTab() {
  const { isOwner } = usePermissions();
  return (
    <>
      <WorkspaceCard />
      <MembersCard />
      {isOwner ? <InvitesCard /> : null}
    </>
  );
}

function WorkspaceCard() {
  const { workspace } = useAuth();
  const { isOwner } = usePermissions();
  const rename = useRenameWorkspace();
  const [name, setName] = useState(workspace?.name ?? '');
  useEffect(() => setName(workspace?.name ?? ''), [workspace?.name]);
  if (!workspace) return null;
  const Icon = WORKSPACE_KIND_ICONS[workspace.kind];
  const trimmed = name.trim();

  return (
    <Card className="p-6">
      <CardHeader title="Espaço" subtitle="Cada espaço tem dados, membros e assinatura próprios." />
      <div className="mt-5 flex items-start gap-4">
        <span className={cn('flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-primary-soft text-primary-soft-fg', isOwner && 'sm:mt-[26px]')}>
          <Icon className="size-5" />
        </span>
        {isOwner ? (
          <form
            className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-end"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!trimmed || trimmed === workspace.name) return;
              try {
                await rename.mutateAsync(trimmed);
                toast.success('Nome do espaço atualizado');
              } catch (error) {
                toastError(error);
              }
            }}
          >
            <Field label={`Nome do espaço (${WORKSPACE_KIND_LABELS[workspace.kind]})`} className="min-w-0 flex-1">
              <Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Button type="submit" variant="outline" className="self-start sm:self-auto" loading={rename.isPending} disabled={!trimmed || trimmed === workspace.name}>
              Salvar
            </Button>
          </form>
        ) : (
          <div className="min-w-0">
            <p className="truncate font-semibold">{workspace.name}</p>
            <p className="text-xs text-muted">
              {WORKSPACE_KIND_LABELS[workspace.kind]} · você é {MEMBER_ROLE_LABELS[workspace.role].toLowerCase()}
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}

function MembersCard() {
  const { user, workspace, workspaces } = useAuth();
  const { isOwner } = usePermissions();
  const members = useMembers();
  const subscription = useSubscription();
  const updateRole = useUpdateMemberRole();
  const remove = useRemoveMember();
  const { switchTo } = useSwitchWorkspace();
  const navigate = useNavigate();
  const [toRemove, setToRemove] = useState<Member | null>(null);
  const [leaving, setLeaving] = useState(false);
  const max = subscription.data?.maxMembers;
  const count = subscription.data?.memberCount ?? members.data?.length;

  async function changeRole(m: Member, role: 'editor' | 'viewer') {
    try {
      await updateRole.mutateAsync({ userId: m.userId, role });
      toast.success(`${m.name} agora é ${MEMBER_ROLE_LABELS[role].toLowerCase()}`);
    } catch (error) {
      toastError(error);
    }
  }

  async function confirmRemove() {
    if (!toRemove) return;
    try {
      await remove.mutateAsync(toRemove.userId);
      toast.success(`${toRemove.name} foi removido do espaço`);
      setToRemove(null);
    } catch (error) {
      toastError(error);
    }
  }

  async function leave() {
    if (!user) return;
    try {
      await remove.mutateAsync(user.id);
      setLeaving(false);
      // The session still points at the workspace just left: move to another one.
      const next = workspaces.find((w) => w.id !== workspace?.id && w.kind === 'personal') ?? workspaces.find((w) => w.id !== workspace?.id);
      toast.success(`Você saiu de ${workspace?.name}`);
      if (next) await switchTo(next, { silent: true });
      else navigate('/', { replace: true });
    } catch (error) {
      toastError(error);
    }
  }

  return (
    <Card className="p-6">
      <CardHeader
        title="Membros"
        subtitle={
          max ? `${count ?? '–'} de ${max} ${max === 1 ? 'membro' : 'membros'} no plano atual` : 'Pessoas com acesso a este espaço'
        }
        icon={<Users />}
      />
      <div className="mt-4">
        {members.isPending ? (
          <SkeletonRows rows={2} />
        ) : members.isError ? (
          <ErrorState error={members.error} onRetry={() => members.refetch()} />
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {members.data.map((m) => (
              <li key={m.userId} className="flex flex-wrap items-center gap-3 py-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-[13px] font-bold text-primary-soft-fg">
                  {initials(m.name)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    <span className="truncate">{m.name}</span>
                    {m.isYou ? <Badge tone="brand">Você</Badge> : null}
                  </p>
                  <p className="truncate text-xs text-muted">{m.email}</p>
                </div>
                {isOwner && m.role !== 'owner' ? (
                  <div className="flex items-center gap-1.5">
                    <Select
                      size_="sm"
                      wrapperClassName="w-32"
                      aria-label={`Permissão de ${m.name}`}
                      value={m.role}
                      disabled={updateRole.isPending}
                      onChange={(e) => void changeRole(m, e.target.value as 'editor' | 'viewer')}
                    >
                      <option value="editor">{MEMBER_ROLE_LABELS.editor}</option>
                      <option value="viewer">{MEMBER_ROLE_LABELS.viewer}</option>
                    </Select>
                    <Button variant="ghost" size="icon-sm" aria-label={`Remover ${m.name}`} title="Remover do espaço" onClick={() => setToRemove(m)}>
                      <Trash2 />
                    </Button>
                  </div>
                ) : (
                  <Badge tone={m.role === 'owner' ? 'solid' : 'neutral'} size="md" title={MEMBER_ROLE_HINTS[m.role]}>
                    {MEMBER_ROLE_LABELS[m.role]}
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="mt-4 grid gap-2 rounded-lg bg-surface-muted px-4 py-3 text-xs text-muted sm:grid-cols-3">
        {(['owner', 'editor', 'viewer'] as const).map((r) => (
          <p key={r}>
            <span className="font-semibold text-fg">{MEMBER_ROLE_LABELS[r]}:</span> {MEMBER_ROLE_HINTS[r]}
          </p>
        ))}
      </div>
      {!isOwner && workspace?.kind !== 'personal' ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <p className="text-[13px] text-muted">Você perderá o acesso aos dados deste espaço.</p>
          <Button variant="danger-soft" onClick={() => setLeaving(true)}>
            <DoorOpen /> Sair do espaço
          </Button>
        </div>
      ) : null}
      <ConfirmDialog
        open={toRemove !== null}
        onOpenChange={(o) => !o && setToRemove(null)}
        title={`Remover ${toRemove?.name ?? ''}?`}
        description="A pessoa perde o acesso imediatamente. Os lançamentos que ela criou continuam no espaço."
        confirmLabel="Remover"
        loading={remove.isPending}
        onConfirm={() => void confirmRemove()}
      />
      <ConfirmDialog
        open={leaving}
        onOpenChange={setLeaving}
        title={`Sair de ${workspace?.name ?? 'este espaço'}?`}
        description="Para voltar, será preciso um novo convite do proprietário."
        confirmLabel="Sair do espaço"
        loading={remove.isPending}
        onConfirm={() => void leave()}
      />
    </Card>
  );
}

type InviteForm = z.input<typeof inviteInputSchema>;

function InvitesCard() {
  const { workspace } = useAuth();
  const invites = useInvites(true);
  const members = useMembers();
  const subscription = useSubscription();
  const create = useCreateInvite();
  const revoke = useRevokeInvite();
  const [lastUrl, setLastUrl] = useState<string | null>(null);
  const form = useForm<InviteForm, unknown, z.output<typeof inviteInputSchema>>({
    resolver: zodResolver(inviteInputSchema),
    defaultValues: { email: '', role: 'editor' },
  });

  const max = subscription.data?.maxMembers ?? null;
  const used = (subscription.data?.memberCount ?? members.data?.length ?? 0) + (invites.data?.length ?? 0);
  const full = max !== null && used >= max;
  const upgrade = workspace ? PLANS.find((p) => p.workspaceKinds.includes(workspace.kind) && p.maxMembers > (max ?? 0)) : undefined;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const invite = await create.mutateAsync(values);
      form.reset({ email: '', role: values.role });
      setLastUrl(invite.inviteUrl ?? null);
      toast.success(invite.inviteUrl ? 'Convite criado. Copie o link e envie para a pessoa.' : `Convite enviado para ${invite.email}`);
    } catch (error) {
      toastError(error);
    }
  });

  return (
    <Card className="p-6">
      <CardHeader title="Convidar pessoas" subtitle="O convite vale por 7 dias e precisa ser aceito com o mesmo e-mail." icon={<MailPlus />} />
      {full ? (
        <div className="mt-4 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-[13px]">
          <p className="font-semibold text-fg">Limite de membros do plano atingido ({max})</p>
          <p className="mt-0.5 text-muted">
            {workspace?.kind === 'personal'
              ? 'O espaço pessoal é individual. Crie um espaço Família ou Empresa para compartilhar.'
              : upgrade
                ? `Mude para o plano ${upgrade.name} para convidar até ${upgrade.maxMembers} membros.`
                : 'Remova um membro ou um convite pendente para convidar outra pessoa.'}
          </p>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px_auto] sm:items-start" noValidate>
          <Field label="E-mail" error={form.formState.errors.email?.message}>
            <Input type="email" autoComplete="off" placeholder="pessoa@email.com" {...form.register('email')} />
          </Field>
          <Field label="Permissão">
            <Select {...form.register('role')}>
              <option value="editor">{MEMBER_ROLE_LABELS.editor}</option>
              <option value="viewer">{MEMBER_ROLE_LABELS.viewer}</option>
            </Select>
          </Field>
          <Button type="submit" className="sm:mt-[26px]" loading={form.formState.isSubmitting}>
            Convidar
          </Button>
        </form>
      )}
      {lastUrl ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-brand-500/25 bg-primary-soft/50 px-3 py-2.5">
          <Link2 className="size-4 shrink-0 text-brand-text" aria-hidden />
          <code className="min-w-0 flex-1 truncate text-xs text-fg">{lastUrl}</code>
          <CopyLinkButton url={lastUrl} />
          <Button variant="ghost" size="icon-sm" aria-label="Fechar" onClick={() => setLastUrl(null)}>
            <X />
          </Button>
        </div>
      ) : null}

      <h3 className="mt-6 text-sm font-semibold">Convites pendentes</h3>
      <div className="mt-2">
        {invites.isPending ? (
          <SkeletonRows rows={1} />
        ) : invites.isError ? (
          <ErrorState error={invites.error} onRetry={() => invites.refetch()} />
        ) : invites.data.length === 0 ? (
          <EmptyState compact title="Nenhum convite pendente" description="Os convites enviados aparecem aqui até serem aceitos." />
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {invites.data.map((inv) => (
              <InviteRow key={inv.id} invite={inv} revoking={revoke.isPending} onRevoke={async () => {
                try {
                  await revoke.mutateAsync(inv.id);
                  toast.success('Convite revogado');
                } catch (error) {
                  toastError(error);
                }
              }} />
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function InviteRow({ invite, onRevoke, revoking }: { invite: Invite; onRevoke: () => void; revoking: boolean }) {
  const expired = new Date(invite.expiresAt).getTime() < Date.now();
  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{invite.email}</p>
        <p className="text-xs text-muted">
          {MEMBER_ROLE_LABELS[invite.role]} · {expired ? 'expirou em' : 'expira em'} {formatDateTime(invite.expiresAt)}
        </p>
      </div>
      {expired ? <Badge tone="warning">Expirado</Badge> : null}
      {invite.inviteUrl ? <CopyLinkButton url={invite.inviteUrl} /> : null}
      <Button variant="ghost" size="sm" disabled={revoking} onClick={onRevoke}>
        Revogar
      </Button>
    </li>
  );
}

function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={async () => {
        if (await copyText(url)) {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } else toast.error('Não foi possível copiar o link.');
      }}
    >
      {copied ? <Check /> : <Copy />} {copied ? 'Copiado' : 'Copiar link'}
    </Button>
  );
}
