import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Ellipsis, HandCoins, Mail, Pencil, Phone, Plus, Receipt, Search, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { formatDocument, formatPhone, type Contact } from '@effinance/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState, PageHeader } from '@/components/ui/misc';
import { Input } from '@/components/ui/input';
import { SkeletonRows } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { api, errorMessage } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { initials } from '@/lib/utils';
import { useContacts, useDeleteContact } from '../api';
import { ContactSheet } from '../contact-sheet';

const PAGE_SIZE = 25;

export default function ContactsPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [sheet, setSheet] = useState<{ open: boolean; contact?: Contact | null }>({ open: false });
  const [toDelete, setToDelete] = useState<Contact | null>(null);
  const del = useDeleteContact();

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const contacts = useContacts({ search: search || undefined, page, pageSize: PAGE_SIZE });

  // Deep link from the command palette: /contatos?editar=<id>
  const editId = params.get('editar');
  const editing = useQuery({
    queryKey: qk.contact(editId ?? ''),
    queryFn: () => api<Contact>(`/contacts/${editId}`),
    enabled: Boolean(editId),
  });
  useEffect(() => {
    if (editing.data) {
      setSheet({ open: true, contact: editing.data });
      const next = new URLSearchParams(params);
      next.delete('editar');
      setParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing.data]);

  const data = contacts.data;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        overline="Cadastros"
        title="Contatos"
        description="Clientes, fornecedores e pessoas vinculadas às suas contas a pagar e a receber."
        actions={<Button onClick={() => setSheet({ open: true, contact: null })}><Plus /> Novo contato</Button>}
      />

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
            <Input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Buscar por nome, CPF, e-mail ou telefone" className="h-10 pl-9" aria-label="Buscar contatos" />
          </div>
          {data ? <span className="text-xs text-muted">{data.total} contato(s)</span> : null}
        </div>

        {contacts.isPending ? (
          <SkeletonRows rows={6} className="p-4" />
        ) : contacts.isError ? (
          <ErrorState error={contacts.error} onRetry={() => contacts.refetch()} className="m-4" />
        ) : data!.items.length === 0 ? (
          <EmptyState
            className="m-4"
            icon={<Users />}
            title={search ? 'Nenhum contato encontrado' : 'Nenhum contato cadastrado'}
            description="Vincule contatos aos lançamentos para ver totais e evolução por pessoa ou empresa nos relatórios."
            action={<Button variant="outline" onClick={() => setSheet({ open: true, contact: null })}>Adicionar contato</Button>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-muted text-left text-[11px] font-semibold tracking-wide text-muted uppercase">
                  <th className="px-4 py-2.5">Nome</th>
                  <th className="px-4 py-2.5">CPF / CNPJ</th>
                  <th className="px-4 py-2.5">Contato</th>
                  <th className="px-4 py-2.5">Cidade</th>
                  <th className="w-12 px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {data!.items.map((c) => (
                  <tr key={c.id} className="group border-b border-border last:border-0 hover:bg-surface-muted">
                    <td className="px-4 py-3">
                      <button type="button" className="flex items-center gap-3 text-left" onClick={() => setSheet({ open: true, contact: c })}>
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-bold text-primary-soft-fg">{initials(c.name)}</span>
                        <span className="font-semibold text-fg">{c.name}</span>
                      </button>
                    </td>
                    <td className="tabular px-4 py-3 text-muted">{c.document ? formatDocument(c.document) : '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-0.5 text-xs text-muted">
                        {c.email ? <span className="flex items-center gap-1.5"><Mail className="size-3.5" />{c.email}</span> : null}
                        {c.phone ? <span className="flex items-center gap-1.5"><Phone className="size-3.5" />{formatPhone(c.phone)}</span> : null}
                        {!c.email && !c.phone ? '—' : null}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted">{c.city ? `${c.city}${c.state ? ` / ${c.state}` : ''}` : '—'}</td>
                    <td className="px-4 py-3">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button type="button" className="flex size-8 items-center justify-center rounded-md text-muted hover:bg-bg-subtle hover:text-fg" aria-label={`Ações de ${c.name}`}>
                            <Ellipsis className="size-4" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem icon={<Pencil />} onSelect={() => setSheet({ open: true, contact: c })}>Editar</DropdownMenuItem>
                          <DropdownMenuItem icon={<Receipt />} onSelect={() => navigate(`/contas-a-pagar?contato=${c.id}&modo=year`)}>Contas a pagar</DropdownMenuItem>
                          <DropdownMenuItem icon={<HandCoins />} onSelect={() => navigate(`/contas-a-receber?contato=${c.id}&modo=year`)}>Contas a receber</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem icon={<Trash2 />} tone="danger" onSelect={() => setToDelete(c)}>Excluir</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > PAGE_SIZE ? (
          <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm text-muted">
            <span>Página {page} de {totalPages}</span>
            <div className="flex gap-1">
              <Button variant="outline" size="icon-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Página anterior"><ChevronLeft /></Button>
              <Button variant="outline" size="icon-sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} aria-label="Próxima página"><ChevronRight /></Button>
            </div>
          </div>
        ) : null}
      </Card>

      <ContactSheet open={sheet.open} contact={sheet.contact} onOpenChange={(o) => setSheet((s) => ({ ...s, open: o }))} />
      <ConfirmDialog
        open={Boolean(toDelete)}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Excluir contato?"
        description={`"${toDelete?.name}" será excluído. Os lançamentos vinculados ficarão sem contato.`}
        confirmLabel="Excluir"
        loading={del.isPending}
        onConfirm={async () => {
          try {
            await del.mutateAsync(toDelete!.id);
            toast.success('Contato excluído');
            setToDelete(null);
          } catch (error) {
            toast.error(errorMessage(error));
          }
        }}
      />
    </div>
  );
}
