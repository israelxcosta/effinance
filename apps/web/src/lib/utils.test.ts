import { describe, expect, it } from 'vitest';
import { cn } from './utils';

describe('cn', () => {
  it('treats the custom type scale as font sizes, not colors', () => {
    // A size token next to a color must keep both (amounts are `text-danger text-title`).
    expect(cn('text-danger', 'text-title')).toBe('text-danger text-title');
    expect(cn('text-display', 'text-fg')).toBe('text-display text-fg');
    expect(cn('text-success', 'text-2xs', 'text-label', 'text-heading')).toBe('text-success text-heading');
  });

  it('lets a later size override an earlier one', () => {
    expect(cn('text-sm', 'text-label')).toBe('text-label');
    expect(cn('text-label', 'text-xs')).toBe('text-xs');
  });
});
