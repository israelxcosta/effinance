import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  ASSET_TYPES,
  ASSET_TYPE_LABELS,
  formatBRL,
  investmentPurchaseInputSchema,
  positionAfterPurchase,
  purchaseTotal,
  todayISO,
  type AssetType,
  type InvestmentPosition,
  type InvestmentPurchase,
} from '@effinance/shared';
import { Sheet } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { MoneyInput } from '@/components/ui/money-input';
import { DateInput } from '@/components/ui/date-input';
import { useAccounts } from '@/features/accounts/api';
import { WriteGate } from '@/features/auth/permissions';
import { toastError } from '@/lib/notify';
import { cn } from '@/lib/utils';
import { formatQuantity, parseQuantity, useSavePurchase } from './api';

export interface PurchaseSheetState {
  open: boolean;
  /** Editing an existing purchase. */
  purchase?: InvestmentPurchase | null;
  /** New purchase of an asset already in the portfolio ("Comprar mais"). */
  ticker?: string;
}

interface Props {
  state: PurchaseSheetState;
  onOpenChange: (open: boolean) => void;
  positions: InvestmentPosition[];
  purchases: InvestmentPurchase[];
}

type Errors = Partial<Record<'ticker' | 'quantity' | 'unitPrice' | 'date' | 'accountId', string>>;

