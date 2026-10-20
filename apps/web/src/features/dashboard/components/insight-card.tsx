import { useState } from 'react';
import { Link } from 'react-router';
import { ArrowUpRight, ChevronLeft, ChevronRight, Lightbulb, Sparkles } from 'lucide-react';
import type { Insight, InsightKind } from '@effinance/shared';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

export const INSIGHT_LABELS: Record<InsightKind, string> = {
  opportunity: 'Oportunidade',
  warning: 'Atenção',
  achievement: 'Conquista',
  info: 'Dica',
};

/** Navy gradient card with a glass inner card (Graniq "NIQ IA — Insights"). */
export function InsightCard({ insights, loading, className }: { insights: Insight[] | undefined; loading?: boolean; className?: string }) {
  const [index, setIndex] = useState(0);
  const list = insights ?? [];
  const current = list[Math.min(index, Math.max(0, list.length - 1))];
  return (
    <div className={cn('relative flex flex-col overflow-hidden rounded-xl bg-gradient-to-br from-hero-from via-hero-via to-hero-to p-5 text-white shadow-sm', className)}>
      <div className="pointer-events-none absolute -top-20 -right-16 size-56 rounded-full bg-white/5" aria-hidden />
      <div className="relative flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/20">
          <Sparkles className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="text-[15px] font-semibold">Insights</p>
          <p className="text-xs text-white/65">{list.length ? `${list.length} análise(s) do período` : 'Análises automáticas'}</p>
        </div>
        {list.length > 1 ? (
          <div className="ml-auto flex gap-1">
            <button type="button" onClick={() => setIndex((i) => (i - 1 + list.length) % list.length)} className="flex size-7 items-center justify-center rounded-full bg-white/10 hover:bg-white/20" aria-label="Insight anterior">
              <ChevronLeft className="size-4" />
            </button>
            <button type="button" onClick={() => setIndex((i) => (i + 1) % list.length)} className="flex size-7 items-center justify-center rounded-full bg-white/10 hover:bg-white/20" aria-label="Próximo insight">
              <ChevronRight className="size-4" />
            </button>
          </div>
        ) : null}
      </div>
      <div className="relative mt-4 flex-1 rounded-lg border border-white/12 bg-white/8 p-4 backdrop-blur-sm" aria-live="polite">
        {loading ? (
          <Skeleton className="h-16 bg-white/10" />
        ) : current ? (
          <>
            <div className="flex items-center justify-between">
              <span className="eyebrow inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[10px] text-white/90">
                <Lightbulb className="size-3" /> {INSIGHT_LABELS[current.kind]}
              </span>
              {current.href ? (
                <Link to={current.href} className="text-white/70 hover:text-white" aria-label="Abrir análise">
                  <ArrowUpRight className="size-4" />
                </Link>
              ) : null}
            </div>
            <p className="mt-2.5 text-sm font-semibold">{current.title}</p>
            <p className="mt-1 text-xs leading-relaxed text-white/70">{current.description}</p>
          </>
        ) : (
          <p className="text-sm leading-relaxed text-white/80">
            Ainda não tenho dados suficientes para gerar insights. Assim que houver movimentações, trago análises e recomendações concretas.
          </p>
        )}
      </div>
      {list.length > 1 ? (
        <div className="relative mt-3 flex justify-center gap-1.5">
          {list.map((_, i) => (
            <span key={i} className={cn('h-1.5 rounded-full transition-all', i === index ? 'w-4 bg-white' : 'w-1.5 bg-white/30')} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
