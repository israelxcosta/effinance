import { useEffect } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { ArrowDown, ThumbsDown, ThumbsUp } from 'lucide-react';
import {
  formatBRL,
  todayISO,
  transferInputSchema,
  type Account,
  type Transaction,
  type TransferInput,
} from '@effinance/shared';
import { Sheet } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { MoneyInput } from '@/components/ui/money-input';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { BankLogo } from '@/components/ui/bank-logo';
import { cn } from '@/lib/utils';
import { ApiRequestError, errorMessage } from '@/lib/api';
import { useAccounts } from '@/features/accounts/api';
import { useSaveTransfer } from './api';

export type TransferMode = 'transfer' | 'investment' | 'redemption';

export interface TransferSheetState {
  open: boolean;
  mode: TransferMode;
  transfer?: Transaction;
}

interface FormValues {
  mode: TransferMode;
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  date: string;
  description: string;
  notes: string;
  paid: boolean;
}

function initial(state: TransferSheetState): FormValues {
  const t = state.transfer;
  return {
    mode: t?.transferKind === 'investment' || t?.transferKind === 'redemption' ? t.transferKind : state.mode,
    fromAccountId: t?.accountId ?? '',
    toAccountId: t?.toAccountId ?? '',
    amount: t?.amount ?? 0,
    date: t?.date ?? todayISO(),
    description: t?.description ?? '',
    notes: t?.notes ?? '',
    paid: t ? t.paid : true,
  };
}

const TITLES: Record<TransferMode, string> = {
  transfer: 'Transferência',
  investment: 'Investimento',
  redemption: 'Resgate',
};

