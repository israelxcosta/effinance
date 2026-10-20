import { CreditCard, Copy, Ellipsis, Pencil, ThumbsDown, ThumbsUp, Trash2 } from 'lucide-react';
import {
  FREQUENCY_LABELS,
  TRANSFER_KIND_LABELS,
  diffInDays,
  formatDateBR,
  formatMonthKey,
  todayISO,
  type Transaction,
} from '@effinance/shared';
import { Badge } from '@/components/ui/badge';
import { BankLogo } from '@/components/ui/bank-logo';
import { CategoryIcon } from '@/components/ui/category-icon';
import { Money } from '@/components/ui/misc';
import { PaidToggle } from '@/components/ui/paid-toggle';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useTransactionActions } from '../transaction-actions';

export function SeriesBadge({ tx }: { tx: Transaction }) {
  if (tx.recurrenceKind === 'installment' && tx.installmentNumber)
    return (
      <Badge tone="brand" title="Parcela">
        {tx.installmentNumber}/{tx.installmentTotal}
      </Badge>
    );
  if (tx.recurrenceKind === 'fixed') return <Badge tone="brand">Fixa</Badge>;
  if (tx.recurrenceKind === 'recurring')
    return <Badge tone="neutral">{tx.frequency ? FREQUENCY_LABELS[tx.frequency] : 'Recorrente'}</Badge>;
  return null;
}

export function DueLabel({ tx }: { tx: Transaction }) {
  if (tx.creditCardId && tx.type !== 'transfer') {
    return (
      <span className="text-xs text-muted">
        {tx.paid ? 'Fatura paga' : tx.invoiceMonth ? `Fatura ${formatMonthKey(tx.invoiceMonth, 'short')}` : 'No cartão'}
      </span>
    );
  }
  if (tx.paid) {
    return <span className="text-xs text-muted">{tx.paidAt ? `Pago em ${formatDateBR(tx.paidAt)}` : formatDateBR(tx.date)}</span>;
  }
  const days = diffInDays(tx.date, todayISO());
  if (tx.overdue || days < 0)
    return <span className="text-xs font-semibold text-danger">Venceu há {Math.abs(days)} {Math.abs(days) === 1 ? 'dia' : 'dias'}</span>;
  if (days === 0) return <span className="text-xs font-semibold text-warning">Vence hoje</span>;
  if (days <= 5) return <span className="text-xs font-medium text-warning">Vence em {days} {days === 1 ? 'dia' : 'dias'}</span>;
  return <span className="text-xs text-muted">Vence em {formatDateBR(tx.date)}</span>;
}

export function TxIcon({ tx, size = 'md' }: { tx: Transaction; size?: 'sm' | 'md' }) {
  if (tx.type === 'transfer') {
    return <CategoryIcon icon={tx.transferKind === 'investment' || tx.transferKind === 'redemption' ? 'trending-up' : tx.transferKind === 'card_payment' ? 'credit-card' : 'landmark'} color="#3F64BE" size={size} />;
  }
  return <CategoryIcon icon={tx.subcategory?.icon ?? tx.category?.icon ?? 'tag'} color={tx.category?.color ?? '#9A9EA5'} size={size} />;
}

export function SourceLabel({ tx }: { tx: Transaction }) {
  if (tx.creditCard) {
    return (
      <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
        <BankLogo bank={tx.creditCard.bank} size="xs" />
        <span className="truncate">{tx.creditCard.name}</span>
        {tx.invoiceMonth ? <span className="shrink-0 text-subtle">· fatura {formatMonthKey(tx.invoiceMonth, 'short')}</span> : null}
      </span>
    );
  }
  if (tx.type === 'transfer') {
    return (
      <span className="truncate text-xs text-muted">
        {tx.account?.name ?? '—'} → {tx.toAccount?.name ?? '—'}
      </span>
    );
  }
  if (tx.account) {
    return (
      <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
        <BankLogo bank={tx.account.bank} color={tx.account.color} size="xs" />
        <span className="truncate">{tx.account.name}</span>
      </span>
    );
  }
  return <span className="text-xs text-subtle">Sem conta</span>;
}

interface TransactionRowProps {
  tx: Transaction;
  /** Signed amount to show instead of tx.amount (statement). */
  amount?: number;
  trailing?: React.ReactNode;
  showDue?: boolean;
  muted?: boolean;
}

