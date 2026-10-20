import type { ReactNode } from 'react';
import { ArrowDown, ArrowRight, ChartLine, CreditCard, Landmark, Receipt, Target, Wallet } from 'lucide-react';

const NODES = [
  { icon: Landmark, title: 'Contas', text: 'Saldos e carteiras' },
  { icon: CreditCard, title: 'Cartões', text: 'Faturas e limites' },
  { icon: Receipt, title: 'A pagar', text: 'Vencimentos em dia' },
  { icon: Wallet, title: 'A receber', text: 'Entradas previstas' },
  { icon: Target, title: 'Metas', text: 'Seu próximo passo' },
  { icon: ChartLine, title: 'Relatórios', text: 'Decida com contexto' },
];

export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle: string; children: ReactNode; footer: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <span className="text-lg font-extrabold tracking-tight">Effinance</span>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          <h1 className="text-[28px] font-semibold tracking-tight">{title}</h1>
          <p className="mt-1.5 text-sm text-muted">{subtitle}</p>
          <div className="mt-8">{children}</div>
          <div className="mt-6 text-center text-sm text-muted">{footer}</div>
        </div>
        <p className="text-xs text-subtle">© {new Date().getFullYear()} Effinance</p>
      </div>
      <div className="relative hidden overflow-hidden border-l border-border bg-surface-muted lg:block">
        <div className="dot-grid absolute inset-0 opacity-60" aria-hidden />
        <div className="relative flex h-full flex-col justify-center px-14 py-12">
          <p className="eyebrow text-brand-text">Tudo se conecta</p>
          <h2 className="mt-3 max-w-md text-[28px] leading-tight font-semibold tracking-tight">
            Conheça seu dinheiro. <span className="text-muted">Organize cada parte e decida com contexto.</span>
          </h2>
          <div className="mt-10 grid max-w-md grid-cols-2 gap-x-10 gap-y-8">
            {NODES.map((n, i) => (
              <div key={n.title} className="relative rounded-lg border border-brand-700/40 bg-surface p-3.5 shadow-xs">
                <div className="flex items-center gap-2.5">
                  <span className="flex size-8 items-center justify-center rounded-[10px] bg-primary-soft text-primary-soft-fg">
                    <n.icon className="size-4" />
                  </span>
                  <span className="text-sm font-semibold">{n.title}</span>
                </div>
                <p className="mt-2 text-xs text-muted">{n.text}</p>
                {i % 2 === 0 ? (
                  <ArrowRight className="absolute top-1/2 -right-8 size-4 -translate-y-1/2 text-brand-700" aria-hidden />
                ) : i < NODES.length - 1 ? (
                  <ArrowDown className="absolute -bottom-7 left-1/2 size-4 -translate-x-1/2 text-brand-700" aria-hidden />
                ) : null}
              </div>
            ))}
          </div>
          <div className="mt-12 max-w-md rounded-xl bg-gradient-to-br from-hero-from to-hero-to p-5 text-white shadow-lg">
            <span className="eyebrow rounded-full bg-white/10 px-2 py-1 text-[10px] text-white/90">Oportunidade</span>
            <p className="mt-3 text-[15px] font-semibold">Sua reserva avançou neste mês</p>
            <p className="mt-1 text-xs text-white/70">Acompanhe metas, projeções e insights automáticos sobre suas finanças.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
