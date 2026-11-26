import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { BANKS, formatBRL, type BankCode, type InvestmentBroker } from '@effinance/shared';
import { Modal } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { BankLogo } from '@/components/ui/bank-logo';
import { Badge } from '@/components/ui/badge';
import { useSaveAccount } from '@/features/accounts/api';
import { WriteGate } from '@/features/auth/permissions';
import { toastError } from '@/lib/notify';

/** Brokers = investment accounts. "Carteira" is the default one (created on the first purchase). */
export function BrokersDialog({ open, onOpenChange, brokers }: { open: boolean; onOpenChange: (o: boolean) => void; brokers: InvestmentBroker[] }) {
  const save = useSaveAccount();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [bank, setBank] = useState('');

  async function add() {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const color = BANKS.find((b) => b.code === bank)?.color ?? '#152B61';
      await save.mutateAsync({ input: { name: trimmed, type: 'investment', bank: (bank || null) as BankCode | null, color, icon: 'trending-up', initialBalance: 0, includeInTotal: true, archived: false } });
      await qc.invalidateQueries({ queryKey: ['investments'] });
      toast.success('Corretora cadastrada');
      setName('');
      setBank('');
    } catch (error) {
      toastError(error);
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Corretoras">
      <div className="flex flex-col gap-4">
        <ul className="flex flex-col divide-y divide-border">
          {(brokers.length ? brokers : [{ id: 'default', name: 'Carteira', bank: null, color: '#152B61', invested: 0, assets: 0 }]).map((b) => (
            <li key={b.id} className="flex items-center gap-3 py-3">
              {b.bank ? (
                <BankLogo bank={b.bank} color={b.color} />
              ) : (
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary-soft text-primary-soft-fg">
                  <TrendingUp className="size-4" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 truncate text-label font-semibold text-fg">
                  {b.name}
                  {b.name === 'Carteira' ? <Badge tone="brand">Padrão</Badge> : null}
                </p>
                <p className="text-xs text-muted tabular">
                  {b.assets} {b.assets === 1 ? 'ativo' : 'ativos'} · {formatBRL(b.invested)}
                </p>
              </div>
            </li>
          ))}
        </ul>
        <WriteGate>
          <form
            className="flex flex-col gap-2 border-t border-border pt-4"
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
          >
            <div className="grid grid-cols-[1fr_150px] gap-2">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nova corretora" maxLength={60} aria-label="Nome da corretora" />
              <Select value={bank} onChange={(e) => setBank(e.target.value)} aria-label="Instituição">
                <option value="">Sem logo</option>
                {BANKS.map((b) => (
                  <option key={b.code} value={b.code}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" variant="outline" loading={save.isPending} disabled={!name.trim()}>
              <Plus /> Adicionar
            </Button>
          </form>
        </WriteGate>
      </div>
    </Modal>
  );
}
