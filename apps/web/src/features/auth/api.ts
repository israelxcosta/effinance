import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ChangePasswordInput,
  DeleteAccountInput,
  ForgotPasswordInput,
  MfaCodeInput,
  MfaEnableResponse,
  MfaSetupResponse,
  ResetPasswordInput,
  SessionInfo,
} from '@effinance/shared';
import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';

// Account security: password, two-factor authentication and sessions.

export function useSessions() {
  return useQuery({ queryKey: qk.sessions, queryFn: () => api<SessionInfo[]>('/auth/sessions') });
}

export function useRevokeSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/auth/sessions/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.sessions }),
  });
}

export function useChangePassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ChangePasswordInput) => api<void>('/auth/password', { method: 'POST', body: input }),
    // The other sessions are revoked by the server.
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.sessions }),
  });
}

export function useMfaSetup() {
  return useMutation({ mutationFn: () => api<MfaSetupResponse>('/auth/mfa/setup', { method: 'POST' }) });
}

export function useMfaEnable() {
  return useMutation({
    mutationFn: (input: MfaCodeInput) => api<MfaEnableResponse>('/auth/mfa/enable', { method: 'POST', body: input }),
  });
}

export function useMfaDisable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: MfaCodeInput) => api<void>('/auth/mfa/disable', { method: 'POST', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.me }),
  });
}

export function forgotPassword(input: ForgotPasswordInput): Promise<void> {
  return api<void>('/auth/password/forgot', { method: 'POST', body: input });
}

export function resetPassword(input: ResetPasswordInput): Promise<void> {
  return api<void>('/auth/password/reset', { method: 'POST', body: input });
}

export function useDeleteAccount() {
  return useMutation({
    mutationFn: (input: DeleteAccountInput) => api<void>('/auth/me', { method: 'DELETE', body: input }),
  });
}
