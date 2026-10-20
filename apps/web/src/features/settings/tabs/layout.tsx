import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Settings tabs fill the content area: two columns on wide screens, one on smaller ones.
 * Each card sits in a `Cell` so cards on the same row share the same height.
 */
export function TabGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-5 xl:grid-cols-2">{children}</div>;
}

export function Cell({ wide, children }: { wide?: boolean; children: ReactNode }) {
  return <div className={cn('grid min-w-0', wide && 'xl:col-span-2')}>{children}</div>;
}
