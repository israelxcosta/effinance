import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { safeColor } from './utils';

export type ThemePreference = 'light' | 'dark' | 'system';
type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'effinance.theme';

interface ThemeContextValue {
  theme: ThemePreference;
  resolved: ResolvedTheme;
  setTheme: (theme: ThemePreference) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
  } catch {
    return 'system';
  }
}

function systemTheme(): ResolvedTheme {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>(readPreference);
  const [system, setSystem] = useState<ResolvedTheme>(systemTheme);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSystem(mq.matches ? 'dark' : 'light');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const resolved: ResolvedTheme = theme === 'system' ? system : theme;

  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#0B0B0B' : '#F6F6F4');
  }, [resolved]);

  const setTheme = useCallback((next: ThemePreference) => {
    setThemeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage unavailable */
    }
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, resolved, setTheme, toggle: () => setTheme(resolved === 'dark' ? 'light' : 'dark') }),
    [theme, resolved, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}

/**
 * Very dark user colors (like the navy default for categories and goals) vanish on the neutral dark
 * surfaces; mix them toward off-white so icons, bars and chart slices stay readable.
 */
export function liftForDark(color: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return color;
  const n = parseInt(m[1]!, 16);
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  if (0.2126 * r + 0.7152 * g + 0.0722 * b >= 0.12) return color;
  const offWhite = [0xf2, 0xf1, 0xee];
  const mixed = rgb.map((v, i) => Math.round(v * 0.45 + offWhite[i]! * 0.55));
  return `#${mixed.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Theme-aware version of a user-chosen color (see liftForDark). */
export function useTone(): (color: string) => string {
  const { resolved } = useTheme();
  return useCallback(
    (color: string) => {
      // Only `#rrggbb` reaches inline styles (see safeColor); anything else becomes the neutral tone.
      const safe = safeColor(color, '#6B6F76');
      return resolved === 'dark' ? liftForDark(safe) : safe;
    },
    [resolved],
  );
}
