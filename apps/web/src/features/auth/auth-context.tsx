import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient, type Query } from '@tanstack/react-query';
import { toast } from 'sonner';
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
import { announceSessionChange, onSessionChange } from '@/lib/session-sync';

/** Everything cached except the observed `me` query. */
const notMe = { predicate: (q: Query) => q.queryKey[0] !== qk.me[0] };

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

  /**
   * Drops cached data from a previous session/workspace but keeps the observed `me` query alive.
   * In-flight requests are cancelled so a late response of the old tenant can't land in the cache,
   * and the mutation cache goes too (its variables hold passwords, MFA codes and recovery codes).
   */
  const applySession = useCallback(
    (session: MeResponse | null) => {
      void qc.cancelQueries(notMe);
      qc.removeQueries(notMe);
      qc.getMutationCache().clear();
      qc.setQueryData(qk.me, session);
    },
    [qc],
  );

  useEffect(() => {
    // The session ended (refresh refused): forget everything the previous user could see.
    onUnauthorized(() => {
      setBearerToken(null);
      applySession(null);
    });
    return () => onUnauthorized(null);
  }, [applySession]);

  // Another tab signed in/out or switched workspace: the shared cookies now point elsewhere, so
  // reload the session from the server instead of showing (and editing) stale tenant data.
  useEffect(
    () =>
      onSessionChange(() => {
        const previous = qc.getQueryData<MeResponse | null>(qk.me)?.workspace ?? null;
        setBearerToken(null);
        void fetchMe()
          .then((session) => {
            applySession(session);
            if (previous && session?.workspace && session.workspace.id !== previous.id) {
              toast.info(`Espaço alterado em outra aba. Agora você está em ${session.workspace.name}.`, { id: 'session-sync' });
            }
          })
          .catch(() => void qc.invalidateQueries({ queryKey: qk.me }));
      }),
    [applySession, qc],
  );

  const startSession = useCallback(
    async (res: AuthResponse) => {
      setBearerToken(res.token);
      const session = await fetchMe();
      if (!session) throw new ApiRequestError(401, null);
      applySession(session);
      announceSessionChange('login');
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
    announceSessionChange('logout');
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
      announceSessionChange('workspace');
      return session;
    },
    [applySession],
  );

  const adopt = useCallback(
    (session: MeResponse) => {
      setBearerToken(null);
      applySession(session);
      announceSessionChange('workspace');
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
