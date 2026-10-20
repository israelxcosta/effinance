import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { ChevronLeft, ChevronRight, Plus, Receipt, Search, HandCoins, X } from 'lucide-react';
import { formatBRL, todayISO, type TransactionStatus } from '@effinance/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState, MiniStat, PageHeader } from '@/components/ui/misc';
import { Input } from '@/components/ui/input';
import { PeriodNavigator } from '@/components/ui/period-navigator';
import { useScreenPeriod } from '@/lib/active-month';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Select } from '@/components/ui/select';
import { SkeletonRows } from '@/components/ui/skeleton';
import { periodRange } from '@/lib/period';
import { useAccounts } from '@/features/accounts/api';
import { useCards } from '@/features/cards/api';
import { useCategories } from '@/features/categories/api';
import { useContactOptions } from '@/features/contacts/api';
import { useTransactions } from '../api';
import { useTransactionActions } from '../transaction-actions';
import { TransactionRow } from './transaction-row';
import { WriteGate } from '@/features/auth/permissions';

const PAGE_SIZE = 50;

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function TransactionListPage({ type }: { type: 'expense' | 'income' }) {
  const [params, setParams] = useSearchParams();
  const actions = useTransactionActions();
  const isExpense = type === 'expense';

  const status = (params.get('status') as TransactionStatus) || 'all';
  const categoryId = params.get('categoria') ?? '';
  const contactId = params.get('contato') ?? '';
  const source = params.get('origem') ?? '';
  const page = Number(params.get('pagina') ?? '1') || 1;
  const [searchInput, setSearchInput] = useState(params.get('busca') ?? '');
  const search = useDebounced(searchInput.trim());

  function update(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    if (!('pagina' in patch)) next.delete('pagina');
    setParams(next, { replace: true });
  }
  const { period, setPeriod } = useScreenPeriod(params, update);

  useEffect(() => {
    if ((params.get('busca') ?? '') !== search) update({ busca: search || null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const range = periodRange(period);
  const [sourceKind, sourceId] = source.split(':');
  const query = useMemo(
    () => ({
      type,
      status,
      // "Vencidos" shows everything overdue up to today, regardless of period.
      from: status === 'overdue' ? undefined : range.from,
      to: status === 'overdue' ? todayISO() : range.to,
      categoryId: categoryId || undefined,
      contactId: contactId || undefined,
      accountId: sourceKind === 'account' ? sourceId : undefined,
      creditCardId: sourceKind === 'card' ? sourceId : undefined,
      search: search || undefined,
      page,
      pageSize: PAGE_SIZE,
      sort: 'date_asc' as const,
    }),
    [type, status, range.from, range.to, categoryId, contactId, sourceKind, sourceId, search, page],
  );
  const list = useTransactions(query);

  const categories = useCategories({ type });
  const contacts = useContactOptions();
  const accounts = useAccounts();
  const cards = useCards();

  const summary = list.data?.summary;
  const hasFilters = Boolean(categoryId || contactId || source || search);
  const totalPages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;

  const labels = isExpense
    ? { title: 'Contas a pagar', paid: 'Pago', pending: 'A pagar', new: 'Nova despesa', empty: 'Nenhuma conta a pagar neste período' }
    : { title: 'Contas a receber', paid: 'Recebido', pending: 'A receber', new: 'Nova receita', empty: 'Nenhuma conta a receber neste período' };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        overline={isExpense ? 'Despesas' : 'Receitas'}
        title={labels.title}
        description={
          isExpense
            ? 'Controle vencimentos, parcelas e despesas fixas. Marque 👍 quando pagar.'
            : 'Acompanhe recebimentos previstos, parcelas e receitas fixas. Marque 👍 quando receber.'
        }
        actions={
          <WriteGate>
            <Button onClick={() => actions.openTransaction({ type })}>
              <Plus /> {labels.new}
            </Button>
          </WriteGate>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniStat label="Total no período" value={summary ? formatBRL(summary.total) : '—'} hint={summary ? `${summary.count} lançamentos` : undefined} />
        <MiniStat label={labels.paid} value={summary ? formatBRL(summary.paid) : '—'} tone="success" />
        <MiniStat label={labels.pending} value={summary ? formatBRL(summary.pending) : '—'} tone="warning" />
        <MiniStat
          label="Vencido"
          value={summary ? formatBRL(summary.overdue) : '—'}
          tone="danger"
          hint={summary?.overdueCount ? `${summary.overdueCount} em atraso` : 'Nada em atraso'}
        />
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {status === 'overdue' ? (
            <p className="text-sm font-semibold text-danger">Todas as vencidas até hoje</p>
          ) : (
            <PeriodNavigator
              value={period}
              modes={['day', 'week', 'month', 'year']}
              onChange={setPeriod}
            />
          )}
          <SegmentedControl
            ariaLabel="Status"
            value={status}
            onChange={(s) => update({ status: s === 'all' ? null : s })}
            options={[
              { value: 'all', label: 'Todos' },
              { value: 'pending', label: labels.pending },
              { value: 'paid', label: labels.paid },
              { value: 'overdue', label: 'Vencidos' },
            ]}
          />
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Buscar descrição ou observação"
              className="h-9 rounded-[10px] pl-9 text-[13px]"
              aria-label="Buscar"
            />
          </div>
          <Select size_="sm" value={categoryId} onChange={(e) => update({ categoria: e.target.value })} aria-label="Categoria">
            <option value="">Todas as categorias</option>
            {(categories.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select size_="sm" value={contactId} onChange={(e) => update({ contato: e.target.value })} aria-label="Contato">
            <option value="">Todos os contatos</option>
            {(contacts.data?.items ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select size_="sm" value={source} onChange={(e) => update({ origem: e.target.value })} aria-label="Conta ou cartão">
            <option value="">Todas as contas</option>
            <optgroup label="Contas">
              {(accounts.data ?? []).map((a) => (
                <option key={a.id} value={`account:${a.id}`}>
                  {a.name}
                </option>
              ))}
            </optgroup>
            {isExpense ? (
              <optgroup label="Cartões">
                {(cards.data ?? []).map((c) => (
                  <option key={c.id} value={`card:${c.id}`}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </Select>
          {hasFilters ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearchInput('');
                update({ categoria: null, contato: null, origem: null, busca: null });
              }}
            >
              <X /> Limpar
            </Button>
          ) : null}
        </div>
      </Card>

      <Card className="@container overflow-hidden">
        <div className="hidden items-center gap-3 border-b border-border bg-surface-muted px-5.5 py-2.5 text-[11px] font-semibold tracking-wide text-muted uppercase @xl:flex">
          <span className="w-9">Status</span>
          <span className="flex-1">Descrição</span>
          <span className="hidden w-44 @3xl:block">Conta / Cartão</span>
          <span className="w-36 text-right">Vencimento</span>
          <span className="w-32 text-right">Valor</span>
          <span className="w-8" />
        </div>
        <div className="p-1.5">
          {list.isPending ? (
            <SkeletonRows rows={6} className="p-3" />
          ) : list.isError ? (
            <ErrorState error={list.error} onRetry={() => list.refetch()} className="m-3" />
          ) : list.data.items.length === 0 ? (
            <EmptyState
              className="m-3"
              icon={isExpense ? <Receipt /> : <HandCoins />}
              title={hasFilters || status !== 'all' ? 'Nenhum lançamento com esses filtros' : labels.empty}
              description={
                isExpense
                  ? 'Cadastre aluguel, assinaturas, boletos e parcelas para prever o mês com precisão.'
                  : 'Cadastre salário, aluguéis recebidos e outras entradas recorrentes.'
              }
              action={
                <WriteGate>
                  <Button variant="outline" onClick={() => actions.openTransaction({ type })}>
                    {labels.new}
                  </Button>
                </WriteGate>
              }
            />
          ) : (
            <div className={list.isPlaceholderData ? 'opacity-60 transition-opacity' : undefined}>
              {list.data.items.map((tx) => (
                <TransactionRow key={tx.id} tx={tx} />
              ))}
            </div>
          )}
        </div>
        {list.data && list.data.total > PAGE_SIZE ? (
          <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm text-muted">
            <span>
              Página {page} de {totalPages} · {list.data.total} lançamentos
            </span>
            <div className="flex gap-1">
              <Button variant="outline" size="icon-sm" disabled={page <= 1} onClick={() => update({ pagina: String(page - 1) })} aria-label="Página anterior">
                <ChevronLeft />
              </Button>
              <Button variant="outline" size="icon-sm" disabled={page >= totalPages} onClick={() => update({ pagina: String(page + 1) })} aria-label="Próxima página">
                <ChevronRight />
              </Button>
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
