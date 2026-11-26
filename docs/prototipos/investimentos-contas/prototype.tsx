// PROTÓTIPO (dados fictícios) — contas de investimento ligadas à conta principal + compra com transferência automática.
import { useState } from 'react';
import { ArrowDown, CornerDownRight, Ellipsis, Landmark, Plus, Wallet } from 'lucide-react';
import { formatBRL } from '@effinance/shared';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { BankLogo } from '@/components/ui/bank-logo';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { MoneyInput } from '@/components/ui/money-input';
import { DateInput } from '@/components/ui/date-input';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { MiniStat, PageHeader } from '@/components/ui/misc';
import { cn } from '@/lib/utils';

function Split({ available, allocated }: { available: number; allocated: number }) {
  const total = available + allocated;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex h-2 overflow-hidden rounded-full bg-bg-subtle">
        <span className="bg-brand-500" style={{ width: `${(allocated / total) * 100}%` }} />
        <span className="bg-success/70" style={{ width: `${(available / total) * 100}%` }} />
      </div>
      <div className="flex justify-between text-2xs text-muted tabular">
        <span>
          <span className="mr-1 inline-block size-2 rounded-full bg-brand-500 align-middle" />
          em ativos {formatBRL(allocated)}
        </span>
        <span>
          <span className="mr-1 inline-block size-2 rounded-full bg-success/70 align-middle" />
          disponível {formatBRL(available)}
        </span>
      </div>
    </div>
  );
}

