import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { Infinity as InfinityIcon, Layers, Repeat, Split, ThumbsDown, ThumbsUp } from 'lucide-react';
import {
  FREQUENCIES,
  FREQUENCY_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  RECURRENCE_KIND_LABELS,
  formatBRL,
  splitInstallments,
  todayISO,
  transactionInputSchema,
  transactionUpdateSchema,
  type Frequency,
  type PaymentMethod,
  type SeriesScope,
  type Transaction,
  type TransactionInput,
  type TransactionUpdateInput,
} from '@effinance/shared';
import { Sheet } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { MoneyInput } from '@/components/ui/money-input';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { ApiRequestError } from '@/lib/api';
import { useAccounts } from '@/features/accounts/api';
import { useCards } from '@/features/cards/api';
import { CategoryPicker } from '@/features/categories/category-picker';
import { useContactOptions } from '@/features/contacts/api';
import { useCreateTransaction, useUpdateTransaction } from './api';
import { ScopeDialog } from './scope-dialog';
import { SplitEditor, evenSplit, newSplitRow, validateSplits, type SplitRow, type SplitRowErrors } from './components/split-editor';
import { toastError } from '@/lib/notify';
import { WriteGate } from '@/features/auth/permissions';

export type TxKind = 'income' | 'expense';

export interface TransactionSheetState {
  open: boolean;
  mode: 'create' | 'edit' | 'duplicate';
  type: TxKind;
  transaction?: Transaction;
  /** Prefill for create (e.g. contact or account from the current screen). */
  defaults?: Partial<Pick<FormValues, 'source' | 'contactId' | 'categoryId' | 'date'>>;
}

interface FormValues {
  type: TxKind;
  amount: number;
  description: string;
  paid: boolean;
  paidAt: string;
  /** '' | 'account:<id>' | 'card:<id>' */
  source: string;
  categoryId: string;
  subcategoryId: string;
  date: string;
  paymentMethod: string;
  contactId: string;
  notes: string;
  repeat: boolean;
  recurrenceKind: 'installment' | 'recurring';
  frequency: Frequency;
  installments: string;
  installmentAmountMode: 'total' | 'per_installment';
  occurrences: string;
  /** Divide the amount across categories (create only). */
  split: boolean;
  splits: SplitRow[];
}

function initialValues(state: TransactionSheetState): FormValues {
  const tx = state.transaction;
  const base: FormValues = {
    type: state.type,
    amount: 0,
    description: '',
    paid: false,
    paidAt: '',
    source: '',
    categoryId: '',
    subcategoryId: '',
    date: todayISO(),
    paymentMethod: '',
    contactId: '',
    notes: '',
    repeat: false,
    recurrenceKind: 'installment',
    frequency: 'monthly',
    installments: '2',
    installmentAmountMode: 'total',
    occurrences: '',
    split: false,
    splits: [],
  };
  if (!tx) return { ...base, ...state.defaults };
  return {
    ...base,
    type: tx.type === 'income' ? 'income' : 'expense',
    amount: tx.amount,
    description: tx.description,
    paid: state.mode === 'duplicate' ? false : tx.paid,
    paidAt: state.mode === 'duplicate' ? '' : (tx.paidAt ?? ''),
    source: tx.creditCardId ? `card:${tx.creditCardId}` : tx.accountId ? `account:${tx.accountId}` : '',
    categoryId: tx.categoryId ?? '',
    subcategoryId: tx.subcategoryId ?? '',
    date: state.mode === 'duplicate' ? todayISO() : tx.date,
    paymentMethod: tx.paymentMethod ?? '',
    contactId: tx.contactId ?? '',
    notes: tx.notes ?? '',
  };
}

const FIELD_ALIASES: Record<string, keyof FormValues> = {
  accountId: 'source',
  creditCardId: 'source',
};

interface TransactionSheetProps {
  state: TransactionSheetState;
  onOpenChange: (open: boolean) => void;
}

