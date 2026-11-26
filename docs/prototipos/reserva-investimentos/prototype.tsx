// PROTÓTIPO (dados fictícios) — Reserva de emergência acompanhada pelos investimentos.
import { ArrowRight, Pencil, Plus, ShieldCheck } from 'lucide-react';
import { formatBRL } from '@effinance/shared';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { MoneyInput } from '@/components/ui/money-input';
import { DateInput } from '@/components/ui/date-input';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Switch } from '@/components/ui/switch';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { CategoryIcon } from '@/components/ui/category-icon';

const ASSETS = [
  { ticker: 'Tesouro Selic 2029', broker: 'XP Investimentos', type: 'Renda fixa', value: 900000, on: true },
  { ticker: 'CDB Liquidez diária', broker: 'Carteira', type: 'Renda fixa', value: 715000, on: true },
  { ticker: 'Tesouro IPCA+ 2045', broker: 'XP Investimentos', type: 'Renda fixa', value: 420000, on: false },
  { ticker: 'PETR4', broker: 'XP Investimentos', type: 'Ação', value: 365000, on: false },
];
const reserve = ASSETS.filter((a) => a.on).reduce((s, a) => s + a.value, 0);
const target = 3000000;

/** 1 — Card da meta na página Metas. */
export function ProtoGoalCard() {
  return (
    <Card className="w-[440px] p-5">
      <div className="flex items-center gap-3">
        <CategoryIcon icon="shield" color="#152B61" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Reserva de emergência</p>
          <p className="text-xs text-muted">Até 30/06/2027 · 216 dias</p>
        </div>
        <Badge tone="brand">
          <ShieldCheck className="size-3" /> Investimentos
        </Badge>
      </div>
      <div className="mt-4 rounded-xl bg-surface-muted p-4">
        <div className="flex items-baseline justify-between">
          <span className="tabular text-xl font-semibold">{formatBRL(reserve)}</span>
          <span className="text-sm font-semibold text-brand-text">{Math.round((reserve / target) * 100)}%</span>
        </div>
        <ProgressBar value={reserve / target} color="#152B61" className="mt-2" />
        <p className="mt-2 text-xs text-muted tabular">Faltam {formatBRL(target - reserve)} · meta {formatBRL(target)}</p>
      </div>
      <ul className="mt-4 flex flex-col gap-2">
        {ASSETS.filter((a) => a.on).map((a) => (
          <li key={a.ticker} className="flex items-center justify-between text-label">
            <span className="min-w-0 truncate">
              {a.ticker} <span className="text-xs text-muted">· {a.broker}</span>
            </span>
            <span className="tabular font-medium">{formatBRL(a.value)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
        <span className="text-xs text-muted">Guarde {formatBRL(300000)}/mês</span>
        <Button size="sm">
          <Plus /> Aplicar
        </Button>
      </div>
    </Card>
  );
}

/** 2 — Formulário da meta: acompanhar pelos investimentos. */
export function ProtoGoalSheet() {
  return (
    <div className="flex w-[520px] flex-col rounded-2xl border border-border bg-surface shadow-lg">
      <div className="border-b border-border p-6">
        <h2 className="text-heading font-semibold tracking-tight">Editar meta</h2>
      </div>
      <div className="flex flex-col gap-5 p-6">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nome">
            <Input defaultValue="Reserva de emergência" />
          </Field>
          <Field label="Valor da meta">
            <MoneyInput value={target} onChange={() => undefined} />
          </Field>
        </div>
        <Field label="Acompanhar por">
          <SegmentedControl
            fullWidth
            value="investments"
            onChange={() => undefined}
            options={[
              { value: 'manual', label: 'Aportes' },
              { value: 'investments', label: 'Investimentos' },
            ]}
          />
        </Field>
        <div className="flex items-center justify-between rounded-xl border border-border p-4">
          <span className="text-label font-medium">Renda fixa entra automaticamente</span>
          <Switch defaultChecked />
        </div>
        <div>
          <p className="eyebrow mb-2 text-muted">Ativos na reserva</p>
          <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
            {ASSETS.map((a) => (
              <li key={a.ticker} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-label font-medium">{a.ticker}</p>
                  <p className="text-xs text-muted">
                    {a.type} · {a.broker}
                  </p>
                </div>
                <span className="tabular text-label text-muted">{formatBRL(a.value)}</span>
                <Switch defaultChecked={a.on} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/** 3 — Aplicar (compra de renda fixa) a partir da meta. */
export function ProtoApply() {
  return (
    <div className="flex w-[520px] flex-col rounded-2xl border border-border bg-surface shadow-lg">
      <div className="border-b border-border p-6">
        <h2 className="text-heading font-semibold tracking-tight">Nova compra</h2>
      </div>
      <div className="flex flex-col gap-5 p-6">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Ativo">
            <Input defaultValue="Tesouro Selic 2029" />
          </Field>
          <Field label="Tipo">
            <Select defaultValue="fixed">
              <option value="fixed">Renda fixa</option>
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Valor aplicado">
            <MoneyInput value={300000} onChange={() => undefined} />
          </Field>
          <Field label="Data">
            <DateInput defaultValue="2026-11-26" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Corretora">
            <Select defaultValue="xp">
              <option value="xp">XP Investimentos</option>
            </Select>
          </Field>
          <Field label="Pago com">
            <Select defaultValue="itau">
              <option value="itau">Itaú</option>
            </Select>
          </Field>
        </div>
        <div className="flex items-center justify-between rounded-xl border border-border p-4">
          <span className="flex items-center gap-2 text-label font-medium">
            <ShieldCheck className="size-4 text-brand-text" /> Contar na Reserva de emergência
          </span>
          <Switch defaultChecked />
        </div>
        <div className="flex flex-col gap-2 rounded-xl bg-surface-muted p-4 text-label">
          <div className="flex items-baseline justify-between">
            <span className="font-medium text-muted">Total</span>
            <span className="tabular text-lg font-semibold">{formatBRL(300000)}</span>
          </div>
          <p className="flex items-center gap-1.5 border-t border-border pt-2">
            Aplicação: Itaú <ArrowRight className="size-3.5 text-subtle" /> XP Investimentos
          </p>
          <p className="text-brand-text">Reserva: {formatBRL(reserve)} → {formatBRL(reserve + 300000)}</p>
        </div>
      </div>
    </div>
  );
}

/** 4 — Carteira com o selo Reserva. */
export function ProtoPortfolio() {
  return (
    <Card className="w-[760px] p-5">
      <div className="mb-3 flex items-center justify-between">
        <p className="font-semibold">Carteira</p>
        <Badge tone="brand">
          <ShieldCheck className="size-3" /> Reserva {formatBRL(reserve)} de {formatBRL(target)}
        </Badge>
      </div>
      <table className="w-full text-label">
        <thead className="text-left text-xs text-muted">
          <tr>
            <th className="py-2 font-medium">Ativo</th>
            <th className="font-medium">Tipo</th>
            <th className="font-medium">Corretora</th>
            <th className="text-right font-medium">Investido</th>
            <th />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {ASSETS.map((a) => (
            <tr key={a.ticker}>
              <td className="py-3 font-medium">
                {a.ticker}
                {a.on ? (
                  <Badge tone="brand" className="ml-2">
                    <ShieldCheck className="size-3" /> Reserva
                  </Badge>
                ) : null}
              </td>
              <td className="text-muted">{a.type}</td>
              <td className="text-muted">{a.broker}</td>
              <td className="tabular text-right font-medium">{formatBRL(a.value)}</td>
              <td className="w-10 text-right">
                <Pencil className="ml-auto size-4 text-subtle" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

export default function ProtoReserva() {
  return (
    <div className="flex flex-col gap-10 bg-bg p-10">
      <div id="p1"><ProtoGoalCard /></div>
      <div id="p2"><ProtoGoalSheet /></div>
      <div id="p3"><ProtoApply /></div>
      <div id="p4"><ProtoPortfolio /></div>
    </div>
  );
}
