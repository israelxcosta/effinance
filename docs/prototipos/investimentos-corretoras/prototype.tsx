// PROTÓTIPO (dados fictícios) — corretoras + compra com aplicação automática.
import { ArrowLeftRight, ArrowRight, Lightbulb, Pencil, Plus, ShoppingCart, Star, Trash2, TrendingUp } from 'lucide-react';
import { formatBRL } from '@effinance/shared';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { BankLogo } from '@/components/ui/bank-logo';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { MoneyInput } from '@/components/ui/money-input';
import { DateInput } from '@/components/ui/date-input';
import { MiniStat, PageHeader } from '@/components/ui/misc';
import { ProgressBar } from '@/components/ui/progress-bar';
import { PaidToggle } from '@/components/ui/paid-toggle';

export function ProtoPurchase() {
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
        <Field label="Taxas e emolumentos">
          <MoneyInput value={490} onChange={() => undefined} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Corretora" hint="Padrão: Carteira">
            <Select defaultValue="xp">
              <option value="carteira">Carteira</option>
              <option value="xp">XP Investimentos</option>
              <option value="new">+ Nova corretora</option>
            </Select>
          </Field>
          <Field label="Pago com" hint="Em branco: o dinheiro já estava na corretora">
            <Select defaultValue="nu">
              <option value="">Já estava na corretora</option>
              <option value="nu">Conta corrente Nubank</option>
            </Select>
          </Field>
        </div>

        <div className="flex flex-col gap-3 rounded-xl bg-surface-muted p-4 text-label">
          <div className="flex items-baseline justify-between">
            <span className="font-medium text-muted">Total da compra</span>
            <span className="tabular text-lg font-semibold text-fg">{formatBRL(365_490)}</span>
          </div>
          <div className="flex items-center gap-2 border-t border-border pt-3">
            <BankLogo bank="nubank" color="#820AD1" size="xs" />
            <span className="text-fg">Conta corrente Nubank</span>
            <ArrowRight className="size-3.5 text-subtle" />
            <BankLogo bank="xp" color="#111111" size="xs" />
            <span className="flex-1 text-fg">XP Investimentos</span>
            <span className="tabular font-semibold text-fg">{formatBRL(365_490)}</span>
          </div>
          <p className="-mt-1 text-xs text-muted">Lançada como Aplicação (transferência): não entra em Despesas.</p>
          <div className="grid grid-cols-2 gap-2 border-t border-border pt-3">
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

const BROKERS = [
  { name: 'Carteira', bank: null, color: '#152B61', invested: 870_000, assets: 1, standard: true },
  { name: 'XP Investimentos', bank: 'xp' as const, color: '#111111', invested: 1_073_490, assets: 2, standard: false },
  { name: 'Nubank (NuInvest)', bank: 'nubank' as const, color: '#820AD1', invested: 317_800, assets: 1, standard: false },
];

export function ProtoBrokers() {
  return (
    <div className="flex w-[460px] flex-col rounded-2xl border border-border bg-surface shadow-lg">
      <div className="border-b border-border p-6">
        <h2 className="text-heading font-semibold tracking-tight">Corretoras</h2>
        <p className="mt-1 text-sm text-muted">Onde seus investimentos ficam. A "Carteira" é a padrão.</p>
      </div>
      <ul className="flex flex-col divide-y divide-border p-2">
        {BROKERS.map((b) => (
          <li key={b.name} className="flex items-center gap-3 px-3 py-3">
            {b.bank ? (
              <BankLogo bank={b.bank} color={b.color} />
            ) : (
              <span className="grid size-10 place-items-center rounded-full bg-primary-soft text-primary-soft-fg">
                <TrendingUp className="size-4" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 truncate text-label font-semibold text-fg">
                {b.name}
                {b.standard ? (
                  <Badge tone="brand">
                    <Star className="size-3" /> Padrão
                  </Badge>
                ) : null}
              </p>
              <p className="text-xs text-muted">
                {b.assets} {b.assets === 1 ? 'ativo' : 'ativos'} · {formatBRL(b.invested)} investidos
              </p>
            </div>
            <span className="flex gap-1 text-muted">
              <Pencil className="size-4" />
              {!b.standard ? <Trash2 className="size-4" /> : null}
            </span>
          </li>
        ))}
      </ul>
      <div className="border-t border-border p-4">
        <Button variant="outline" className="w-full">
          <Plus /> Nova corretora
        </Button>
      </div>
    </div>
  );
}

export function ProtoInvestPage() {
  const total = BROKERS.reduce((s, b) => s + b.invested, 0);
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        overline="Patrimônio"
        title="Investimentos"
        description="Registre suas compras: o Effinance calcula o preço médio e lança a aplicação na corretora."
        actions={
          <div className="flex gap-2">
            <Button variant="outline">Corretoras</Button>
            <Button>
              <Plus /> Nova compra
            </Button>
          </div>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniStat label="Total investido" value={formatBRL(total)} tone="brand" hint="Valor pago, com taxas" />
        <MiniStat label="Investido no mês" value={formatBRL(560_240)} hint="Aplicações de novembro" />
        <MiniStat label="Ativos" value="4" hint="5 compras" />
        <MiniStat label="Corretoras" value="3" hint="maior: XP Investimentos" />
      </div>
      <Card className="p-5">
        <p className="text-title font-semibold tracking-tight text-fg">Por corretora</p>
        <ul className="mt-4 flex flex-col gap-3">
          {BROKERS.map((b) => (
            <li key={b.name} className="grid grid-cols-[12rem_1fr_7rem] items-center gap-4 text-label">
              <span className="flex min-w-0 items-center gap-2">
                <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: b.color }} />
                <span className="truncate text-fg">{b.name}</span>
              </span>
              <ProgressBar value={b.invested / total} color={b.color} size="sm" />
              <span className="text-right font-semibold text-fg tabular">{formatBRL(b.invested)}</span>
            </li>
          ))}
        </ul>
      </Card>
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-border p-4">
          <div>
            <p className="text-title font-semibold tracking-tight text-fg">Carteira</p>
            <p className="mt-0.5 text-xs text-muted">Posição por ativo · preço médio com taxas</p>
          </div>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-muted text-left text-2xs font-semibold tracking-wide text-muted uppercase">
              <th className="px-4 py-2.5">Ativo</th>
              <th className="px-3 py-2.5">Corretora</th>
              <th className="px-3 py-2.5 text-right">Quantidade</th>
              <th className="px-3 py-2.5 text-right">Preço médio</th>
              <th className="px-3 py-2.5 text-right">Total investido</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {[
              ['BTC', 'Bitcoin · Cripto', 'Carteira', '0,015', 'R$ 580.000,00', 'R$ 8.700,00'],
              ['PETR4', 'Petrobras PN · Ação', 'XP Investimentos', '150', 'R$ 37,35', 'R$ 5.602,40'],
              ['IVVB11', 'iShares S&P 500 · ETF', 'XP Investimentos', '15', 'R$ 342,27', 'R$ 5.134,00'],
              ['HGLG11', 'CSHG Logística · FII', 'Nubank (NuInvest)', '20', 'R$ 158,90', 'R$ 3.178,00'],
            ].map(([t, n, b, q, pm, tot]) => (
              <tr key={t} className="border-b border-border last:border-0">
                <td className="px-4 py-3">
                  <p className="font-semibold text-fg">{t}</p>
                  <p className="text-xs text-muted">{n}</p>
                </td>
                <td className="px-3 py-3 text-muted">{b}</td>
                <td className="tabular px-3 py-3 text-right">{q}</td>
                <td className="tabular px-3 py-3 text-right">{pm}</td>
                <td className="tabular px-3 py-3 text-right font-semibold">{tot}</td>
                <td className="px-2 text-muted">
                  <ShoppingCart className="size-4" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

export function ProtoStatement() {
  return (
    <Card className="w-[900px] overflow-hidden">
      <div className="border-b border-border bg-surface-muted px-5 py-2.5 text-2xs font-semibold tracking-wide text-muted uppercase">Extrato · Conta corrente Nubank · 26/11/2026</div>
      <div className="p-1.5">
        {[
          { icon: <ArrowLeftRight className="size-4" />, title: 'Compra PETR4 (100 × R$ 36,50)', badge: 'Aplicação', sub: 'Conta corrente Nubank → XP Investimentos', value: '−R$ 3.654,90', tone: 'text-fg' },
          { icon: <Lightbulb className="size-4" />, title: 'Conta de luz', badge: null, sub: 'Moradia · Energia', value: '−R$ 212,03', tone: 'text-danger' },
        ].map((r) => (
          <div key={r.title} className="flex items-center gap-3 rounded-lg px-3 py-3">
            <PaidToggle paid kind="transfer" disabled onToggle={() => undefined} />
            <span className="grid size-10 place-items-center rounded-md bg-primary-soft text-primary-soft-fg">{r.icon}</span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-fg">
                {r.title}
                {r.badge ? <Badge tone="brand">{r.badge}</Badge> : null}
              </p>
              <p className="text-xs text-muted">{r.sub}</p>
            </div>
            <span className={`tabular text-title font-semibold ${r.tone}`}>{r.value}</span>
          </div>
        ))}
      </div>
      <p className="border-t border-border bg-surface-muted px-5 py-2.5 text-xs text-muted">
        A aplicação reduz o saldo da conta corrente, mas não conta como despesa: Resultado e Taxa de economia não mudam.
      </p>
    </Card>
  );
}

export default function PrototypePage() {
  return (
    <div className="flex flex-col gap-10">
      <section id="pagina">
        <ProtoInvestPage />
      </section>
      <section id="compra" className="flex items-start gap-6">
        <ProtoPurchase />
        <ProtoBrokers />
      </section>
      <section id="extrato">
        <ProtoStatement />
      </section>
    </div>
  );
}
