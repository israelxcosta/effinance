import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  INVESTMENT_INCOME_KINDS,
  INVESTMENT_INCOME_LABELS,
  formatBRL,
  roundQuantity,
  saleCost,
  todayISO,
  type InvestmentBroker,
  type InvestmentIncomeKind,
  type InvestmentPosition,
} from '@effinance/shared';
import { Modal } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { MoneyInput } from '@/components/ui/money-input';
import { DateInput } from '@/components/ui/date-input';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { WriteGate } from '@/features/auth/permissions';
import { toastError } from '@/lib/notify';
import { cn } from '@/lib/utils';
import { formatQuantity, parseQuantity, useCreateIncome, useCreateSale } from './api';

/** Fixed income is tracked by the amount applied (no units). */
export const byValue = (x: { assetType: string }) => x.assetType === 'fixed_income';

function Footer({ onCancel, onConfirm, loading, label }: { onCancel: () => void; onConfirm: () => void; loading: boolean; label: string }) {
  return (
    <div className="mt-6 flex justify-end gap-2">
      <Button variant="ghost" onClick={onCancel}>
        Cancelar
      </Button>
      <WriteGate>
        <Button onClick={onConfirm} loading={loading} className="min-w-[110px]">
          {label}
        </Button>
      </WriteGate>
    </div>
  );
}

/** Vender: price per unit (or, for fixed income, the amount redeemed); result by the average price. */
export function SellDialog({ position, brokerName, onClose }: { position: InvestmentPosition | null; brokerName: string; onClose: () => void }) {
  const sell = useCreateSale();
  const [quantityText, setQuantityText] = useState('');
  const [unitPrice, setUnitPrice] = useState(0);
  const [fees, setFees] = useState(0);
  const [date, setDate] = useState(todayISO());
  // Fixed income: amount applied that leaves (cost) and amount received.
  const [costOut, setCostOut] = useState(0);
  const [received, setReceived] = useState(0);

  useEffect(() => {
    if (!position) return;
    setQuantityText(byValue(position) ? '' : formatQuantity(position.quantity));
    setUnitPrice(0);
    setFees(0);
    setDate(todayISO());
    setCostOut(position.totalInvested);
    setReceived(position.totalInvested);
  }, [position]);

  if (!position) return null;
  const value = byValue(position);
  const avg = position.quantity > 0 ? position.totalInvested / position.quantity : 0;
  const quantity = value
    ? costOut >= position.totalInvested
      ? position.quantity
      : roundQuantity(costOut / avg)
    : parseQuantity(quantityText);
  const validQty = Number.isFinite(quantity) && quantity > 0 && roundQuantity(quantity - position.quantity) <= 0;
  const price = value ? (quantity > 0 ? Math.max(1, Math.round(received / quantity)) : 0) : unitPrice;
  const cost = validQty ? saleCost(position, quantity) : 0;
  const proceeds = validQty && price > 0 ? (value ? received : Math.round(quantity * price)) - fees : 0;
  const result = proceeds - cost;
  const left = validQty ? roundQuantity(position.quantity - quantity) : position.quantity;
  const title = position.name && value ? position.name : position.ticker;

  async function submit() {
    if (!validQty) {
      toast.error(value ? `Informe até ${formatBRL(position!.totalInvested)}` : `Informe até ${formatQuantity(position!.quantity)}`);
      return;
    }
    if (price <= 0) {
      toast.error(value ? 'Informe o valor recebido' : 'Informe o preço de venda');
      return;
    }
    try {
      await sell.mutateAsync({ ticker: position!.ticker, date, quantity, unitPrice: price, fees });
      toast.success(result < 0 ? `Venda registrada · prejuízo de ${formatBRL(-result)}` : 'Venda registrada');
      onClose();
    } catch (error) {
      toastError(error);
    }
  }

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`Vender ${title}`} className="max-w-lg">
      <div className="flex flex-col gap-4">
        {value ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Valor aplicado que sai">
              <MoneyInput value={costOut} onChange={setCostOut} />
            </Field>
            <Field label="Valor recebido">
              <MoneyInput value={received} onChange={setReceived} />
            </Field>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Quantidade">
              <Input
                value={quantityText}
                onChange={(e) => setQuantityText(e.target.value.replace(/[^\d.,]/g, ''))}
                inputMode="decimal"
                className="tabular text-right"
              />
            </Field>
            <Field label="Preço de venda">
              <MoneyInput value={unitPrice} onChange={setUnitPrice} />
            </Field>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Data">
            <DateInput value={date} onChange={(e) => setDate(e.target.value)} max={todayISO()} />
          </Field>
          <Field label="Taxas">
            <MoneyInput value={fees} onChange={setFees} />
          </Field>
        </div>
        <div className="flex flex-col gap-2 rounded-xl bg-surface-muted p-4 text-label">
          <div className="flex justify-between">
            <span className="text-muted">Valor da venda</span>
            <span className="tabular font-medium">{formatBRL(Math.max(0, proceeds))}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">{value ? 'Custo' : `Custo (${formatQuantity(validQty ? quantity : 0)} × ${formatBRL(position.averagePrice)})`}</span>
            <span className="tabular font-medium">{formatBRL(cost)}</span>
          </div>
          <div className="flex items-baseline justify-between border-t border-border pt-2">
            <span className="font-semibold">{result < 0 ? 'Prejuízo' : 'Lucro'}</span>
            <span className={cn('tabular text-lg font-semibold', result < 0 ? 'text-danger' : result > 0 ? 'text-success' : 'text-fg')}>
              {result < 0 ? '−' : ''}
              {formatBRL(Math.abs(result))}
            </span>
          </div>
          <p className="text-xs text-muted">
            Fica na {brokerName}
            {left > 0 ? ` · restam ${value ? formatBRL(position.totalInvested - cost) : `${formatQuantity(left)} × ${formatBRL(position.averagePrice)}`}` : ''}
          </p>
        </div>
      </div>
      <Footer onCancel={onClose} onConfirm={submit} loading={sell.isPending} label="Registrar venda" />
    </Modal>
  );
}

