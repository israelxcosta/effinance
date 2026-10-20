import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Popover } from 'radix-ui';
import { ChevronDown, Plus, Search } from 'lucide-react';
import type { Category, CategoryType, CategoryWithChildren } from '@effinance/shared';
import { cn } from '@/lib/utils';
import { inputClasses } from '@/components/ui/input';
import { CategoryIcon } from '@/components/ui/category-icon';
import { useCategories } from './api';
import { CategorySheet, type CategorySheetState } from './category-sheet';
import { usePermissions } from '@/features/auth/permissions';

export interface CategoryValue {
  categoryId: string;
  subcategoryId: string;
}

interface CategoryPickerProps {
  type: CategoryType;
  value: CategoryValue;
  onChange: (value: CategoryValue) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  // Injected by <Field>
  id?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
  'aria-label'?: string;
}

interface PickerItem {
  key: string;
  label: string;
  value: CategoryValue;
  parent: Category;
  searchText: string;
}

interface PickerGroup {
  key: string;
  label: string | null;
  items: PickerItem[];
}

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/**
 * Category field as one searchable list: parent categories are group headings and only
 * subcategories are selectable (a category without subcategories is selectable itself).
 */
export function CategoryPicker({
  type,
  value,
  onChange,
  placeholder = 'Selecione',
  className,
  disabled,
  id,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
  'aria-label': ariaLabel,
}: CategoryPickerProps) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [sheet, setSheet] = useState<CategorySheetState>({ open: false, type });
  const { canWrite } = usePermissions();
  const listRef = useRef<HTMLDivElement>(null);
  const categories = useCategories({ type });

  const groups = useMemo(() => buildGroups(categories.data ?? []), [categories.data]);
  const filtered = useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return groups;
    return groups
      .map((g) => ({ ...g, items: g.items.filter((i) => i.searchText.includes(q)) }))
      .filter((g) => g.items.length > 0);
  }, [groups, query]);
  const flat = filtered.flatMap((g) => g.items);

  const selected = findSelected(groups, value);

  function choose(item: PickerItem) {
    onChange(item.value);
    setOpen(false);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!flat.length) return;
      const next = e.key === 'ArrowDown' ? (active + 1) % flat.length : (active - 1 + flat.length) % flat.length;
      setActive(next);
      listRef.current?.querySelector(`[data-index="${next}"]`)?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = flat[active];
      if (item) choose(item);
    }
  }

  let index = -1;
  return (
    <>
      <Popover.Root
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (o) {
            setQuery('');
            const current = flat.findIndex((i) => sameValue(i.value, value));
            setActive(current >= 0 ? current : 0);
          }
        }}
      >
        <Popover.Trigger
          id={id}
          type="button"
          disabled={disabled}
          aria-label={ariaLabel}
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedBy}
          aria-haspopup="listbox"
          className={cn(
            inputClasses,
            'group/picker flex cursor-pointer items-center gap-2 text-left data-[state=open]:border-brand-500 data-[state=open]:ring-[3px] data-[state=open]:ring-brand-500/15',
            className,
          )}
        >
          {selected ? (
            <>
              <CategoryIcon icon={selected.icon} color={selected.parent.color} className="!size-6 !rounded-md [&_svg]:!size-3.5" />
              <span className="min-w-0 flex-1 truncate">
                {selected.label}
                {selected.parentLabel ? <span className="text-subtle"> · {selected.parentLabel}</span> : null}
              </span>
            </>
          ) : (
            <span className="min-w-0 flex-1 truncate text-subtle">{placeholder}</span>
          )}
          <ChevronDown className="size-4 shrink-0 text-muted transition-transform duration-150 group-data-[state=open]/picker:rotate-180" />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={6}
            collisionPadding={12}
            onOpenAutoFocus={(e) => e.preventDefault()}
            className="z-50 flex w-[max(var(--radix-popover-trigger-width),300px)] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-lg data-[state=open]:animate-fade-in"
          >
            <label className="flex items-center gap-2 border-b border-border px-3.5">
              <Search className="size-4 shrink-0 text-subtle" aria-hidden />
              <input
                autoFocus
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={onKeyDown}
                placeholder="Buscar..."
                role="combobox"
                aria-expanded
                aria-controls={listId}
                aria-activedescendant={flat[active] ? `${listId}-${active}` : undefined}
                aria-label="Buscar categoria"
                className="h-11 min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-subtle"
              />
            </label>
            <div ref={listRef} id={listId} role="listbox" aria-label="Categorias" className="scrollbar-thin max-h-[min(320px,var(--radix-popover-content-available-height))] overflow-y-auto p-1.5">
              {categories.isPending ? (
                <p className="px-3 py-6 text-center text-sm text-muted">Carregando…</p>
              ) : filtered.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-muted">Nenhuma categoria encontrada</p>
              ) : (
                filtered.map((g, gi) => (
                  <div key={g.key} role="group" aria-label={g.label ?? 'Outras categorias'} className={cn(gi > 0 && 'mt-1 border-t border-border pt-1')}>
                    {g.label ? (
                      <p className="px-3 pt-2 pb-1 text-[12px] font-medium text-subtle">{g.label}</p>
                    ) : null}
                    {g.items.map((item) => {
                      index += 1;
                      const i = index;
                      const checked = sameValue(item.value, value);
                      return (
                        <div
                          key={item.key}
                          id={`${listId}-${i}`}
                          data-index={i}
                          role="option"
                          aria-selected={checked}
                          onMouseEnter={() => setActive(i)}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => choose(item)}
                          className={cn(
                            'flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm text-fg transition-colors',
                            i === active && 'bg-bg-subtle',
                          )}
                        >
                          <span
                            aria-hidden
                            className={cn(
                              'flex size-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors',
                              checked ? 'border-primary' : 'border-border-strong',
                            )}
                          >
                            {checked ? <span className="size-2.5 rounded-full bg-primary" /> : null}
                          </span>
                          <span className={cn('min-w-0 flex-1 truncate', checked && 'font-semibold')}>{item.label}</span>
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
            {canWrite ? (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setSheet({ open: true, type, category: null, parent: null });
                }}
                className="flex items-center gap-2 border-t border-border px-4 py-3 text-sm font-semibold text-brand-text transition-colors hover:bg-bg-subtle"
              >
                <Plus className="size-4" /> Nova categoria
              </button>
            ) : null}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <CategorySheet
        state={sheet}
        onOpenChange={(o) => setSheet((s) => ({ ...s, open: o }))}
        onCreated={(c) => onChange(c.parentId ? { categoryId: c.parentId, subcategoryId: c.id } : { categoryId: c.id, subcategoryId: '' })}
      />
    </>
  );
}

function sameValue(a: CategoryValue, b: CategoryValue) {
  return a.categoryId === b.categoryId && (a.subcategoryId || '') === (b.subcategoryId || '');
}

function buildGroups(categories: CategoryWithChildren[]): PickerGroup[] {
  const groups: PickerGroup[] = [];
  const standalone: PickerItem[] = [];
  for (const c of categories) {
    if (c.archived) continue;
    const subs = c.subcategories.filter((s) => !s.archived);
    if (subs.length === 0) {
      standalone.push({
        key: c.id,
        label: c.name,
        value: { categoryId: c.id, subcategoryId: '' },
        parent: c,
        searchText: normalize(c.name),
      });
      continue;
    }
    groups.push({
      key: c.id,
      label: c.name,
      items: subs.map((s) => ({
        key: s.id,
        label: s.name,
        value: { categoryId: c.id, subcategoryId: s.id },
        parent: c,
        searchText: normalize(`${s.name} ${c.name}`),
      })),
    });
  }
  if (standalone.length) groups.push({ key: 'standalone', label: groups.length ? 'Outras categorias' : null, items: standalone });
  return groups;
}

/** What the trigger shows, including legacy values (category without the subcategory). */
function findSelected(groups: PickerGroup[], value: CategoryValue) {
  if (!value.categoryId) return null;
  for (const g of groups) {
    for (const item of g.items) {
      if (sameValue(item.value, value)) {
        const isSub = Boolean(item.value.subcategoryId);
        return {
          label: item.label,
          parentLabel: isSub ? item.parent.name : null,
          parent: item.parent,
          icon: isSub ? subIcon(item) : item.parent.icon,
        };
      }
    }
  }
  const parent = groups.flatMap((g) => g.items).find((i) => i.parent.id === value.categoryId)?.parent;
  return parent ? { label: parent.name, parentLabel: null, parent, icon: parent.icon } : null;
}

function subIcon(item: PickerItem) {
  const sub = (item.parent as CategoryWithChildren).subcategories?.find((s) => s.id === item.value.subcategoryId);
  return sub?.icon ?? item.parent.icon;
}
