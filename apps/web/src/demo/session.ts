// Demo "session": the signed-in user id lives in localStorage (there is no server to hold a cookie).

const KEY = 'effinance-demo-session';
let memory: string | null = null;

export function getSessionUserId(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return memory;
  }
}

export function setSessionUserId(userId: string | null): void {
  memory = userId;
  try {
    if (userId) localStorage.setItem(KEY, userId);
    else localStorage.removeItem(KEY);
  } catch {
    // storage blocked (private mode / sandbox) — the in-memory value still works for this tab
  }
}
