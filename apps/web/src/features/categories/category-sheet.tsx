import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { categoryInputSchema, categoryUpdateSchema, type Category, type CategoryType, type IconName } from '@effinance/shared';
import { Sheet } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { IconPicker } from '@/components/ui/icon-picker';
import { ColorPicker } from '@/components/ui/color-picker';
import { CategoryIcon } from '@/components/ui/category-icon';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Switch } from '@/components/ui/switch';
import { errorMessage } from '@/lib/api';
import { useCreateCategory, useUpdateCategory } from './api';

export interface CategorySheetState {
  open: boolean;
  category?: Category | null;
  parent?: Category | null;
  type: CategoryType;
}

interface FormValues {
  name: string;
  type: CategoryType;
  icon: IconName;
  color: string;
  archived: boolean;
}

export function CategorySheet({
  state,
  onOpenChange,
  onCreated,
}: {
  state: CategorySheetState;
  onOpenChange: (o: boolean) => void;
  /** Called with the new category after a successful create (e.g. to select it in a picker). */
  onCreated?: (category: Category) => void;
}) {
  const create = useCreateCategory();
  const update = useUpdateCategory();
  const { category, parent } = state;
  const form = useForm<FormValues>();
  const { register, control, handleSubmit, reset, watch, setError, formState } = form;

  useEffect(() => {
    if (!state.open) return;
    reset({
      name: category?.name ?? '',
      type: category?.type ?? parent?.type ?? state.type,
      icon: category?.icon ?? parent?.icon ?? 'tag',
      color: category?.color ?? parent?.color ?? (state.type === 'income' ? '#12A150' : '#152B61'),
      archived: category?.archived ?? false,
    });
  }, [state.open, category, parent, state.type, reset]);

  const icon = watch('icon');
  const color = watch('color');
  const name = watch('name');

  const onSubmit = handleSubmit(async (v) => {
    try {
      if (category) {
        const parsed = categoryUpdateSchema.safeParse({ name: v.name, icon: v.icon, color: v.color, archived: v.archived });
        if (!parsed.success) {
          for (const i of parsed.error.issues) setError(String(i.path[0]) as keyof FormValues, { message: i.message });
          return;
        }
        await update.mutateAsync({ id: category.id, input: parsed.data });
        toast.success('Categoria atualizada');
      } else {
        const parsed = categoryInputSchema.safeParse({ name: v.name, type: v.type, icon: v.icon, color: v.color, parentId: parent?.id ?? null });
        if (!parsed.success) {
          for (const i of parsed.error.issues) setError(String(i.path[0]) as keyof FormValues, { message: i.message });
          return;
        }
        const created = await create.mutateAsync(parsed.data);
        toast.success(parent ? 'Subcategoria criada' : 'Categoria criada');
        onCreated?.(created);
      }
      onOpenChange(false);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  });

  const title = category ? (category.parentId ? 'Editar subcategoria' : 'Editar categoria') : parent ? 'Nova subcategoria' : 'Nova categoria';

  return (
    <Sheet
      open={state.open}
      onOpenChange={onOpenChange}
      title={title}
      description={parent ? `Dentro de ${parent.name}` : 'Organize receitas e despesas com ícones e cores'}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={onSubmit} loading={create.isPending || update.isPending} className="min-w-[110px]">Salvar</Button>
        </>
      }
    >
      <form className="flex flex-col gap-5" onSubmit={(e) => { e.preventDefault(); void onSubmit(); }} noValidate>
        <div className="flex items-center gap-3 rounded-lg bg-surface-muted p-4">
          <CategoryIcon icon={icon} color={color} size="lg" />
          <div>
            <p className="text-sm font-semibold">{name || 'Nome da categoria'}</p>
            <p className="text-xs text-muted">Pré-visualização</p>
          </div>
        </div>
        {!category && !parent ? (
          <Controller
            control={control}
            name="type"
            render={({ field }) => (
              <SegmentedControl
                fullWidth
                ariaLabel="Tipo"
                value={field.value}
                onChange={field.onChange}
                options={[
                  { value: 'expense', label: 'Despesa', activeClassName: 'bg-danger text-white shadow-sm' },
                  { value: 'income', label: 'Receita', activeClassName: 'bg-success text-white shadow-sm' },
                ]}
              />
            )}
          />
        ) : null}
        <Field label="Nome" error={formState.errors.name?.message}>
          <Input placeholder="Ex: Alimentação" maxLength={60} {...register('name')} />
        </Field>
        <Field label="Cor">
          <Controller control={control} name="color" render={({ field }) => <ColorPicker value={field.value ?? '#152B61'} onChange={field.onChange} />} />
        </Field>
        <Field label="Ícone">
          <Controller control={control} name="icon" render={({ field }) => <IconPicker value={field.value} onChange={field.onChange} color={color} />} />
        </Field>
        {category ? (
          <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-border p-4">
            <span>
              <span className="block text-sm font-semibold">Arquivada</span>
              <span className="block text-xs text-muted">Some dos formulários, mas mantém o histórico.</span>
            </span>
            <Controller control={control} name="archived" render={({ field }) => <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />} />
          </label>
        ) : null}
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}
