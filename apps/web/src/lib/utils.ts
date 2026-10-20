import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]![0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]![0] ?? '') : '';
  return (first + last).toUpperCase();
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/**
 * User colors come from the API and end up in `style` (some as part of a `background` shorthand,
 * where `url(...)` would fetch a third-party resource). Only `#rrggbb` is accepted.
 */
export function safeColor(value: string | null | undefined, fallback = '#152B61'): string {
  return value && HEX_COLOR.test(value) ? value : fallback;
}

/** Hex color with alpha (0..1) → rgba() string. */
export function alpha(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
