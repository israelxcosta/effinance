import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import type { z } from 'zod';
import { CARD_BRAND_LABELS, CARD_BRANDS, creditCardInputSchema, getBank, type CreditCard } from '@effinance/shared';
import { Sheet } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { MoneyInput } from '@/components/ui/money-input';
import { Switch } from '@/components/ui/switch';
import { ColorPicker } from '@/components/ui/color-picker';
import { BankPicker } from '@/components/ui/bank-picker';
import { useAccounts } from '@/features/accounts/api';
import { useSaveCard } from './api';
import { toastError } from '@/lib/notify';
import { WriteGate } from '@/features/auth/permissions';

type FormIn = z.input<typeof creditCardInputSchema>;
type FormOut = z.output<typeof creditCardInputSchema>;

const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

function defaults(card?: CreditCard | null): FormIn {
  return {
    name: card?.name ?? '',
    bank: card?.bank ?? 'nubank',
    brand: card?.brand ?? 'mastercard',
    limit: card?.limit ?? 0,
    closingDay: card?.closingDay ?? 5,
    dueDay: card?.dueDay ?? 12,
    color: card?.color ?? '#820AD1',
    defaultAccountId: card?.defaultAccountId ?? null,
    archived: card?.archived ?? false,
  };
}

export function CardSheet({ open, onOpenChange, card }: { open: boolean; onOpenChange: (o: boolean) => void; card?: CreditCard | null }) {
  const save = useSaveCard();
  const accounts = useAccounts();
  const form = useForm<FormIn, unknown, FormOut>({ resolver: zodResolver(creditCardInputSchema), defaultValues: defaults(card) });
  const { register, control, handleSubmit, reset, formState, setValue, getValues } = form;

  useEffect(() => {
    if (open) reset(defaults(card));
  }, [open, card, reset]);

  const onSubmit = handleSubmit(async (input) => {
    try {
      await save.mutateAsync({ id: card?.id, input });
      toast.success(card ? 'Cartão atualizado' : 'Cartão criado');
      onOpenChange(false);
    } catch (error) {
      toastError(error);
    }
  });

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={card ? 'Editar cartão' : 'Novo cartão de crédito'}
      description="Limite, fechamento e vencimento da fatura"
      width="lg"
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
        <Field label="Banco" error={formState.errors.bank?.message}>
          <Controller
            control={control}
            name="bank"
            render={({ field }) => (
              <BankPicker
                allowNone={false}
                value={field.value}
                onChange={(code) => {
                  field.onChange(code ?? 'other');
                  const bank = getBank(code);
                  if (bank) {
                    setValue('color', bank.color.toUpperCase());
                    if (!getValues('name')) setValue('name', bank.name);
                  }
                }}
              />
            )}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nome do cartão" error={formState.errors.name?.message}>
            <Input placeholder="Ex: Nubank Ultravioleta" {...register('name')} />
          </Field>
          <Field label="Bandeira" error={formState.errors.brand?.message}>
            <Select {...register('brand')}>
              {CARD_BRANDS.map((b) => (
                <option key={b} value={b}>{CARD_BRAND_LABELS[b]}</option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Limite total" error={formState.errors.limit?.message}>
          <Controller control={control} name="limit" render={({ field }) => <MoneyInput value={field.value} onChange={field.onChange} />} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Dia de fechamento" hint="Compras a partir deste dia vão para a próxima fatura" error={formState.errors.closingDay?.message}>
            <Select {...register('closingDay', { valueAsNumber: true })}>
              {DAYS.map((d) => <option key={d} value={d}>Dia {d}</option>)}
            </Select>
          </Field>
          <Field label="Dia de vencimento" error={formState.errors.dueDay?.message}>
            <Select {...register('dueDay', { valueAsNumber: true })}>
              {DAYS.map((d) => <option key={d} value={d}>Dia {d}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Conta para pagamento da fatura" hint="Sugerida ao pagar a fatura">
          <Controller
            control={control}
            name="defaultAccountId"
            render={({ field }) => (
              <Select value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value || null)}>
                <option value="">Nenhuma</option>
                {(accounts.data ?? []).filter((a) => !a.archived).map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </Select>
            )}
          />
        </Field>
        <Field label="Cor do cartão">
          <Controller control={control} name="color" render={({ field }) => <ColorPicker value={field.value ?? '#152B61'} onChange={field.onChange} />} />
        </Field>
        {card ? (
          <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-border p-4">
            <span>
              <span className="block text-sm font-semibold">Arquivado</span>
              <span className="block text-xs text-muted">Oculta o cartão sem apagar o histórico.</span>
            </span>
            <Controller control={control} name="archived" render={({ field }) => <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />} />
          </label>
        ) : null}
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}
