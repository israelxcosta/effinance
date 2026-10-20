import { useEffect, useState } from 'react';
import { Command } from 'cmdk';
import { Dialog } from 'radix-ui';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeftRight, Minus, Plus, Search, TrendingUp, UserRound } from 'lucide-react';
import { formatBRL, formatDateBR, type SearchResponse } from '@effinance/shared';
import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { BankLogo } from '@/components/ui/bank-logo';
import { CategoryIcon } from '@/components/ui/category-icon';
import { useTransactionActions } from '@/features/transactions/transaction-actions';
import { NAV_ITEMS, SETTINGS_ITEM } from './nav';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const itemClass =
  'flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 text-sm text-fg data-[selected=true]:bg-bg-subtle [&_svg]:size-4 [&_svg]:text-muted';

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const actions = useTransactionActions();
  const [query, setQuery] = useState('');
  const q = useDebounced(query.trim(), 200);
  const search = useQuery({
    queryKey: qk.search(q),
    queryFn: () => api<SearchResponse>('/search', { query: { q } }),
    enabled: open && q.length >= 2,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  function run(fn: () => void) {
    onOpenChange(false);
    fn();
  }

  const r = search.data;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30 backdrop-blur-[2px] data-[state=open]:animate-fade-in" />
        <Dialog.Content className="fixed top-[12vh] left-1/2 z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl border border-border bg-surface shadow-lg outline-none data-[state=open]:animate-fade-in">
          <Dialog.Title className="sr-only">Buscar</Dialog.Title>
          <Dialog.Description className="sr-only">Busque transações, contas, categorias, contatos ou navegue</Dialog.Description>
          <Command shouldFilter={!q || q.length < 2} label="Busca global">
            <div className="flex items-center gap-3 border-b border-border px-4">
              <Search className="size-4 text-muted" />
              <Command.Input
                value={query}
                onValueChange={setQuery}
                placeholder="Buscar transações, contas, categorias ou ações…"
                className="h-14 flex-1 bg-transparent text-[15px] outline-none placeholder:text-subtle"
              />
              <kbd className="rounded-md border border-border bg-bg-subtle px-1.5 py-0.5 text-[11px] font-semibold text-muted">ESC</kbd>
            </div>
            <Command.List className="scrollbar-thin max-h-[60vh] overflow-y-auto p-2">
              <Command.Empty className="px-3 py-8 text-center text-sm text-muted">
                {search.isFetching ? 'Buscando…' : 'Nada encontrado.'}
              </Command.Empty>

              {r && q.length >= 2 ? (
                <>
                  {r.transactions.length ? (
                    <Command.Group heading="Lançamentos" className="[&_[cmdk-group-heading]]:eyebrow [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-subtle">
                      {r.transactions.map((t) => (
                        <Command.Item key={t.id} value={`tx-${t.id}`} className={itemClass} onSelect={() => run(() => actions.edit(t))}>
                          <CategoryIcon icon={t.category?.icon ?? (t.type === 'transfer' ? 'landmark' : 'tag')} color={t.category?.color ?? '#6B6F76'} size="sm" />
                          <span className="flex-1 truncate">
                            {t.description}
                            <span className="ml-2 text-xs text-muted">{formatDateBR(t.date)}</span>
                          </span>
                          <span className={t.type === 'income' ? 'tabular font-semibold text-success' : t.type === 'expense' ? 'tabular font-semibold text-danger' : 'tabular font-semibold'}>
                            {formatBRL(t.amount)}
                          </span>
                        </Command.Item>
                      ))}
                    </Command.Group>
                  ) : null}
                  {r.accounts.length ? (
                    <Command.Group heading="Contas" className="[&_[cmdk-group-heading]]:eyebrow [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-subtle">
                      {r.accounts.map((a) => (
                        <Command.Item key={a.id} value={`acc-${a.id}`} className={itemClass} onSelect={() => run(() => navigate(`/extrato?conta=${a.id}`))}>
                          <BankLogo bank={a.bank} color={a.color} size="sm" />
                          <span className="flex-1 truncate">{a.name}</span>
                          <span className="tabular text-sm font-semibold">{formatBRL(a.balance)}</span>
                        </Command.Item>
                      ))}
                    </Command.Group>
                  ) : null}
                  {r.categories.length ? (
                    <Command.Group heading="Categorias" className="[&_[cmdk-group-heading]]:eyebrow [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-subtle">
                      {r.categories.map((c) => (
                        <Command.Item key={c.id} value={`cat-${c.id}`} className={itemClass} onSelect={() => run(() => navigate(`/categorias?tipo=${c.type}`))}>
                          <CategoryIcon icon={c.icon} color={c.color} size="sm" />
                          <span className="flex-1 truncate">{c.name}</span>
                        </Command.Item>
                      ))}
                    </Command.Group>
                  ) : null}
                  {r.contacts.length ? (
                    <Command.Group heading="Contatos" className="[&_[cmdk-group-heading]]:eyebrow [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-subtle">
                      {r.contacts.map((c) => (
                        <Command.Item key={c.id} value={`ct-${c.id}`} className={itemClass} onSelect={() => run(() => navigate(`/contatos?editar=${c.id}`))}>
                          <UserRound />
                          <span className="flex-1 truncate">{c.name}</span>
                        </Command.Item>
                      ))}
                    </Command.Group>
                  ) : null}
                </>
              ) : null}

              <Command.Group heading="Ações" className="[&_[cmdk-group-heading]]:eyebrow [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-subtle">
                <Command.Item value="nova despesa" className={itemClass} onSelect={() => run(() => actions.openTransaction({ type: 'expense' }))}>
                  <Minus className="!text-danger" /> Nova despesa
                </Command.Item>
                <Command.Item value="nova receita" className={itemClass} onSelect={() => run(() => actions.openTransaction({ type: 'income' }))}>
                  <Plus className="!text-success" /> Nova receita
                </Command.Item>
                <Command.Item value="transferir entre contas" className={itemClass} onSelect={() => run(() => actions.openTransfer('transfer'))}>
                  <ArrowLeftRight /> Transferir entre contas
                </Command.Item>
                <Command.Item value="investir aplicar" className={itemClass} onSelect={() => run(() => actions.openTransfer('investment'))}>
                  <TrendingUp /> Investir
                </Command.Item>
              </Command.Group>
              <Command.Group heading="Ir para" className="[&_[cmdk-group-heading]]:eyebrow [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-subtle">
                {[...NAV_ITEMS, SETTINGS_ITEM].map((item) => (
                  <Command.Item
                    key={item.to}
                    value={`${item.label} ${item.keywords ?? ''}`}
                    className={itemClass}
                    onSelect={() => run(() => navigate(item.to))}
                  >
                    <item.icon /> {item.label}
                  </Command.Item>
                ))}
              </Command.Group>
            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