export function PurchaseSheet({ state, onOpenChange, positions, purchases }: Props) {
  const accounts = useAccounts();
  const save = useSavePurchase();
  const editing = state.purchase ?? null;
  const [assetType, setAssetType] = useState<AssetType>('stock');
  const [ticker, setTicker] = useState('');
  const [name, setName] = useState('');
  const [accountId, setAccountId] = useState('');
  const [date, setDate] = useState(todayISO());
  const [quantityText, setQuantityText] = useState('');
  const [unitPrice, setUnitPrice] = useState(0);
  const [fees, setFees] = useState(0);
  const [errors, setErrors] = useState<Errors>({});

  useEffect(() => {
    if (!state.open) return;
    const known = state.ticker ? positions.find((p) => p.ticker === state.ticker) : undefined;
    const last = state.ticker ? purchases.find((p) => p.ticker === state.ticker) : undefined;
    setAssetType(editing?.assetType ?? known?.assetType ?? 'stock');
    setTicker(editing?.ticker ?? state.ticker ?? '');
    setName(editing?.name ?? known?.name ?? '');
    setAccountId(editing?.accountId ?? last?.accountId ?? '');
    setDate(editing?.date ?? todayISO());
    setQuantityText(editing ? formatQuantity(editing.quantity) : '');
    setUnitPrice(editing?.unitPrice ?? 0);
    setFees(editing?.fees ?? 0);
    setErrors({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.open, editing, state.ticker]);

  const brokers = (accounts.data ?? []).filter((a) => a.type === 'investment' && (!a.archived || a.id === editing?.accountId));
  const normalizedTicker = ticker.trim().toUpperCase().replace(/\s+/g, ' ');
  const quantity = parseQuantity(quantityText);
  const validQuantity = Number.isFinite(quantity) && quantity > 0;
  const total = validQuantity && unitPrice > 0 ? purchaseTotal(quantity, unitPrice, fees) : 0;

  // The position of this asset without the purchase being edited, then with the new numbers.
  const before = useMemo(() => {
    const pos = positions.find((p) => p.ticker === normalizedTicker);
    if (!pos) return null;
    if (editing && editing.ticker === normalizedTicker) {
      const quantityLeft = Math.round((pos.quantity - editing.quantity) * 1e8) / 1e8;
      return quantityLeft > 0 ? { quantity: quantityLeft, totalInvested: pos.totalInvested - editing.total } : null;
    }
    return { quantity: pos.quantity, totalInvested: pos.totalInvested };
  }, [positions, normalizedTicker, editing]);
  const after = total > 0 ? positionAfterPurchase(before, quantity, unitPrice, fees) : null;

  // Suggestions: assets already in the portfolio.
  const suggestions = positions.filter((p) => !normalizedTicker || p.ticker.startsWith(normalizedTicker)).slice(0, 6);

  function pickExisting(p: InvestmentPosition) {
    setTicker(p.ticker);
    setAssetType(p.assetType);
    if (!name) setName(p.name ?? '');
  }

  async function submit() {
    const parsed = investmentPurchaseInputSchema.safeParse({
      assetType,
      ticker,
      name: name || null,
      accountId: accountId || null,
      date,
      quantity: validQuantity ? quantity : 0,
      unitPrice,
      fees,
    });
    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0]) as keyof Errors;
        next[key] ??= key === 'unitPrice' ? 'Informe o preço pago por unidade' : issue.message;
      }
      setErrors(next);
      return;
    }
    try {
      await save.mutateAsync({ id: editing?.id, input: parsed.data });
      toast.success(editing ? 'Compra atualizada' : `Compra de ${parsed.data.ticker} registrada`);
      onOpenChange(false);
    } catch (error) {
      toastError(error);
    }
  }

  return (
    <Sheet
      open={state.open}
      onOpenChange={onOpenChange}
      title={editing ? 'Editar compra' : 'Nova compra'}
      description="O preço médio de cada ativo é calculado com todas as compras (taxas incluídas)."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <WriteGate>
            <Button onClick={submit} loading={save.isPending} className="min-w-[110px]">
              Salvar
            </Button>
          </WriteGate>
        </>
      }
    >
      <form
        className="flex flex-col gap-5"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="Ativo" error={errors.ticker} hint={errors.ticker ? undefined : 'Ticker ou código, ex.: PETR4, HGLG11, BTC'}>
            <Input
              value={ticker}
              onChange={(e) => setTicker(e.target.value)}
              placeholder="PETR4"
              maxLength={30}
              autoCapitalize="characters"
              autoComplete="off"
              className="uppercase placeholder:normal-case"
            />
          </Field>
          <Field label="Tipo">
            <Select value={assetType} onChange={(e) => setAssetType(e.target.value as AssetType)}>
              {ASSET_TYPES.map((t) => (
                <option key={t} value={t}>
                  {ASSET_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {suggestions.length && !editing && !positions.some((p) => p.ticker === normalizedTicker) ? (
          <div className="-mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted">Na carteira:</span>
            {suggestions.map((p) => (
              <button
                key={p.ticker}
                type="button"
                onClick={() => pickExisting(p)}
                className="rounded-full border border-border bg-surface px-2.5 py-1 text-xs font-semibold text-fg transition-colors hover:border-border-strong hover:bg-bg-subtle"
              >
                {p.ticker}
              </button>
            ))}
          </div>
        ) : null}

        <Field label="Nome" hint="Opcional, ex.: Petrobras PN">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Petrobras PN" />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Data da compra" error={errors.date}>
            <DateInput value={date} onChange={(e) => setDate(e.target.value)} max={todayISO()} />
          </Field>
          <Field label="Corretora" error={errors.accountId} hint={brokers.length ? 'Opcional' : 'Cadastre uma conta do tipo Investimento'}>
            <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">Não informada</option>
              {brokers.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Quantidade" error={errors.quantity}>
            <Input
              value={quantityText}
              onChange={(e) => setQuantityText(e.target.value.replace(/[^\d.,]/g, ''))}
              inputMode="decimal"
              placeholder="100"
              className="tabular text-right"
            />
          </Field>
          <Field label="Preço por unidade" error={errors.unitPrice}>
            <MoneyInput value={unitPrice} onChange={setUnitPrice} />
          </Field>
        </div>

        <Field label="Taxas e emolumentos" hint="Corretagem, B3 e impostos da nota (entram no preço médio)">
          <MoneyInput value={fees} onChange={setFees} />
        </Field>

        <div className="flex flex-col gap-3 rounded-xl bg-surface-muted p-4">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-label font-medium text-muted">Total da compra</span>
            <span className="tabular text-lg font-semibold text-fg">{formatBRL(total)}</span>
          </div>
          {after ? (
            <div className={cn('grid gap-2 border-t border-border pt-3 text-label', before ? 'grid-cols-2' : 'grid-cols-1')}>
              {before ? (
                <div>
                  <p className="text-xs text-muted">Antes</p>
                  <p className="tabular font-medium text-fg">
                    {formatQuantity(before.quantity)} × {formatBRL(Math.round(before.totalInvested / before.quantity))}
                  </p>
                </div>
              ) : null}
              <div className={before ? 'text-right' : ''}>
                <p className="text-xs text-muted">{before ? 'Depois desta compra' : 'Preço médio'}</p>
                <p className="tabular font-semibold text-brand-text">
                  {formatQuantity(after.quantity)} × {formatBRL(after.averagePrice)}
                </p>
              </div>
            </div>
          ) : null}
        </div>
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}
