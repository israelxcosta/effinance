import { useState } from 'react';
import { Ellipsis, Pencil, PiggyBank, Plus, Target, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { formatBRL, formatPercent, type Goal } from '@effinance/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CategoryIcon } from '@/components/ui/category-icon';
import { ConfirmDialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState, MiniStat, PageHeader } from '@/components/ui/misc';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { alpha, cn } from '@/lib/utils';
import { useDeleteGoal, useGoals } from '../api';
import { GoalSheet } from '../goal-sheet';
import { ContributionDialog } from '../contribution-dialog';
import { GoalDeadline } from '../goal-card';
import { useTone } from '@/lib/theme';
import { toastError } from '@/lib/notify';
import { usePermissions, WriteGate } from '@/features/auth/permissions';

export default function GoalsPage() {
  const readOnly = !usePermissions().canWrite;
  const goals = useGoals();
  const tone = useTone();
  const [sheet, setSheet] = useState<{ open: boolean; goal?: Goal | null }>({ open: false });
  const [contributing, setContributing] = useState<Goal | null>(null);
  const [toDelete, setToDelete] = useState<Goal | null>(null);
  const del = useDeleteGoal();

  const list = goals.data ?? [];
  const active = list.filter((g) => !g.archived);
  const saved = active.reduce((s, g) => s + g.currentAmount, 0);
  const target = active.reduce((s, g) => s + g.targetAmount, 0);
  const monthly = active.reduce((s, g) => s + (g.completed ? 0 : (g.monthlyNeeded ?? 0)), 0);
  const contributingGoal = contributing ? (list.find((g) => g.id === contributing.id) ?? contributing) : null;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        overline="Planejamento"
        title="Metas"
        description="Trace seu caminho: defina objetivos, guarde dinheiro e acompanhe o progresso."
        actions={<WriteGate><Button onClick={() => setSheet({ open: true, goal: null })}><Plus /> Nova meta</Button></WriteGate>}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniStat label="Já conquistado" value={formatBRL(saved)} tone="success" />
        <MiniStat label="Objetivo total" value={formatBRL(target)} />
        <MiniStat label="Progresso geral" value={formatPercent(target ? saved / target : 0, 0)} tone="brand" />
        <MiniStat label="Guardar por mês" value={formatBRL(monthly)} hint="Para cumprir os prazos" />
      </div>

      {goals.isPending ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-56 rounded-xl" />)}
        </div>
      ) : goals.isError ? (
        <ErrorState error={goals.error} onRetry={() => goals.refetch()} />
      ) : list.length === 0 ? (
        <Card className="p-5">
          <EmptyState
            icon={<Target />}
            title="Você ainda não tem metas ativas"
            description="Metas ajudam a priorizar seu plano financeiro: reserva de emergência, viagem, troca de carro…"
            action={<WriteGate><Button onClick={() => setSheet({ open: true, goal: null })}>Criar primeira meta</Button></WriteGate>}
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map((g) => (
            <Card key={g.id} className={cn('flex flex-col gap-4 overflow-hidden p-5', g.archived && 'opacity-60')}>
              <div className="flex items-start gap-3">
                <CategoryIcon icon={g.icon} color={g.color} size="lg" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold">{g.name}</p>
                  <GoalDeadline goal={g} />
                </div>
                {g.completed ? <Badge tone="success">Concluída</Badge> : null}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button type="button" className="flex size-8 items-center justify-center rounded-md text-muted hover:bg-bg-subtle hover:text-fg" aria-label={`Ações de ${g.name}`}>
                      <Ellipsis className="size-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem icon={<PiggyBank />} disabled={readOnly} onSelect={() => setContributing(g)}>Guardar / retirar</DropdownMenuItem>
                    <DropdownMenuItem icon={<Pencil />} disabled={readOnly} onSelect={() => setSheet({ open: true, goal: g })}>Editar</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem icon={<Trash2 />} tone="danger" disabled={readOnly} onSelect={() => setToDelete(g)}>Excluir</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="rounded-lg p-4" style={{ background: `linear-gradient(135deg, ${alpha(tone(g.color), 0.1)}, ${alpha(tone(g.color), 0.03)})` }}>
                <div className="flex items-end justify-between gap-2">
                  <div>
                    <p className="text-xs text-muted">Conquistado</p>
                    <p className="tabular text-xl font-semibold tracking-tight">{formatBRL(g.currentAmount)}</p>
                  </div>
                  <p className="text-2xl font-bold tracking-tight" style={{ color: tone(g.color) }}>{formatPercent(g.progress, 0)}</p>
                </div>
                <ProgressBar value={g.progress} color={g.color} className="mt-3" label={`Progresso de ${g.name}`} />
                <div className="mt-2 flex justify-between text-[11px] text-muted">
                  <span>Faltam {formatBRL(Math.max(0, g.targetAmount - g.currentAmount))}</span>
                  <span>Meta {formatBRL(g.targetAmount)}</span>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted">
                  {g.monthlyNeeded && !g.completed ? (
                    <>Guarde <span className="font-semibold text-fg">{formatBRL(g.monthlyNeeded)}</span>/mês</>
                  ) : g.completed ? 'Parabéns! 🎉' : 'Defina um prazo para ver o valor mensal'}
                </p>
                <WriteGate>
                  <Button size="sm" variant="soft" onClick={() => setContributing(g)}>
                    <PiggyBank /> Guardar
                  </Button>
                </WriteGate>
              </div>
            </Card>
          ))}
        </div>
      )}

      <GoalSheet open={sheet.open} goal={sheet.goal} onOpenChange={(o) => setSheet((s) => ({ ...s, open: o }))} />
      <ContributionDialog goal={contributingGoal} onClose={() => setContributing(null)} />
      <ConfirmDialog
        open={Boolean(toDelete)}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Excluir meta?"
        description={`A meta "${toDelete?.name}" e seu histórico de aportes serão excluídos.`}
        confirmLabel="Excluir"
        loading={del.isPending}
        onConfirm={async () => {
          try {
            await del.mutateAsync(toDelete!.id);
            toast.success('Meta excluída');
            setToDelete(null);
          } catch (error) {
            toastError(error);
          }
        }}
      />
    </div>
  );
}
