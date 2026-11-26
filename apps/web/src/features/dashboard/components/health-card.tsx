import type { HealthScore } from '@effinance/shared';
import { Card, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Gauge } from '@/components/charts/gauge';
import { ProgressBar } from '@/components/ui/progress-bar';
import { cn } from '@/lib/utils';

const TONE = { Crítica: 'danger', Atenção: 'warning', Saudável: 'success', Excelente: 'success' } as const;

export function HealthCard({ health, loading, className }: { health: HealthScore | undefined; loading: boolean; className?: string }) {
  return (
    <Card className={cn('flex flex-col p-5', className)}>
      <CardHeader
        title="Saúde financeira"
        info="Pontuação de 0 a 1000 calculada a partir da taxa de economia, contas em atraso, uso do cartão, reserva e metas."
        action={health ? <Badge tone={TONE[health.label]}>{health.label}</Badge> : null}
      />
      {loading || !health ? (
        <Skeleton className="mx-auto mt-4 h-28 w-48" />
      ) : (
        // Fills a taller card (next to a long list) with the gauge centered, not a gap below it.
        <div className="flex flex-1 flex-col justify-center">
          <div className="mt-3 flex justify-center">
            <Gauge score={health.score} size={190} />
          </div>
          <details className="group mt-1">
            <summary className="cursor-pointer list-none text-center text-xs font-semibold text-brand-text hover:underline">
              Ver fatores
            </summary>
            <ul className="mt-3 flex flex-col gap-2.5">
              {health.factors.map((f) => (
                <li key={f.label}>
                  <div className="flex justify-between text-xs">
                    <span className="font-medium">{f.label}</span>
                    <span className="tabular text-muted">
                      {f.score}/{f.max}
                    </span>
                  </div>
                  <ProgressBar value={f.max ? f.score / f.max : 0} size="sm" className="mt-1" tone={f.score / (f.max || 1) < 0.4 ? 'danger' : 'brand'} />
                  <p className="mt-1 text-2xs text-muted">{f.hint}</p>
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </Card>
  );
}