export function TransferSheet({ state, onOpenChange }: { state: TransferSheetState; onOpenChange: (open: boolean) => void }) {
  const isEdit = Boolean(state.transfer);
  const form = useForm<FormValues>({ defaultValues: initial(state) });
  const { register, control, handleSubmit, reset, setValue, setError, formState } = form;
  const values = useWatch({ control }) as FormValues;
  const accounts = useAccounts();
  const save = useSaveTransfer();

  useEffect(() => {
    if (state.open) reset(initial(state));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.open, state.transfer?.id, state.mode]);

  const list = (accounts.data ?? []).filter((a) => !a.archived);
  const isInvestment = (a: Account) => a.type === 'investment';
  const fromOptions = list.filter((a) =>
    values.mode === 'investment' ? !isInvestment(a) : values.mode === 'redemption' ? isInvestment(a) : true,
  );
  const toOptions = list.filter(
    (a) =>
      a.id !== values.fromAccountId &&
      (values.mode === 'investment' ? isInvestment(a) : values.mode === 'redemption' ? !isInvestment(a) : true),
  );
  const from = list.find((a) => a.id === values.fromAccountId);
  const to = list.find((a) => a.id === values.toAccountId);

  const onSubmit = handleSubmit(async (v) => {
    const payload: TransferInput = {
      fromAccountId: v.fromAccountId,
      toAccountId: v.toAccountId,
      amount: v.amount,
      date: v.date,
      description: v.description || null,
      notes: v.notes || null,
      paid: v.paid,
    };
    const parsed = transferInputSchema.safeParse(payload);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) setError(String(issue.path[0]) as keyof FormValues, { message: issue.message });
      if (!v.fromAccountId) setError('fromAccountId', { message: 'Selecione a conta de origem' });
      if (!v.toAccountId) setError('toAccountId', { message: 'Selecione a conta de destino' });
      return;
    }
    try {
      await save.mutateAsync({ id: state.transfer?.id, input: payload });
      toast.success(isEdit ? 'Movimentação atualizada' : `${TITLES[v.mode]} registrada`);
      onOpenChange(false);
    } catch (error) {
      if (error instanceof ApiRequestError) {
        for (const [key, message] of Object.entries(error.fieldErrors())) setError(key as keyof FormValues, { message });
      }
      toast.error(errorMessage(error));
    }
  });

  const noInvestmentAccount = values.mode !== 'transfer' && !list.some(isInvestment);

  return (
    <Sheet
      open={state.open}
      onOpenChange={onOpenChange}
      title={isEdit ? 'Editar movimentação' : 'Movimentar dinheiro'}
      description="Transferências entre contas, aplicações e resgates"
      headerExtra={
        <Controller
          control={control}
          name="mode"
          render={({ field }) => (
            <SegmentedControl
              variant="card"
              fullWidth
              ariaLabel="Tipo de movimentação"
              value={field.value}
              onChange={(m) => {
                field.onChange(m);
                setValue('fromAccountId', '');
                setValue('toAccountId', '');
              }}
              options={[
                { value: 'transfer', label: 'Transferir', activeClassName: 'bg-primary text-primary-fg shadow-sm' },
                { value: 'investment', label: 'Investir', activeClassName: 'bg-primary text-primary-fg shadow-sm' },
                { value: 'redemption', label: 'Resgatar', activeClassName: 'bg-primary text-primary-fg shadow-sm' },
              ]}
            />
          )}
        />
      }
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
        {noInvestmentAccount ? (
          <p className="rounded-md bg-warning-soft px-3 py-2.5 text-[13px] text-warning">
            Cadastre uma conta do tipo <strong>Investimento</strong> em Contas para aplicar ou resgatar. O saldo investido é somado à parte.
          </p>
        ) : null}

        <Field label="Valor" error={formState.errors.amount?.message}>
          <Controller
            control={control}
            name="amount"
            render={({ field }) => <MoneyInput size="lg" value={field.value} onChange={field.onChange} data-autofocus aria-label="Valor" />}
          />
        </Field>

        <div className="flex flex-col gap-2">
          <AccountPick label="De" account={from} error={formState.errors.fromAccountId?.message}>
            <Select {...register('fromAccountId')} aria-label="Conta de origem">
              <option value="">Selecione a conta de origem</option>
              {fromOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {formatBRL(a.balance)}
                </option>
              ))}
            </Select>
          </AccountPick>
          <div className="flex justify-center">
            <span className="flex size-8 items-center justify-center rounded-full border border-border bg-surface text-muted">
              <ArrowDown className="size-4" />
            </span>
          </div>
          <AccountPick label="Para" account={to} error={formState.errors.toAccountId?.message}>
            <Select {...register('toAccountId')} aria-label="Conta de destino">
              <option value="">Selecione a conta de destino</option>
              {toOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {formatBRL(a.balance)}
                </option>
              ))}
            </Select>
          </AccountPick>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Data" error={formState.errors.date?.message}>
            <Input type="date" {...register('date')} />
          </Field>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-[13px] font-medium">Status</legend>
            <div className="grid grid-cols-2 gap-1.5">
              {[
                { v: true, label: 'Efetivada', icon: <ThumbsUp className="size-3.5" /> },
                { v: false, label: 'Agendada', icon: <ThumbsDown className="size-3.5" /> },
              ].map((o) => (
                <button
                  key={o.label}
                  type="button"
                  role="radio"
                  aria-checked={values.paid === o.v}
                  onClick={() => setValue('paid', o.v)}
                  className={cn(
                    'flex h-11 items-center justify-center gap-1 rounded-md border text-xs font-semibold transition-colors',
                    values.paid === o.v
                      ? o.v
                        ? 'border-success/30 bg-success-soft text-success'
                        : 'border-danger/30 bg-danger-soft text-danger'
                      : 'border-border text-muted hover:text-fg',
                  )}
                >
                  {o.icon}
                  {o.label}
                </button>
              ))}
            </div>
          </fieldset>
        </div>

        <Field label="Descrição" hint="Opcional">
          <Input placeholder={values.mode === 'investment' ? 'Ex: Aporte CDB' : values.mode === 'redemption' ? 'Ex: Resgate reserva' : 'Ex: Reserva para viagem'} maxLength={120} {...register('description')} />
        </Field>
        <Field label="Observações">
          <Textarea maxLength={1000} {...register('notes')} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}

function AccountPick({ label, account, error, children }: { label: string; account?: Account; error?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium">{label}</span>
      <div className="flex items-center gap-3">
        <BankLogo bank={account?.bank} color={account?.color} size="md" />
        <div className="flex-1">{children}</div>
      </div>
      {error ? <p className="text-xs font-medium text-danger" role="alert">{error}</p> : null}
    </div>
  );
}