function AccountCard({
  name,
  bank,
  color,
  type,
  balance,
  projected,
  child,
}: {
  name: string;
  bank: 'nubank' | 'itau' | 'xp';
  color: string;
  type: string;
  balance: number;
  projected: number;
  child?: { name: string; available: number; allocated: number };
}) {
  return (
    <Card className="relative flex flex-col gap-5 overflow-hidden p-5">
      <div className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: color }} aria-hidden />
      <div className="flex items-start gap-3">
        <BankLogo bank={bank} color={color} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-title font-semibold">{name}</p>
          <div className="mt-1 flex gap-1.5">
            <Badge tone="neutral">{type}</Badge>
          </div>
        </div>
        <span className="flex size-8 items-center justify-center text-muted">
          <Ellipsis className="size-4" />
        </span>
      </div>
      <div>
        <p className="text-xs font-medium text-muted">Saldo atual</p>
        <p className="tabular mt-1 text-display font-semibold tracking-tight">{formatBRL(balance)}</p>
      </div>
      <div className="flex items-center justify-between rounded-md bg-bg-subtle px-3 py-2 text-xs">
        <span className="text-muted">Previsto fim do mês</span>
        <span className="tabular font-semibold text-fg">{formatBRL(projected)}</span>
      </div>
      {child ? (
        <div className="-mx-5 -mb-5 border-t border-border bg-surface-muted px-5 py-4">
          <div className="flex items-start gap-2.5">
            <CornerDownRight className="mt-0.5 size-4 shrink-0 text-subtle" />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <p className="truncate text-label font-semibold text-fg">{child.name}</p>
                <p className="tabular text-label font-semibold text-fg">{formatBRL(child.available + child.allocated)}</p>
              </div>
              <p className="text-2xs text-muted">Conta de investimento · ligada a esta conta</p>
              <div className="mt-2.5">
                <Split available={child.available} allocated={child.allocated} />
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

export function ProtoAccounts() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader overline="Patrimônio" title="Contas e carteiras" description="Saldos de contas, carteiras e investimentos." actions={<Button><Plus /> Nova conta</Button>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniStat label="Saldo em contas" value={formatBRL(1_045_000)} />
        <MiniStat label="Investido" value={formatBRL(2_350_000)} tone="brand" hint="em ativos R$ 21.100,00" />
        <MiniStat label="Disponível p/ investir" value={formatBRL(240_000)} tone="success" hint="nas contas de investimento" />
        <MiniStat label="Patrimônio" value={formatBRL(3_395_000)} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <AccountCard name="Conta corrente Nubank" bank="nubank" color="#820AD1" type="Conta corrente" balance={420_000} projected={318_000} child={{ name: 'Investimentos Nubank', available: 130_000, allocated: 1_120_000 }} />
        <AccountCard name="Itaú Personnalité" bank="itau" color="#EC7000" type="Conta corrente" balance={625_000} projected={590_000} child={{ name: 'XP Investimentos', available: 110_000, allocated: 990_000 }} />
        <Card className="flex flex-col items-center justify-center gap-2 border-dashed p-5 text-center text-label text-muted">
          <Landmark className="size-5" />
          Contas de investimento aparecem dentro da conta principal a que estão ligadas.
        </Card>
      </div>
    </div>
  );
}

export function ProtoPurchase() {
  const [source, setSource] = useState<'checking' | 'available'>('checking');
  return (
    <div className="flex w-[520px] flex-col rounded-2xl border border-border bg-surface shadow-lg">
      <div className="border-b border-border p-6">
        <h2 className="text-heading font-semibold tracking-tight">Nova compra</h2>
        <p className="mt-1 text-sm text-muted">O preço médio é calculado com todas as compras (taxas incluídas).</p>
      </div>
      <div className="flex flex-col gap-5 p-6">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Ativo">
            <Input defaultValue="PETR4" />
          </Field>
          <Field label="Tipo">
            <Select defaultValue="stock">
              <option value="stock">Ação</option>
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Data">
            <DateInput defaultValue="2026-11-26" />
          </Field>
          <Field label="Quantidade">
            <Input defaultValue="100" className="text-right" />
          </Field>
          <Field label="Preço">
            <MoneyInput value={3650} onChange={() => undefined} />
          </Field>
        </div>

        <Field label="Onde fica investido" hint="Sugerida: a conta de investimento ligada à sua conta principal">
          <Select defaultValue="nu">
            <option value="nu">Investimentos Nubank · disponível R$ 1.300,00</option>
            <option value="xp">XP Investimentos · disponível R$ 1.100,00</option>
            <option value="new">+ Nova conta de investimento</option>
          </Select>
        </Field>

        <div className="flex flex-col gap-2">
          <span className="text-label font-medium text-fg">De onde sai o dinheiro</span>
          <SegmentedControl
            fullWidth
            ariaLabel="Origem do dinheiro"
            value={source}
            onChange={setSource}
            options={[
              { value: 'checking', label: 'De uma conta corrente' },
              { value: 'available', label: 'Do disponível' },
            ]}
          />
          {source === 'checking' ? (
            <Select defaultValue="nubank">
              <option value="nubank">Conta corrente Nubank · R$ 4.200,00</option>
            </Select>
          ) : null}
        </div>

        <div className="flex flex-col gap-3 rounded-xl bg-surface-muted p-4 text-label">
          <div className="flex items-baseline justify-between">
            <span className="font-medium text-muted">Total da compra</span>
            <span className="tabular text-lg font-semibold text-fg">{formatBRL(365_490)}</span>
          </div>
          {source === 'checking' ? (
            <div className="flex flex-col gap-1.5 border-t border-border pt-3">
              <div className="flex items-center gap-2">
                <Wallet className="size-4 text-muted" />
                <span className="flex-1 text-fg">Conta corrente Nubank</span>
                <span className="tabular text-danger">−{formatBRL(365_490)}</span>
              </div>
              <ArrowDown className="ml-0.5 size-3.5 text-subtle" />
              <div className="flex items-center gap-2">
                <CornerDownRight className="size-4 text-muted" />
                <span className="flex-1 text-fg">Investimentos Nubank → PETR4</span>
                <span className="tabular text-brand-text">+{formatBRL(365_490)}</span>
              </div>
              <p className="mt-1 text-xs text-muted">Transferência (Aplicação) automática: não entra em Despesas.</p>
            </div>
          ) : (
            <div className="border-t border-border pt-3 text-xs">
              <p className="text-fg">
                Disponível em Investimentos Nubank: <strong className="tabular">{formatBRL(130_000)}</strong>
              </p>
              <p className="mt-1 rounded-md bg-warning-soft px-2.5 py-2 text-warning">
                Faltam {formatBRL(235_490)}. <span className="font-semibold underline">Transferir a diferença da conta corrente</span>
              </p>
            </div>
          )}
          <div className={cn('grid grid-cols-2 gap-2 border-t border-border pt-3')}>
            <div>
              <p className="text-xs text-muted">PETR4 antes</p>
              <p className="tabular font-medium text-fg">50 × R$ 38,95</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted">Depois desta compra</p>
              <p className="tabular font-semibold text-brand-text">150 × R$ 37,35</p>
            </div>
          </div>
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-border p-4">
        <Button variant="ghost">Cancelar</Button>
        <Button className="min-w-[110px]">Salvar</Button>
      </div>
    </div>
  );
}

export function ProtoInvestHeader() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader overline="Patrimônio" title="Investimentos" description="Compras alocadas nas suas contas de investimento." actions={<Button><Plus /> Nova compra</Button>} />
      <div className="grid gap-3 md:grid-cols-2">
        {[
          { name: 'Investimentos Nubank', parent: 'Conta corrente Nubank', bank: 'nubank' as const, color: '#820AD1', available: 130_000, allocated: 1_120_000 },
          { name: 'XP Investimentos', parent: 'Itaú Personnalité', bank: 'xp' as const, color: '#111111', available: 110_000, allocated: 990_000 },
        ].map((a) => (
          <Card key={a.name} className="flex flex-col gap-3 p-4">
            <div className="flex items-center gap-3">
              <BankLogo bank={a.bank} color={a.color} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-label font-semibold text-fg">{a.name}</p>
                <p className="truncate text-2xs text-muted">ligada a {a.parent}</p>
              </div>
              <p className="tabular text-lg font-semibold text-fg">{formatBRL(a.available + a.allocated)}</p>
            </div>
            <Split available={a.available} allocated={a.allocated} />
          </Card>
        ))}
      </div>
    </div>
  );
}

export default function PrototypePage() {
  return (
    <div className="flex flex-col gap-10">
      <section id="contas">
        <ProtoAccounts />
      </section>
      <section id="investimentos">
        <ProtoInvestHeader />
      </section>
      <section id="compra" className="flex gap-6">
        <ProtoPurchase />
      </section>
    </div>
  );
}
