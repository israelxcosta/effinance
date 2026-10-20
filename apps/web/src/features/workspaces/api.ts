import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AuditLogEntry,
  Invite,
  InviteInput,
  InvitePreview,
  MeResponse,
  Member,
  MemberRole,
  Paginated,
  WorkspaceInput,
  WorkspaceSummary,
} from '@effinance/shared';
import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';

// The active workspace (tenant): settings, members, invites and LGPD tools. Routes act on
// `/workspaces/current`, i.e. the workspace in the session's access token.

export function useCreateWorkspace() {
  return useMutation({
    mutationFn: (input: WorkspaceInput) => api<WorkspaceSummary>('/workspaces', { method: 'POST', body: input }),
  });
}

export function useRenameWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api<WorkspaceSummary>('/workspaces/current', { method: 'PUT', body: { name } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.me }),
  });
}

export function useDeleteWorkspace() {
  return useMutation({
    mutationFn: (confirmName: string) => api<void>('/workspaces/current', { method: 'DELETE', body: { confirmName } }),
  });
}

export function useMembers() {
  return useQuery({ queryKey: qk.members, queryFn: () => api<Member[]>('/workspaces/current/members') });
}

function useInvalidateMembers() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['workspace'] }),
      qc.invalidateQueries({ queryKey: qk.subscription }),
    ]);
}

export function useUpdateMemberRole() {
  const invalidate = useInvalidateMembers();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Exclude<MemberRole, 'owner'> }) =>
      api<Member>(`/workspaces/current/members/${userId}`, { method: 'PATCH', body: { role } }),
    onSuccess: invalidate,
  });
}

/** Owner removes a member, or a member leaves (their own userId). */
export function useRemoveMember() {
  const invalidate = useInvalidateMembers();
  return useMutation({
    mutationFn: (userId: string) => api<void>(`/workspaces/current/members/${userId}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}

export function useInvites(enabled: boolean) {
  return useQuery({ queryKey: qk.invites, queryFn: () => api<Invite[]>('/workspaces/current/invites'), enabled });
}

export function useCreateInvite() {
  const invalidate = useInvalidateMembers();
  return useMutation({
    mutationFn: (input: InviteInput) => api<Invite>('/workspaces/current/invites', { method: 'POST', body: input }),
    onSuccess: invalidate,
  });
}

export function useRevokeInvite() {
  const invalidate = useInvalidateMembers();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/workspaces/current/invites/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
}

export function useInvitePreview(token: string) {
  return useQuery({
    queryKey: qk.invitePreview(token),
    queryFn: () => api<InvitePreview>(`/invites/${encodeURIComponent(token)}`),
    enabled: Boolean(token),
  });
}

export function acceptInvite(token: string): Promise<MeResponse> {
  return api<MeResponse>(`/invites/${encodeURIComponent(token)}/accept`, { method: 'POST' });
}

export function exportWorkspaceData(): Promise<unknown> {
  return api<unknown>('/workspaces/current/export');
}

export function useAuditLog(page: number, enabled: boolean) {
  return useQuery({
    queryKey: qk.audit(page),
    queryFn: () => api<Paginated<AuditLogEntry>>('/workspaces/current/audit', { query: { page, pageSize: 20 } }),
    enabled,
    placeholderData: keepPreviousData,
  });
}
