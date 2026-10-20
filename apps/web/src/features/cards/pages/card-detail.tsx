import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowLeft, ChevronLeft, ChevronRight, CreditCard as CardIcon, Pencil, Plus } from 'lucide-react';
import {
  CARD_BRAND_LABELS,
  INVOICE_STATUS_LABELS,
  addMonthKey,
  formatBRL,
  formatDateBR,
  formatMonthKey,
  type InvoiceSummary,
} from '@effinance/shared';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState, MiniStat } from '@/components/ui/misc';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Skeleton, SkeletonRows } from '@/components/ui/skeleton';
import { axisProps, moneyAxisFormatter, MoneyTooltip, StripeDefs } from '@/components/charts/chart-utils';
import { useTransactionActions } from '@/features/transactions/transaction-actions';
import { TransactionRow } from '@/features/transactions/components/transaction-row';
import { useCards, useInvoice, useInvoices } from '../api';
import { CardVisual } from '../card-visual';
import { CardSheet } from '../card-sheet';
import { PayInvoiceDialog } from '../pay-invoice-dialog';
import { INVOICE_TONE } from './cards';
import { WriteGate } from '@/features/auth/permissions';

export default function CardDetailPage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const actions = useTransactionActions();
  const cards = useCards({ includeArchived: true });
  const card = cards.data?.find((c) => c.id === id);
  const month = params.get('fatura') ?? card?.currentInvoice.month ?? '';
  const invoice = useInvoice(card ? id : undefined, month);
  const range = useMemo(() => (card ? { from: addMonthKey(card.currentInvoice.month, -5), to: addMonthKey(card.currentInvoice.month, 6) } : { from: '', to: '' }), [card]);
  const invoices = useInvoices(card ? id : undefined, range);
  const [editing, setEditing] = useState(false);
  const [paying, setPaying] = useState<InvoiceSummary | null>(null);

  if (cards.isPending) return <Skeleton className="h-96 rounded-xl" />;
  if (cards.isError) return <ErrorState error={cards.error} onRetry={() => cards.refetch()} />;
  if (!card) {
    return (
      <EmptyState
        icon={<CardIcon />}
        title="Cartão não encontrado"
        action={<Button variant="outline" asChild><Link to="/cartoes">Voltar aos cartões</Link></Button>}
      />
    );
  }

  const setMonth = (m: string) => {
    const next = new URLSearchParams(params);
    next.set('fatura', m);
    setParams(next, { replace: true });
  };
  const usage = card.limit ? card.usedLimit / card.limit : 0;
  const inv = invoice.data;
  const chartData = (invoices.data ?? []).map((i) => ({
    ...i,
    label: formatMonthKey(i.month, 'short'),
    fill: i.month === month ? 'var(--app-primary)' : i.status === 'paid' ? 'url(#stripe-success)' : 'url(#stripe-income)',
  }));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/cartoes"><ArrowLeft /> Cartões</Link>
        </Button>
        <div className="flex gap-2">
          <WriteGate>
            <Button variant="outline" onClick={() => setEditing(true)}><Pencil /> Editar</Button>
          </WriteGate>
          <WriteGate>
            <Button onClick={() => actions.openTransaction({ type: 'expense', defaults: { source: `card:${card.id}` } })}>
              <Plus /> Nova compra
            </Button>
          </WriteGate>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <Card className="flex flex-col gap-4 p-4">
          <CardVisual card={card} />
          <div className="grid grid-cols-2 gap-2 text-xs">
            <Info label="Bandeira" value={CARD_BRAND_LABELS[card.brand]} />
            <Info label="Fechamento" value={`Dia ${card.closingDay}`} />
            <Info label="Vencimento" value={`Dia ${card.dueDay}`} />
            <Info label="Limite" value={formatBRL(card.limit)} />
          </div>
          <div>
            <div className="flex justify-between text-xs text-muted">
              <span>Usado {formatBRL(card.usedLimit)}</span>
              <span>{Math.round(usage * 100)}%</span>
            </div>
            <ProgressBar value={usage} tone={usage > 0.9 ? 'danger' : usage > 0.7 ? 'warning' : 'brand'} className="mt-2" />
          </div>
        </Card>

        <Card className="p-5">
          <CardHeader title="Faturas" subtitle="Últimos meses e próximas faturas (parcelas futuras)" />
          <div className="mt-4 h-52">
            {invoices.isPending ? (
              <Skeleton className="h-full" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ left: -12, right: 4, top: 8 }}>
                  <StripeDefs />
                  <CartesianGrid vertical={false} stroke="var(--app-chart-grid)" strokeDasharray="4 4" />
                  <XAxis dataKey="label" {...axisProps} />
                  <YAxis {...axisProps} tickFormatter={moneyAxisFormatter} width={56} />
                  <Tooltip cursor={{ fill: 'var(--app-bg-subtle)' }} content={<MoneyTooltip names={{ total: 'Total da fatura' }} />} />
                  <Bar
                    dataKey="total"
                    name="total"
                    radius={[8, 8, 8, 8]}
                    maxBarSize={36}
                    onClick={(d: { payload?: { month?: string } }) => d.payload?.month && setMonth(d.payload.month)}
                    style={{ cursor: 'pointer' }}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-5">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon-sm" onClick={() => setMonth(addMonthKey(month, -1))} aria-label="Fatura anterior"><ChevronLeft /></Button>
            <div className="min-w-[170px] text-center">
              <p className="text-[15px] font-semibold">Fatura de {formatMonthKey(month)}</p>
              {inv ? <p className="text-xs text-muted">Fecha em {formatDateBR(inv.closingDate)} · vence em {formatDateBR(inv.dueDate)}</p> : null}
            </div>
            <Button variant="outline" size="icon-sm" onClick={() => setMonth(addMonthKey(month, 1))} aria-label="Próxima fatura"><ChevronRight /></Button>
          </div>
          {inv ? (
            <div className="flex items-center gap-3">
              <Badge tone={INVOICE_TONE[inv.status]} size="md">{INVOICE_STATUS_LABELS[inv.status]}</Badge>
              {inv.unpaidTotal > 0 ? <WriteGate><Button onClick={() => setPaying(inv)}>Pagar {formatBRL(inv.unpaidTotal)}</Button></WriteGate> : null}
            </div>
          ) : null}
        </div>
        {inv ? (
          <div className="grid grid-cols-2 gap-3 border-b border-border p-5 md:grid-cols-3">
            <MiniStat label="Total da fatura" value={formatBRL(inv.total)} />
            <MiniStat label="Em aberto" value={formatBRL(inv.unpaidTotal)} tone={inv.unpaidTotal ? 'danger' : 'success'} />
            <MiniStat label="Compras" value={String(inv.transactions.length)} className="col-span-2 md:col-span-1" />
          </div>
        ) : null}
        <div className="p-1.5">
          {invoice.isPending ? (
            <SkeletonRows rows={5} className="p-3" />
          ) : invoice.isError ? (
            <ErrorState error={invoice.error} onRetry={() => invoice.refetch()} className="m-3" />
          ) : inv && inv.transactions.length === 0 ? (
            <EmptyState className="m-3" icon={<CardIcon />} title="Nenhuma compra nesta fatura" description="Compras e parcelas lançadas neste cartão aparecem aqui." />
          ) : (
            <>
              {inv?.transactions.map((t) => <TransactionRow key={t.id} tx={t} showDue={false} />)}
              {inv?.payments.length ? (
                <div className="mt-2 border-t border-border pt-2">
                  <p className="eyebrow px-4 py-2 text-muted">Pagamentos</p>
                  {inv.payments.map((t) => <TransactionRow key={t.id} tx={t} amount={t.amount} showDue={false} />)}
                </div>
              ) : null}
            </>
          )}
        </div>
      </Card>

      <CardSheet open={editing} card={card} onOpenChange={setEditing} />
      {paying ? <PayInvoiceDialog open onOpenChange={(o) => !o && setPaying(null)} card={card} invoice={paying} /> : null}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-surface-muted px-3 py-2">
      <p className="text-muted">{label}</p>
      <p className="mt-0.5 font-semibold text-fg">{value}</p>
    </div>
  );
}
