// Demo session: there is no server to hold cookies, so the signed-in user, the active workspace and
// the session id (a row in `sessions`, listed under "Sessões ativas") live in localStorage.

const KEY = 'effinance-demo-session';

export interface DemoSession {
  userId: string;
  workspaceId: string;
  sessionId: string;
}

let memory: DemoSession | null = null;

function parse(raw: string | null): DemoSession | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<DemoSession>;
    // Sessions saved before workspaces existed (a bare user id) are dropped: sign in again.
    return value && value.userId && value.workspaceId && value.sessionId ? (value as DemoSession) : null;
  } catch {
    return null;
  }
}

export function getSession(): DemoSession | null {
  try {
    return parse(localStorage.getItem(KEY));
  } catch {
    return memory;
  }
}

export function setSession(session: DemoSession | null): void {
  memory = session;
  try {
    if (session) localStorage.setItem(KEY, JSON.stringify(session));
    else localStorage.removeItem(KEY);
  } catch {
    // storage blocked (private mode / sandbox) — the in-memory value still works for this tab
  }
}
