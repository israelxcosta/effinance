import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { formatBRL, formatMonthKey, todayISO, type CreditCard, type InvoiceSummary } from '@effinance/shared';
import { Modal } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useAccounts } from '@/features/accounts/api';
import { usePayInvoice } from './api';
import { toastError } from '@/lib/notify';
import { WriteGate } from '@/features/auth/permissions';

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  card: Pick<CreditCard, 'id' | 'name'> & { defaultAccountId?: string | null };
  invoice: InvoiceSummary;
}

export function PayInvoiceDialog({ open, onOpenChange, card, invoice }: Props) {
  const accounts = useAccounts();
  const pay = usePayInvoice();
  const [accountId, setAccountId] = useState(card.defaultAccountId ?? '');
  const [date, setDate] = useState(todayISO());

  useEffect(() => {
    if (open) {
      setAccountId(card.defaultAccountId ?? '');
      setDate(todayISO());
    }
  }, [open, card.defaultAccountId]);

  const selected = accounts.data?.find((a) => a.id === accountId);

  async function confirm() {
    if (!accountId) {
      toast.error('Selecione a conta de pagamento');
      return;
    }
    try {
      await pay.mutateAsync({ cardId: card.id, month: invoice.month, input: { accountId, date } });
      toast.success('Fatura paga 👍');
      onOpenChange(false);
    } catch (error) {
      toastError(error);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Pagar fatura"
      description={`${card.name} · fatura de ${formatMonthKey(invoice.month)}`}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <WriteGate>
            <Button onClick={confirm} loading={pay.isPending}>Confirmar pagamento</Button>
          </WriteGate>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="rounded-lg bg-primary-soft p-4 text-center">
          <p className="text-xs font-medium text-primary-soft-fg/80">Valor da fatura</p>
          <p className="tabular mt-1 text-[26px] font-semibold text-primary-soft-fg">{formatBRL(invoice.unpaidTotal)}</p>
        </div>
        <Field label="Pagar com" hint={selected ? `Saldo atual: ${formatBRL(selected.balance)}` : undefined}>
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">Selecione a conta</option>
            {(accounts.data ?? []).filter((a) => !a.archived).map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Data do pagamento">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
