import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import type { z } from 'zod';
import { ACCOUNT_TYPE_LABELS, ACCOUNT_TYPES, accountInputSchema, type Account } from '@effinance/shared';
import { Sheet } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { MoneyInput } from '@/components/ui/money-input';
import { Switch } from '@/components/ui/switch';
import { ColorPicker } from '@/components/ui/color-picker';
import { BankPicker } from '@/components/ui/bank-picker';
import { errorMessage } from '@/lib/api';
import { useSaveAccount } from './api';

type FormIn = z.input<typeof accountInputSchema>;
type FormOut = z.output<typeof accountInputSchema>;

function defaults(account?: Account | null): FormIn {
  return {
    name: account?.name ?? '',
    type: account?.type ?? 'checking',
    bank: account?.bank ?? null,
    color: account?.color ?? '#152B61',
    icon: account?.icon ?? 'wallet',
    initialBalance: account?.initialBalance ?? 0,
    includeInTotal: account?.includeInTotal ?? true,
    archived: account?.archived ?? false,
  };
}

export function AccountSheet({ open, onOpenChange, account }: { open: boolean; onOpenChange: (o: boolean) => void; account?: Account | null }) {
  const save = useSaveAccount();
  const form = useForm<FormIn, unknown, FormOut>({ resolver: zodResolver(accountInputSchema), defaultValues: defaults(account) });
  const { register, control, handleSubmit, reset, formState, watch, setValue } = form;

  useEffect(() => {
    if (open) reset(defaults(account));
  }, [open, account, reset]);

  const type = watch('type');

  const onSubmit = handleSubmit(async (input) => {
    try {
      await save.mutateAsync({ id: account?.id, input });
      toast.success(account ? 'Conta atualizada' : 'Conta criada');
      onOpenChange(false);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  });

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={account ? 'Editar conta' : 'Nova conta'}
      description="Contas bancárias, carteiras, benefícios e investimentos"
      width="lg"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={onSubmit} loading={save.isPending} className="min-w-[110px]">
            Salvar
          </Button>
        </>
      }
    >
      <form className="flex flex-col gap-5" onSubmit={(e) => { e.preventDefault(); void onSubmit(); }} noValidate>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nome" error={formState.errors.name?.message}>
            <Input placeholder="Ex: Nubank, Carteira, Reserva" {...register('name')} />
          </Field>
          <Field label="Tipo" error={formState.errors.type?.message}>
            <Select
              {...register('type', {
                onChange: (e) => {
                  if (e.target.value === 'investment') setValue('includeInTotal', false);
                },
              })}
            >
              {ACCOUNT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {ACCOUNT_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Banco / instituição">
          <Controller control={control} name="bank" render={({ field }) => <BankPicker value={field.value ?? null} onChange={field.onChange} />} />
        </Field>

        <Field
          label="Saldo inicial"
          hint={account ? 'Alterar o saldo inicial recalcula o saldo atual.' : 'Saldo da conta antes dos lançamentos no Effinance. Use ± para negativo.'}
          error={formState.errors.initialBalance?.message}
        >
          <Controller
            control={control}
            name="initialBalance"
            render={({ field }) => <MoneyInput value={field.value} onChange={field.onChange} allowNegative />}
          />
        </Field>

        <Field label="Cor">
          <Controller control={control} name="color" render={({ field }) => <ColorPicker value={field.value ?? '#152B61'} onChange={field.onChange} />} />
        </Field>

        <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
          <label className="flex cursor-pointer items-center justify-between gap-4">
            <span>
              <span className="block text-sm font-semibold">Incluir no saldo total</span>
              <span className="block text-xs text-muted">
                {type === 'investment' ? 'Investimentos são somados à parte, no total investido.' : 'Soma esta conta no "Saldo em contas" do dashboard.'}
              </span>
            </span>
            <Controller control={control} name="includeInTotal" render={({ field }) => <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />} />
          </label>
          {account ? (
            <label className="flex cursor-pointer items-center justify-between gap-4 border-t border-border pt-3">
              <span>
                <span className="block text-sm font-semibold">Arquivada</span>
                <span className="block text-xs text-muted">Oculta a conta das listas sem apagar o histórico.</span>
              </span>
              <Controller control={control} name="archived" render={({ field }) => <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />} />
            </label>
          ) : null}
        </div>
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}
