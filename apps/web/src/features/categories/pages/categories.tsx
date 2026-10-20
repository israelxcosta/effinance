import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { Ellipsis, Pencil, Plus, Tags, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { Category, CategoryType } from '@effinance/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CategoryIcon } from '@/components/ui/category-icon';
import { ConfirmDialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState, PageHeader } from '@/components/ui/misc';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { alpha, cn } from '@/lib/utils';
import { errorMessage } from '@/lib/api';
import { useCategories, useDeleteCategory } from '../api';
import { CategorySheet, type CategorySheetState } from '../category-sheet';
import { useTone } from '@/lib/theme';

export default function CategoriesPage() {
  const [params, setParams] = useSearchParams();
  const tone = useTone();
  const type = (params.get('tipo') as CategoryType) || 'expense';
  const [showArchived, setShowArchived] = useState(false);
  const categories = useCategories({ type, includeArchived: showArchived });
  const [sheet, setSheet] = useState<CategorySheetState>({ open: false, type });
  const [toDelete, setToDelete] = useState<Category | null>(null);
  const del = useDeleteCategory();

  const open = (s: Omit<CategorySheetState, 'open' | 'type'>) => setSheet({ open: true, type, ...s });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        overline="Cadastros"
        title="Categorias"
        description="Classifique receitas e despesas com ícones, cores e subcategorias."
        actions={
          <>
            <label className="mr-2 flex cursor-pointer items-center gap-2 text-[13px] font-medium text-muted">
              <Switch checked={showArchived} onCheckedChange={setShowArchived} aria-label="Mostrar arquivadas" /> Arquivadas
            </label>
            <Button onClick={() => open({ category: null, parent: null })}>
              <Plus /> Nova categoria
            </Button>
          </>
        }
      />

      <SegmentedControl
        variant="solid"
        ariaLabel="Tipo de categoria"
        value={type}
        onChange={(t) => setParams({ tipo: t }, { replace: true })}
        options={[
          { value: 'expense', label: 'Despesas' },
          { value: 'income', label: 'Receitas' },
        ]}
        className="self-start"
      />

      {categories.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
        </div>
      ) : categories.isError ? (
        <ErrorState error={categories.error} onRetry={() => categories.refetch()} />
      ) : categories.data.length === 0 ? (
        <Card className="p-5">
          <EmptyState
            icon={<Tags />}
            title={type === 'expense' ? 'Nenhuma categoria de despesa' : 'Nenhuma categoria de receita'}
            description="Crie categorias para entender para onde vai e de onde vem seu dinheiro."
            action={<Button variant="outline" onClick={() => open({ category: null, parent: null })}>Criar categoria</Button>}
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {categories.data.map((c) => (
            <Card key={c.id} className={cn('flex flex-col gap-4 p-5', c.archived && 'opacity-60')}>
              <div className="flex items-start gap-3">
                <CategoryIcon icon={c.icon} color={c.color} size="lg" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold">{c.name}</p>
                  <p className="text-xs text-muted">
                    {c.subcategories.length ? `${c.subcategories.length} subcategoria(s)` : 'Sem subcategorias'}
                    {c.archived ? ' · arquivada' : ''}
                  </p>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button type="button" className="flex size-8 items-center justify-center rounded-md text-muted hover:bg-bg-subtle hover:text-fg" aria-label={`Ações de ${c.name}`}>
                      <Ellipsis className="size-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem icon={<Pencil />} onSelect={() => open({ category: c, parent: null })}>Editar</DropdownMenuItem>
                    <DropdownMenuItem icon={<Plus />} onSelect={() => open({ category: null, parent: c })}>Nova subcategoria</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem icon={<Trash2 />} tone="danger" onSelect={() => setToDelete(c)}>Excluir</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {c.subcategories.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => open({ category: s, parent: c })}
                    className={cn('inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors hover:brightness-95', s.archived && 'line-through opacity-60')}
                    style={{ backgroundColor: alpha(tone(s.color), 0.1), borderColor: alpha(tone(s.color), 0.25), color: tone(s.color) }}
                    title="Editar subcategoria"
                  >
                    <CategoryIcon icon={s.icon} color={s.color} className="!size-4 !bg-transparent [&_svg]:!size-3.5" />
                    {s.name}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => open({ category: null, parent: c })}
                  className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-border-strong px-2.5 text-xs font-medium text-muted hover:text-fg"
                >
                  <Plus className="size-3.5" /> Subcategoria
                </button>
              </div>
              {c.archived ? <Badge className="self-start">Arquivada</Badge> : null}
            </Card>
          ))}
        </div>
      )}

      <CategorySheet state={sheet} onOpenChange={(o) => setSheet((s) => ({ ...s, open: o }))} />
      <ConfirmDialog
        open={Boolean(toDelete)}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Excluir categoria?"
        description={`"${toDelete?.name}" e suas subcategorias serão excluídas. Categorias com lançamentos não podem ser excluídas — arquive-as na edição.`}
        confirmLabel="Excluir"
        loading={del.isPending}
        onConfirm={async () => {
          try {
            await del.mutateAsync(toDelete!.id);
            toast.success('Categoria excluída');
            setToDelete(null);
          } catch (error) {
            toast.error(errorMessage(error));
          }
        }}
      />
    </div>
  );
}