export function TransactionSheet({ state, onOpenChange }: TransactionSheetProps) {
  const isEdit = state.mode === 'edit' && Boolean(state.transaction);
  const form = useForm<FormValues>({ defaultValues: initialValues(state) });
  const { register, control, handleSubmit, reset, setValue, setError, formState } = form;
  const [scopeOpen, setScopeOpen] = useState(false);
  const [pendingUpdate, setPendingUpdate] = useState<TransactionUpdateInput | null>(null);
  const [splitErrors, setSplitErrors] = useState<{ rows: Record<number, SplitRowErrors>; summary?: string }>({ rows: {} });

  useEffect(() => {
    if (state.open) {
      reset(initialValues(state));
      setSplitErrors({ rows: {} });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.open, state.transaction?.id, state.mode, state.type]);

  const values = useWatch({ control }) as FormValues;
  const type = values.type ?? state.type;
  const isCard = (values.source ?? '').startsWith('card:');

  const accounts = useAccounts();
  const cards = useCards();
  const contacts = useContactOptions();
  const create = useCreateTransaction();
  const update = useUpdateTransaction();

  const activeAccounts = (accounts.data ?? []).filter((a) => !a.archived);
  const activeCards = (cards.data ?? []).filter((c) => !c.archived);

  const installmentPreview = useMemo(() => {
    const n = Number(values.installments);
    if (!values.repeat || values.recurrenceKind !== 'installment' || !n || n < 2 || !values.amount) return null;
    if (values.installmentAmountMode === 'per_installment') {
      return `${n}x de ${formatBRL(values.amount)} · total ${formatBRL(values.amount * n)}`;
    }
    const parts = splitInstallments(values.amount, n);
    const first = parts[0]!;
    const rest = parts[1]!;
    return first === rest
      ? `${n}x de ${formatBRL(rest)}`
      : `1x de ${formatBRL(first)} + ${n - 1}x de ${formatBRL(rest)}`;
  }, [values.repeat, values.recurrenceKind, values.installments, values.amount, values.installmentAmountMode]);

  function applyIssues(issues: { path: PropertyKey[]; message: string }[]) {
    for (const issue of issues) {
      const key = String(issue.path[0] ?? '');
      const field = (FIELD_ALIASES[key] ?? key) as keyof FormValues;
      if (field) setError(field, { message: issue.message });
    }
  }

  function commonPayload(v: FormValues) {
    const [kind, id] = v.source.split(':');
    const card = kind === 'card' ? id! : null;
    return {
      description: v.description,
      amount: v.amount,
      date: v.date,
      paid: card ? false : v.paid,
      paidAt: !card && v.paid ? v.paidAt || null : null,
      accountId: kind === 'account' ? id! : null,
      creditCardId: card,
      categoryId: v.categoryId || null,
      subcategoryId: v.subcategoryId || null,
      contactId: v.contactId || null,
      paymentMethod: (card ? 'credit_card' : v.paymentMethod || null) as PaymentMethod | null,
      notes: v.notes || null,
    };
  }

  function startSplit() {
    const first = newSplitRow({ categoryId: values.categoryId ?? '', subcategoryId: values.subcategoryId ?? '' });
    setValue('splits', evenSplit([first, newSplitRow()], values.amount ?? 0));
    setValue('split', true);
    setSplitErrors({ rows: {} });
  }

  function cancelSplit() {
    const first = values.splits?.[0];
    if (first) {
      setValue('categoryId', first.categoryId);
      setValue('subcategoryId', first.subcategoryId);
    }
    setValue('split', false);
    setValue('splits', []);
    setSplitErrors({ rows: {} });
  }

  async function submitCreate(v: FormValues) {
    let splits: TransactionInput['splits'] = null;
    if (v.split) {
      const check = validateSplits(v.splits, v.amount);
      setSplitErrors({ rows: check.rowErrors, summary: check.summary });
      if (!check.ok) return;
      splits = v.splits.map((r) => ({ categoryId: r.categoryId, subcategoryId: r.subcategoryId || null, amount: r.amount }));
    }
    const payload: TransactionInput = {
      type: v.type,
      ...commonPayload(v),
      ...(splits ? { categoryId: null, subcategoryId: null, splits } : {}),
      // Recurring without a quantity (empty or 0) repeats with no end — stored as 'fixed'.
      recurrenceKind: !v.repeat ? 'single' : v.recurrenceKind === 'recurring' && !(Number(v.occurrences) > 0) ? 'fixed' : v.recurrenceKind,
      frequency: v.repeat ? v.frequency : 'monthly',
      installments: v.repeat && v.recurrenceKind === 'installment' ? Number(v.installments) || null : null,
      installmentAmountMode: v.installmentAmountMode,
      occurrences: v.repeat && v.recurrenceKind === 'recurring' && Number(v.occurrences) > 0 ? Number(v.occurrences) : null,
    };
    const parsed = transactionInputSchema.safeParse(payload);
    if (!parsed.success) return applyIssues(parsed.error.issues);
    try {
      const created = await create.mutateAsync(payload);
      const label = v.type === 'income' ? 'Receita' : 'Despesa';
      toast.success(
        splits
          ? `${label} dividida em ${splits.length} categorias`
          : created.length > 1
            ? `${label} criada · ${created.length} lançamentos gerados`
            : `${label} criada`,
      );
      onOpenChange(false);
    } catch (error) {
      handleApiError(error);
    }
  }

  function handleApiError(error: unknown) {
    if (error instanceof ApiRequestError) {
      const fields = error.fieldErrors();
      for (const [key, message] of Object.entries(fields)) {
        const field = (FIELD_ALIASES[key.split('.')[0]!] ?? key.split('.')[0]) as keyof FormValues;
        setError(field, { message });
      }
    }
    toastError(error);
  }

  async function runUpdate(input: TransactionUpdateInput, scope: SeriesScope) {
    const tx = state.transaction!;
    try {
      await update.mutateAsync({ id: tx.id, input, scope });
      toast.success('Lançamento atualizado');
      setScopeOpen(false);
      onOpenChange(false);
    } catch (error) {
      handleApiError(error);
    }
  }

  async function submitEdit(v: FormValues) {
    const payload: TransactionUpdateInput = commonPayload(v);
    const parsed = transactionUpdateSchema.safeParse(payload);
    if (!parsed.success) return applyIssues(parsed.error.issues);
    if (state.transaction?.recurrenceId) {
      setPendingUpdate(payload);
      setScopeOpen(true);
      return;
    }
    await runUpdate(payload, 'one');
  }

  const onSubmit = handleSubmit((v) => (isEdit ? submitEdit(v) : submitCreate(v)));
  const tx = state.transaction;
  const paidLabel = type === 'income' ? 'Recebido' : 'Pago';
  const pendingLabel = type === 'income' ? 'A receber' : 'Pendente';
  const busy = create.isPending || update.isPending;

  const title =
    state.mode === 'edit'
      ? type === 'income'
        ? 'Editar receita'
        : 'Editar despesa'
      : 'Nova Transação';

  return (
    <>
      <Sheet
        open={state.open}
        onOpenChange={onOpenChange}
        title={title}
        description={isEdit ? 'Atualize os dados do lançamento' : 'Adicionar receita ou despesa'}
        headerExtra={
          isEdit ? null : (
            <SegmentedControl
              variant="card"
              fullWidth
              ariaLabel="Tipo de transação"
              value={type}
              onChange={(next) => {
                setValue('type', next);
                setValue('categoryId', '');
                setValue('subcategoryId', '');
                if (values.split) setValue('splits', evenSplit([newSplitRow(), newSplitRow()], values.amount ?? 0));
                setSplitErrors({ rows: {} });
                if (next === 'income' && isCard) setValue('source', '');
              }}
              options={[
                { value: 'income', label: 'Receita', activeClassName: 'bg-success text-white shadow-sm' },
                { value: 'expense', label: 'Despesa', activeClassName: 'bg-danger text-white shadow-sm' },
              ]}
            />
          )
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <WriteGate>
              <Button onClick={onSubmit} loading={busy} className="min-w-[110px]">
                Salvar
              </Button>
            </WriteGate>
          </>
        }
      >
        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            void onSubmit();
          }}
          noValidate
        >
          {isEdit && tx ? <SeriesInfo tx={tx} /> : null}
          {isEdit && tx?.splitGroupId ? (
            <div className="flex items-center gap-2 rounded-md bg-primary-soft px-3 py-2.5 text-[13px] text-primary-soft-fg">
              <Split className="size-4" />
              <span className="font-medium">Parte de um lançamento dividido entre categorias</span>
            </div>
          ) : null}

          <Field label="Valor" error={formState.errors.amount?.message}>
            <Controller
              control={control}
              name="amount"
              render={({ field }) => (
                <MoneyInput size="lg" value={field.value} onChange={field.onChange} data-autofocus aria-label="Valor" />
              )}
            />
          </Field>

          <Field label="Nome" error={formState.errors.description?.message}>
            <Input placeholder={type === 'income' ? 'Ex: Salário, Freelance, Aluguel' : 'Ex: iFood, Netflix, Uber'} maxLength={120} {...register('description')} />
          </Field>

          {!isCard ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1.5 text-[13px] font-medium text-fg">Status</legend>
              <div className="grid grid-cols-2 gap-2">
                <StatusOption
                  active={values.paid === true}
                  tone="success"
                  icon={<ThumbsUp className="size-4" />}
                  label={paidLabel}
                  onClick={() => {
                    setValue('paid', true);
                    if (!values.paidAt) setValue('paidAt', values.date && values.date < todayISO() ? values.date : todayISO());
                  }}
                />
                <StatusOption
                  active={values.paid === false}
                  tone="danger"
                  icon={<ThumbsDown className="size-4" />}
                  label={pendingLabel}
                  onClick={() => setValue('paid', false)}
                />
              </div>
            </fieldset>
          ) : null}

          <Field
            label="Conta ou Cartão"
            error={formState.errors.source?.message}
            hint={isCard ? 'Compras no cartão entram na fatura e são quitadas ao pagá-la.' : undefined}
          >
            <Select
              {...register('source', {
                onChange: (e) => {
                  if (String(e.target.value).startsWith('card:')) setValue('paymentMethod', 'credit_card');
                },
              })}
            >
              <option value="">Sem conta vinculada</option>
              {activeAccounts.length ? (
                <optgroup label="Contas">
                  {activeAccounts.map((a) => (
                    <option key={a.id} value={`account:${a.id}`}>
                      {a.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {type === 'expense' && activeCards.length ? (
                <optgroup label="Cartões de crédito">
                  {activeCards.map((c) => (
                    <option key={c.id} value={`card:${c.id}`}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </Select>
          </Field>

          {values.split ? (
            <>
              <Field label={isCard ? 'Data da compra' : values.paid ? 'Data' : 'Vencimento'} error={formState.errors.date?.message}>
                <Input type="date" {...register('date')} />
              </Field>
              <SplitEditor
                type={type}
                total={values.amount ?? 0}
                rows={values.splits ?? []}
                onChange={(rows) => setValue('splits', rows)}
                onCancel={cancelSplit}
                rowErrors={splitErrors.rows}
                error={splitErrors.summary}
              />
            </>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Field
                label="Categoria"
                error={formState.errors.categoryId?.message ?? formState.errors.subcategoryId?.message}
                aside={
                  isEdit ? null : (
                    <button type="button" onClick={startSplit} className="flex items-center gap-1 text-xs font-semibold text-brand-text hover:underline">
                      <Split className="size-3.5" /> Dividir
                    </button>
                  )
                }
              >
                <CategoryPicker
                  type={type}
                  value={{ categoryId: values.categoryId ?? '', subcategoryId: values.subcategoryId ?? '' }}
                  onChange={(v) => {
                    setValue('categoryId', v.categoryId);
                    setValue('subcategoryId', v.subcategoryId);
                  }}
                />
              </Field>
              <Field label={isCard ? 'Data da compra' : values.paid ? 'Data' : 'Vencimento'} error={formState.errors.date?.message}>
                <Input type="date" {...register('date')} />
              </Field>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Forma de pagamento">
              <Select {...register('paymentMethod')} disabled={isCard}>
                <option value="">Não informada</option>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_METHOD_LABELS[m]}
                  </option>
                ))}
              </Select>
            </Field>
            {values.paid && !isCard ? (
              <Field label={type === 'income' ? 'Recebido em' : 'Pago em'} error={formState.errors.paidAt?.message}>
                <Input type="date" {...register('paidAt')} />
              </Field>
            ) : (
              <Field label="Contato" hint="Opcional">
                <Select {...register('contactId')}>
                  <option value="">Nenhum</option>
                  {(contacts.data?.items ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>

          {values.paid && !isCard ? (
            <Field label="Contato" hint="Opcional">
              <Select {...register('contactId')}>
                <option value="">Nenhum</option>
                {(contacts.data?.items ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}

          {!isEdit ? (
            <div className="flex flex-col gap-4 border-t border-border pt-4">
              <label className="flex cursor-pointer items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-sm font-semibold text-brand-text">
                  <Repeat className="size-4" /> Repetir
                </span>
                <Controller
                  control={control}
                  name="repeat"
                  render={({ field }) => (
                    <Switch checked={field.value} onCheckedChange={field.onChange} aria-label="Repetir lançamento" />
                  )}
                />
              </label>

              {values.repeat ? (
                <div className="flex animate-fade-in flex-col gap-4 rounded-lg bg-surface-muted p-4">
                  <Controller
                    control={control}
                    name="recurrenceKind"
                    render={({ field }) => (
                      <SegmentedControl
                        fullWidth
                        ariaLabel="Tipo de repetição"
                        value={field.value}
                        onChange={field.onChange}
                        options={[
                          { value: 'installment', label: 'Parcelado', icon: <Layers /> },
                          { value: 'recurring', label: 'Recorrente', icon: <Repeat /> },
                        ]}
                      />
                    )}
                  />

                  {values.recurrenceKind === 'installment' ? (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Parcelas" error={formState.errors.installments?.message}>
                          <Input type="number" min={2} max={360} inputMode="numeric" {...register('installments')} />
                        </Field>
                        <Field label="Frequência">
                          <Select {...register('frequency')}>
                            {FREQUENCIES.map((f) => (
                              <option key={f} value={f}>
                                {FREQUENCY_LABELS[f]}
                              </option>
                            ))}
                          </Select>
                        </Field>
                      </div>
                      <Controller
                        control={control}
                        name="installmentAmountMode"
                        render={({ field }) => (
                          <div className="flex flex-col gap-1.5">
                            <span className="text-[13px] font-medium">O valor informado é</span>
                            <SegmentedControl
                              fullWidth
                              size="sm"
                              value={field.value}
                              onChange={field.onChange}
                              options={[
                                { value: 'total', label: 'Valor total' },
                                { value: 'per_installment', label: 'Valor da parcela' },
                              ]}
                            />
                          </div>
                        )}
                      />
                      {installmentPreview ? (
                        <p className="rounded-md bg-primary-soft px-3 py-2 text-[13px] font-semibold text-primary-soft-fg">
                          {installmentPreview}
                        </p>
                      ) : null}
                    </>
                  ) : null}

                  {values.recurrenceKind === 'recurring' ? (
                    <>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Frequência">
                        <Select {...register('frequency')}>
                          {FREQUENCIES.map((f) => (
                            <option key={f} value={f}>
                              {FREQUENCY_LABELS[f]}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Quantidade" hint="Vazio ou 0 = sem fim" error={formState.errors.occurrences?.message}>
                        <Input type="number" min={0} max={360} inputMode="numeric" placeholder="Sem fim" {...register('occurrences')} />
                      </Field>
                    </div>
                    {!(Number(values.occurrences) > 0) ? (
                      <p className="flex items-start gap-2 text-[13px] leading-relaxed text-muted">
                        <InfinityIcon className="mt-0.5 size-4 shrink-0 text-brand-text" />
                        Sem quantidade, o lançamento é fixo: repete sem data de término e aparece nos relatórios e
                        projeções. Para encerrar, exclua a partir do mês desejado.
                      </p>
                    ) : null}
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          <Field label="Observações" error={formState.errors.notes?.message}>
            <Textarea placeholder="Detalhes, número do boleto, etc." maxLength={1000} {...register('notes')} />
          </Field>
          <button type="submit" hidden />
        </form>
      </Sheet>

      <ScopeDialog
        open={scopeOpen}
        onOpenChange={setScopeOpen}
        action="edit"
        kind={state.transaction?.recurrenceKind}
        loading={update.isPending}
        onConfirm={(scope) => pendingUpdate && void runUpdate(pendingUpdate, scope)}
      />
    </>
  );
}

function StatusOption({
  active,
  tone,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  tone: 'success' | 'danger';
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        'flex h-11 items-center justify-center gap-2 rounded-md border text-sm font-semibold transition-all',
        active
          ? tone === 'success'
            ? 'border-success/30 bg-success-soft text-success'
            : 'border-danger/30 bg-danger-soft text-danger'
          : 'border-border text-muted hover:border-border-strong hover:text-fg',
      )}
    >
      <span className={cn(active && 'animate-pop')}>{icon}</span>
      {label}
    </button>
  );
}

function SeriesInfo({ tx }: { tx: Transaction }) {
  if (tx.recurrenceKind === 'single') return null;
  const detail =
    tx.recurrenceKind === 'installment'
      ? `Parcela ${tx.installmentNumber}/${tx.installmentTotal}`
      : tx.recurrenceKind === 'fixed'
        ? `Repete ${tx.frequency && tx.frequency !== 'monthly' ? FREQUENCY_LABELS[tx.frequency].toLowerCase() : 'todo mês'}, sem fim`
        : `${tx.frequency ? FREQUENCY_LABELS[tx.frequency] : ''}${tx.occurrenceNumber ? ` · ocorrência ${tx.occurrenceNumber}` : ''}`;
  return (
    <div className="flex items-center gap-2 rounded-md bg-primary-soft px-3 py-2.5 text-[13px] text-primary-soft-fg">
      <Repeat className="size-4" />
      <Badge tone="solid">{RECURRENCE_KIND_LABELS[tx.recurrenceKind]}</Badge>
      <span className="font-medium">{detail}</span>
    </div>
  );
}
