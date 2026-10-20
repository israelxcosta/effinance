import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import type { z } from 'zod';
import { goalInputSchema, type Goal } from '@effinance/shared';
import { Sheet } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { MoneyInput } from '@/components/ui/money-input';
import { IconPicker } from '@/components/ui/icon-picker';
import { ColorPicker } from '@/components/ui/color-picker';
import { Switch } from '@/components/ui/switch';
import { useAccounts } from '@/features/accounts/api';
import { useSaveGoal } from './api';
import { toastError } from '@/lib/notify';
import { WriteGate } from '@/features/auth/permissions';

type FormIn = z.input<typeof goalInputSchema>;
type FormOut = z.output<typeof goalInputSchema>;

function defaults(goal?: Goal | null): FormIn {
  return {
    name: goal?.name ?? '',
    targetAmount: goal?.targetAmount ?? 0,
    deadline: goal?.deadline ?? null,
    icon: goal?.icon ?? 'target',
    color: goal?.color ?? '#152B61',
    accountId: goal?.accountId ?? null,
    notes: goal?.notes ?? null,
    archived: goal?.archived ?? false,
  };
}

export function GoalSheet({ open, onOpenChange, goal }: { open: boolean; onOpenChange: (o: boolean) => void; goal?: Goal | null }) {
  const save = useSaveGoal();
  const accounts = useAccounts();
  const form = useForm<FormIn, unknown, FormOut>({ resolver: zodResolver(goalInputSchema), defaultValues: defaults(goal) });
  const { register, control, handleSubmit, reset, formState, watch } = form;
  useEffect(() => {
    if (open) reset(defaults(goal));
  }, [open, goal, reset]);
  const color = watch('color') ?? '#152B61';

  const onSubmit = handleSubmit(async (input) => {
    try {
      await save.mutateAsync({ id: goal?.id, input });
      toast.success(goal ? 'Meta atualizada' : 'Meta criada 🎯');
      onOpenChange(false);
    } catch (error) {
      toastError(error);
    }
  });

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={goal ? 'Editar meta' : 'Nova meta'}
      description="Defina um objetivo e acompanhe seu progresso"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <WriteGate>
            <Button onClick={onSubmit} loading={save.isPending} className="min-w-[110px]">Salvar</Button>
          </WriteGate>
        </>
      }
    >
      <form className="flex flex-col gap-5" onSubmit={(e) => { e.preventDefault(); void onSubmit(); }} noValidate>
        <Field label="Nome da meta" error={formState.errors.name?.message}>
          <Input placeholder="Ex: Reserva de emergência, Viagem" {...register('name')} />
        </Field>
        <Field label="Valor alvo" error={formState.errors.targetAmount?.message}>
          <Controller control={control} name="targetAmount" render={({ field }) => <MoneyInput size="lg" value={field.value} onChange={field.onChange} />} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Prazo" hint="Opcional" error={formState.errors.deadline?.message}>
            <Controller
              control={control}
              name="deadline"
              render={({ field }) => <Input type="date" value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value || null)} />}
            />
          </Field>
          <Field label="Conta vinculada" hint="Opcional">
            <Controller
              control={control}
              name="accountId"
              render={({ field }) => (
                <Select value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value || null)}>
                  <option value="">Nenhuma</option>
                  {(accounts.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </Select>
              )}
            />
          </Field>
        </div>
        <Field label="Cor">
          <Controller control={control} name="color" render={({ field }) => <ColorPicker value={field.value ?? '#152B61'} onChange={field.onChange} />} />
        </Field>
        <Field label="Ícone">
          <Controller control={control} name="icon" render={({ field }) => <IconPicker value={field.value ?? 'target'} onChange={field.onChange} color={color} />} />
        </Field>
        <Field label="Observações">
          <Controller control={control} name="notes" render={({ field }) => <Textarea value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value)} />} />
        </Field>
        {goal ? (
          <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-border p-4">
            <span>
              <span className="block text-sm font-semibold">Arquivada</span>
              <span className="block text-xs text-muted">Oculta a meta do dashboard.</span>
            </span>
            <Controller control={control} name="archived" render={({ field }) => <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />} />
          </label>
        ) : null}
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}