export interface IncomeDialogState {
  open: boolean;
  ticker?: string;
}

/** Lançar provento: dividends, JCP, interest or yield received at a broker. */
export function IncomeDialog({
  state,
  onClose,
  positions,
  brokers,
  brokerOf,
}: {
  state: IncomeDialogState;
  onClose: () => void;
  positions: InvestmentPosition[];
  brokers: InvestmentBroker[];
  /** Broker of an asset (latest purchase). */
  brokerOf: (ticker: string) => string | null;
}) {
  const create = useCreateIncome();
  const [kind, setKind] = useState<InvestmentIncomeKind>('dividend');
  const [ticker, setTicker] = useState('');
  const [amount, setAmount] = useState(0);
  const [date, setDate] = useState(todayISO());
  const [accountId, setAccountId] = useState('');

  useEffect(() => {
    if (!state.open) return;
    const t = state.ticker ?? positions[0]?.ticker ?? '';
    setTicker(t);
    setKind(positions.find((p) => p.ticker === t && byValue(p)) ? 'interest' : 'dividend');
    setAmount(0);
    setDate(todayISO());
    setAccountId((t && brokerOf(t)) || brokers[0]?.id || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.open, state.ticker]);

  async function submit() {
    if (amount <= 0) {
      toast.error('Informe o valor recebido');
      return;
    }
    try {
      await create.mutateAsync({ kind, ticker: ticker || null, amount, date, accountId: accountId || null });
      toast.success(`${INVESTMENT_INCOME_LABELS[kind]} lançado`);
      onClose();
    } catch (error) {
      toastError(error);
    }
  }

  return (
    <Modal open={state.open} onOpenChange={(o) => !o && onClose()} title="Lançar provento" className="max-w-lg">
      <div className="flex flex-col gap-4">
        <Field label="Tipo">
          <SegmentedControl
            fullWidth
            value={kind}
            onChange={setKind}
            options={INVESTMENT_INCOME_KINDS.map((k) => ({ value: k, label: INVESTMENT_INCOME_LABELS[k] }))}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Ativo">
            <Select
              value={ticker}
              onChange={(e) => {
                setTicker(e.target.value);
                const b = e.target.value ? brokerOf(e.target.value) : null;
                if (b) setAccountId(b);
              }}
            >
              {positions.map((p) => (
                <option key={p.ticker} value={p.ticker}>
                  {p.name && byValue(p) ? p.name : p.ticker}
                </option>
              ))}
              <option value="">Nenhum</option>
            </Select>
          </Field>
          <Field label="Valor recebido">
            <MoneyInput value={amount} onChange={setAmount} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Data">
            <DateInput value={date} onChange={(e) => setDate(e.target.value)} max={todayISO()} />
          </Field>
          <Field label="Recebido em">
            <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {brokers.length ? null : <option value="">Carteira</option>}
              {brokers.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </div>
      <Footer onCancel={onClose} onConfirm={submit} loading={create.isPending} label="Lançar" />
    </Modal>
  );
}
