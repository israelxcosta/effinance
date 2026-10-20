import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AuthResponse,
  LoginInput,
  MeResponse,
  MeUser,
  MfaChallengeResponse,
  MfaVerifyInput,
  RegisterInput,
  UpdateProfileInput,
  WorkspaceSummary,
} from '@effinance/shared';
import { api, ApiRequestError, onUnauthorized, setBearerToken } from '@/lib/api';
import { qk } from '@/lib/query-keys';

export type LoginResult =
  { mfaRequired: true; mfaToken: string } | { mfaRequired: false; me: MeResponse };

interface AuthContextValue {
  user: MeUser | null;
  /** Active workspace (tenant) — every financial request is scoped to it by the API. */
  workspace: WorkspaceSummary | null;
  workspaces: WorkspaceSummary[];
  loading: boolean;
  /** Resolves with an MFA challenge when the account has two-factor authentication enabled. */
  login: (input: LoginInput) => Promise<LoginResult>;
  verifyMfa: (input: MfaVerifyInput) => Promise<MeResponse>;
  register: (input: RegisterInput) => Promise<MeResponse>;
  logout: () => Promise<void>;
  updateProfile: (input: UpdateProfileInput) => Promise<MeUser>;
  switchWorkspace: (workspaceId: string) => Promise<MeResponse>;
  /** Adopts a session the server just changed (invite accepted, workspace created or deleted). */
  applySession: (me: MeResponse) => void;
  refreshMe: () => Promise<unknown>;
  /** Forgets the session locally (the server already ended it, e.g. account deleted). */
  clearSession: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchMe(): Promise<MeResponse | null> {
  try {
    return await api<MeResponse>('/auth/me');
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401) return null;
    throw error;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: qk.me, queryFn: fetchMe, staleTime: 5 * 60_000, retry: false });

  useEffect(() => {
    onUnauthorized(() => {
      setBearerToken(null);
      qc.setQueryData(qk.me, null);
    });
    return () => onUnauthorized(null);
  }, [qc]);

  /** Drops cached data from a previous session/workspace but keeps the observed `me` query alive. */
  const applySession = useCallback(
    (session: MeResponse | null) => {
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== qk.me[0] });
      qc.setQueryData(qk.me, session);
    },
    [qc],
  );

  const startSession = useCallback(
    async (res: AuthResponse) => {
      setBearerToken(res.token);
      const session = await fetchMe();
      if (!session) throw new ApiRequestError(401, null);
      applySession(session);
      return session;
    },
    [applySession],
  );

  const login = useCallback(
    async (input: LoginInput): Promise<LoginResult> => {
      const res = await api<AuthResponse | MfaChallengeResponse>('/auth/login', {
        method: 'POST',
        body: input,
      });
      if ('mfaRequired' in res && res.mfaRequired)
        return { mfaRequired: true, mfaToken: res.mfaToken };
      return { mfaRequired: false, me: await startSession(res as AuthResponse) };
    },
    [startSession],
  );

  const verifyMfa = useCallback(
    async (input: MfaVerifyInput) =>
      startSession(await api<AuthResponse>('/auth/mfa/verify', { method: 'POST', body: input })),
    [startSession],
  );

  const register = useCallback(
    async (input: RegisterInput) =>
      startSession(await api<AuthResponse>('/auth/register', { method: 'POST', body: input })),
    [startSession],
  );

  const clearSession = useCallback(() => {
    setBearerToken(null);
    applySession(null);
  }, [applySession]);

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      clearSession();
    }
  }, [clearSession]);

  const updateProfile = useCallback(
    async (input: UpdateProfileInput) => {
      const user = await api<MeUser>('/auth/me', { method: 'PUT', body: input });
      qc.setQueryData<MeResponse | null>(qk.me, (prev) =>
        prev ? { ...prev, user: { ...prev.user, ...user } } : prev,
      );
      return user;
    },
    [qc],
  );

  const switchWorkspace = useCallback(
    async (workspaceId: string) => {
      const session = await api<MeResponse>('/auth/switch-workspace', {
        method: 'POST',
        body: { workspaceId },
      });
      // The new access cookie carries the workspace claim; an older bearer token would not.
      setBearerToken(null);
      applySession(session);
      return session;
    },
    [applySession],
  );

  const adopt = useCallback(
    (session: MeResponse) => {
      setBearerToken(null);
      applySession(session);
    },
    [applySession],
  );

  const refreshMe = useCallback(() => qc.invalidateQueries({ queryKey: qk.me }), [qc]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: me.data?.user ?? null,
      workspace: me.data?.workspace ?? null,
      workspaces: me.data?.workspaces ?? [],
      loading: me.isPending,
      login,
      verifyMfa,
      register,
      logout,
      updateProfile,
      switchWorkspace,
      applySession: adopt,
      refreshMe,
      clearSession,
    }),
    [
      me.data,
      me.isPending,
      login,
      verifyMfa,
      register,
      logout,
      updateProfile,
      switchWorkspace,
      adopt,
      refreshMe,
      clearSession,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
