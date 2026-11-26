// PROTÓTIPO (dados fictícios) — venda com resultado, proventos e saldo na corretora.
import { ArrowDownToLine, ArrowLeftRight, HandCoins, Plus, ShoppingCart, TrendingDown } from 'lucide-react';
import { formatBRL } from '@effinance/shared';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { MoneyInput } from '@/components/ui/money-input';
import { DateInput } from '@/components/ui/date-input';
import { MiniStat, PageHeader } from '@/components/ui/misc';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { BankLogo } from '@/components/ui/bank-logo';

function Dialog({ title, children, action }: { title: string; children: React.ReactNode; action: string }) {
  return (
    <div className="flex w-[500px] flex-col rounded-2xl border border-border bg-surface shadow-lg">
      <div className="border-b border-border p-6">
        <h2 className="text-heading font-semibold tracking-tight">{title}</h2>
      </div>
      <div className="flex flex-col gap-5 p-6">{children}</div>
      <div className="flex justify-end gap-2 border-t border-border p-4">
        <Button variant="ghost">Cancelar</Button>
        <Button className="min-w-[110px]">{action}</Button>
      </div>
    </div>
  );
}

/** 1 — Vender: preço de venda, resultado pelo preço médio. */
export function ProtoSell() {
  return (
    <Dialog title="Vender PETR4" action="Registrar venda">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Quantidade">
          <Input defaultValue="100" className="tabular text-right" />
        </Field>
        <Field label="Preço de venda">
          <MoneyInput value={1500} onChange={() => undefined} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Data">
          <DateInput defaultValue="2026-11-26" />
        </Field>
        <Field label="Taxas">
          <MoneyInput value={0} onChange={() => undefined} />
        </Field>
      </div>
      <div className="flex flex-col gap-2 rounded-xl bg-surface-muted p-4 text-label">
        <div className="flex justify-between">
          <span className="text-muted">Valor da venda</span>
          <span className="tabular font-medium">{formatBRL(150000)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">Custo (100 × {formatBRL(1603)})</span>
          <span className="tabular font-medium">{formatBRL(160300)}</span>
        </div>
        <div className="flex items-baseline justify-between border-t border-border pt-2">
          <span className="font-semibold">Prejuízo</span>
          <span className="tabular text-lg font-semibold text-danger">−{formatBRL(10300)}</span>
        </div>
        <p className="text-xs text-muted">Fica na XP Investimentos · restam 50 × {formatBRL(1603)}</p>
      </div>
    </Dialog>
  );
}

/** 2 — Provento: dividendos, JCP, juros… entra na conta da corretora. */
export function ProtoIncome() {
  return (
    <Dialog title="Lançar provento" action="Lançar">
      <Field label="Tipo">
        <SegmentedControl
          fullWidth
          value="dividend"
          onChange={() => undefined}
          options={[
            { value: 'dividend', label: 'Dividendos' },
            { value: 'jcp', label: 'JCP' },
            { value: 'interest', label: 'Juros' },
            { value: 'other', label: 'Rendimento' },
          ]}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Ativo">
          <Select defaultValue="hglg">
            <option value="hglg">HGLG11</option>
          </Select>
        </Field>
        <Field label="Valor recebido">
          <MoneyInput value={11000} onChange={() => undefined} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Data">
          <DateInput defaultValue="2026-11-14" />
        </Field>
        <Field label="Recebido em">
          <Select defaultValue="xp">
            <option value="xp">XP Investimentos</option>
          </Select>
        </Field>
      </div>
    </Dialog>
  );
}

/** 3 — Página: novos botões, saldo disponível nas corretoras, resultado e proventos. */
export function ProtoPage() {
  return (
    <div className="flex w-[1100px] flex-col gap-5">
      <PageHeader
        overline="Patrimônio"
        title="Investimentos"
        actions={
          <div className="flex gap-2">
            <Button variant="outline">Corretoras</Button>
            <Button variant="outline">
              <HandCoins /> Provento
            </Button>
            <Button>
              <Plus /> Nova compra
            </Button>
          </div>
        }
      />
      <div className="grid grid-cols-4 gap-3">
        <MiniStat label="Total investido" value={formatBRL(1903490)} tone="brand" />
        <MiniStat label="Disponível nas corretoras" value={formatBRL(159000)} />
        <MiniStat label="Proventos no ano" value={formatBRL(48700)} tone="success" />
        <MiniStat label="Resultado de vendas" value={`−${formatBRL(10300)}`} tone="danger" />
      </div>
      <Card className="p-5">
        <p className="text-title font-semibold tracking-tight">Disponível nas corretoras</p>
        <ul className="mt-3 flex flex-col divide-y divide-border">
          {[
            { name: 'XP Investimentos', bank: 'xp' as const, color: '#111111', cash: 150000 + 11000 - 2000 },
          ].map((b) => (
            <li key={b.name} className="flex items-center gap-3 py-3">
              <BankLogo bank={b.bank} color={b.color} size="sm" />
              <span className="flex-1 text-label font-medium">{b.name}</span>
              <span className="tabular font-semibold">{formatBRL(b.cash)}</span>
              <Button variant="outline" size="sm">
                <ArrowLeftRight /> Transferir
              </Button>
              <Button variant="outline" size="sm">
                <ShoppingCart /> Aplicar
              </Button>
            </li>
          ))}
        </ul>
      </Card>
      <Card className="overflow-hidden">
        <div className="border-b border-border p-4">
          <p className="text-title font-semibold tracking-tight">Carteira</p>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-muted text-left text-2xs font-semibold tracking-wide text-muted uppercase">
              <th className="px-4 py-2.5">Ativo</th>
              <th className="px-3 py-2.5 text-right">Quantidade</th>
              <th className="px-3 py-2.5 text-right">Preço médio</th>
              <th className="px-3 py-2.5 text-right">Investido</th>
              <th className="px-3 py-2.5 text-right">Proventos</th>
              <th className="px-3 py-2.5 text-right">Resultado vendas</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {[
              { t: 'PETR4', q: '50', pm: 1603, inv: 80150, prov: 0, res: -10300 },
              { t: 'HGLG11', q: '10', pm: 16000, inv: 160000, prov: 11000, res: 0 },
            ].map((r) => (
              <tr key={r.t} className="border-b border-border last:border-0">
                <td className="px-4 py-3 font-semibold">{r.t}</td>
                <td className="tabular px-3 py-3 text-right">{r.q}</td>
                <td className="tabular px-3 py-3 text-right">{formatBRL(r.pm)}</td>
                <td className="tabular px-3 py-3 text-right font-semibold">{formatBRL(r.inv)}</td>
                <td className="tabular px-3 py-3 text-right text-success">{r.prov ? formatBRL(r.prov) : '—'}</td>
                <td className={`tabular px-3 py-3 text-right ${r.res < 0 ? 'text-danger' : 'text-muted'}`}>
                  {r.res ? `−${formatBRL(-r.res)}` : '—'}
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon-sm" title="Comprar mais">
                      <ShoppingCart />
                    </Button>
                    <Button variant="ghost" size="icon-sm" title="Vender">
                      <ArrowDownToLine />
                    </Button>
                    <Button variant="ghost" size="icon-sm" title="Provento">
                      <HandCoins />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card className="p-5">
        <p className="text-title font-semibold tracking-tight">No Extrato da XP Investimentos</p>
        <ul className="mt-3 flex flex-col divide-y divide-border text-label">
          {[
            { d: '26/11', t: 'Venda PETR4 (100 × R$ 15,00) · prejuízo', v: -10300, b: 'Prejuízo em investimentos' },
            { d: '14/11', t: 'Dividendos HGLG11', v: 11000, b: 'Proventos' },
          ].map((r) => (
            <li key={r.t} className="flex items-center gap-3 py-2.5">
              <span className="w-14 tabular text-muted">{r.d}</span>
              <span className="flex-1">{r.t}</span>
              <Badge tone={r.v < 0 ? 'danger' : 'success'}>
                {r.v < 0 ? <TrendingDown className="size-3" /> : <HandCoins className="size-3" />} {r.b}
              </Badge>
              <span className={`w-28 text-right tabular font-semibold ${r.v < 0 ? 'text-danger' : 'text-success'}`}>
                {r.v < 0 ? '−' : '+'}
                {formatBRL(Math.abs(r.v))}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

export default function ProtoVendas() {
  return (
    <div className="flex flex-col gap-10 bg-bg p-10">
      <div id="p1" className="w-fit"><ProtoSell /></div>
      <div id="p2" className="w-fit"><ProtoIncome /></div>
      <div id="p3" className="w-fit"><ProtoPage /></div>
    </div>
  );
}
