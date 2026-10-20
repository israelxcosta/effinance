import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AuthResponse, LoginInput, RegisterInput, UpdateProfileInput, User } from '@effinance/shared';
import { api, ApiRequestError, onUnauthorized, setBearerToken } from '@/lib/api';
import { qk } from '@/lib/query-keys';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (input: LoginInput) => Promise<User>;
  register: (input: RegisterInput) => Promise<User>;
  logout: () => Promise<void>;
  updateProfile: (input: UpdateProfileInput) => Promise<User>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchMe(): Promise<User | null> {
  try {
    return await api<User>('/auth/me');
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

  /** Drops cached data from a previous session but keeps the observed `me` query alive. */
  const resetCache = useCallback(
    (user: User | null) => {
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== qk.me[0] });
      qc.setQueryData(qk.me, user);
    },
    [qc],
  );

  const handleAuth = useCallback(
    (res: AuthResponse) => {
      setBearerToken(res.token);
      resetCache(res.user);
      return res.user;
    },
    [resetCache],
  );

  const login = useCallback(
    async (input: LoginInput) => handleAuth(await api<AuthResponse>('/auth/login', { method: 'POST', body: input })),
    [handleAuth],
  );

  const register = useCallback(
    async (input: RegisterInput) =>
      handleAuth(await api<AuthResponse>('/auth/register', { method: 'POST', body: input })),
    [handleAuth],
  );

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      setBearerToken(null);
      resetCache(null);
    }
  }, [resetCache]);

  const updateProfile = useCallback(
    async (input: UpdateProfileInput) => {
      const user = await api<User>('/auth/me', { method: 'PUT', body: input });
      qc.setQueryData(qk.me, user);
      return user;
    },
    [qc],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user: me.data ?? null,
      loading: me.isPending,
      login,
      register,
      logout,
      updateProfile,
    }),
    [me.data, me.isPending, login, register, logout, updateProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