/** Responsive list row used across lists (payables, receivables, dashboard, statement). */
export function TransactionRow({ tx, amount, trailing, showDue = true, muted }: TransactionRowProps) {
  const actions = useTransactionActions();
  const signed = amount ?? (tx.type === 'expense' ? -tx.amount : tx.amount);
  const isCardPurchase = Boolean(tx.creditCardId) && tx.type !== 'transfer';
  return (
    <div className="@container">
    <div
      className={cn(
        'group flex items-center gap-3 rounded-lg px-3 py-3 transition-colors hover:bg-surface-muted @lg:px-4',
        muted && 'opacity-70',
      )}
    >
      {tx.type !== 'transfer' ? (
        isCardPurchase ? (
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-bg-subtle text-muted" title="Quitado ao pagar a fatura">
            <CreditCard className="size-4" />
          </span>
        ) : (
          <PaidToggle
            paid={tx.paid}
            kind={tx.type}
            loading={actions.savingPaidId === tx.id}
            onToggle={(paid) => actions.togglePaid(tx, paid)}
          />
        )
      ) : (
        <PaidToggle paid={tx.paid} kind="transfer" disabled disabledReason={tx.paid ? 'Efetivada' : 'Agendada'} onToggle={() => undefined} />
      )}
      <button type="button" onClick={() => actions.edit(tx)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <TxIcon tx={tx} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-fg">{tx.description}</span>
            <SeriesBadge tx={tx} />
            {tx.splitGroupId ? <Badge tone="neutral" title="Valor dividido entre categorias">Dividido</Badge> : null}
            {tx.type === 'transfer' && tx.transferKind ? <Badge tone="brand">{TRANSFER_KIND_LABELS[tx.transferKind]}</Badge> : null}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
            {tx.category ? (
              <span className="truncate">
                {tx.category.name}
                {tx.subcategory ? ` · ${tx.subcategory.name}` : ''}
              </span>
            ) : null}
            {tx.contact ? <span className="truncate">· {tx.contact.name}</span> : null}
            {showDue ? (
              <span className="@xl:hidden">
                · <DueLabel tx={tx} />
              </span>
            ) : null}
          </span>
        </span>
      </button>
      <div className="hidden w-44 min-w-0 @3xl:block">
        <SourceLabel tx={tx} />
      </div>
      {showDue ? (
        <div className="hidden w-36 text-right @xl:block">
          <p className="text-[13px] font-medium text-fg tabular">{formatDateBR(tx.date)}</p>
          <DueLabel tx={tx} />
        </div>
      ) : null}
      <div className="w-28 shrink-0 text-right @lg:w-32">
        <Money value={signed} tone={tx.type === 'transfer' && amount === undefined ? 'neutral' : undefined} signed className="text-[15px]" />
        {trailing}
      </div>
      <RowMenu tx={tx} />
    </div>
    </div>
  );
}

export function RowMenu({ tx }: { tx: Transaction }) {
  const actions = useTransactionActions();
  const isCardPurchase = Boolean(tx.creditCardId) && tx.type !== 'transfer';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted opacity-70 transition hover:bg-bg-subtle hover:text-fg group-hover:opacity-100"
          aria-label={`Ações de ${tx.description}`}
        >
          <Ellipsis className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem icon={<Pencil />} onSelect={() => actions.edit(tx)}>
          Editar
        </DropdownMenuItem>
        {tx.type !== 'transfer' ? (
          <DropdownMenuItem icon={<Copy />} onSelect={() => actions.duplicate(tx)}>
            Duplicar
          </DropdownMenuItem>
        ) : null}
        {tx.type !== 'transfer' && !isCardPurchase ? (
          <DropdownMenuItem
            icon={tx.paid ? <ThumbsDown /> : <ThumbsUp />}
            onSelect={() => actions.togglePaid(tx, !tx.paid)}
          >
            {tx.paid
              ? tx.type === 'income'
                ? 'Marcar como a receber'
                : 'Marcar como pendente'
              : tx.type === 'income'
                ? 'Marcar como recebido'
                : 'Marcar como pago'}
          </DropdownMenuItem>
        ) : null}
        {tx.transferKind !== 'card_payment' ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem icon={<Trash2 />} tone="danger" onSelect={() => actions.remove(tx)}>
              Excluir
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
