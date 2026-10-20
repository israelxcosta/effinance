import { CircleCheck } from 'lucide-react';
import { diffInDays, formatBRL, formatDateBR, formatPercent, todayISO, type Goal } from '@effinance/shared';
import { CategoryIcon } from '@/components/ui/category-icon';
import { ProgressBar } from '@/components/ui/progress-bar';

/** Compact goal progress used by the dashboard and the goals page. */
export function GoalProgress({ goal }: { goal: Goal }) {
  return (
    <div className="flex items-center gap-3">
      <CategoryIcon icon={goal.icon} color={goal.color} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2 text-[13px]">
          <span className="truncate font-semibold">{goal.name}</span>
          <span className="shrink-0 text-xs text-muted">{formatPercent(goal.progress, 0)}</span>
        </div>
        <ProgressBar value={goal.progress} color={goal.color} size="sm" className="mt-1.5" />
        <p className="mt-1 text-[11px] text-muted tabular">
          {formatBRL(goal.currentAmount)} de {formatBRL(goal.targetAmount)}
        </p>
      </div>
    </div>
  );
}

export function GoalDeadline({ goal }: { goal: Goal }) {
  if (goal.completed)
    return (
      <span className="flex items-center gap-1 text-xs font-semibold text-success">
        <CircleCheck className="size-3.5" /> Meta atingida
      </span>
    );
  if (!goal.deadline) return <span className="text-xs text-muted">Sem prazo definido</span>;
  const days = diffInDays(goal.deadline, todayISO());
  if (days < 0) return <span className="text-xs font-semibold text-danger">Prazo encerrado em {formatDateBR(goal.deadline)}</span>;
  return (
    <span className="text-xs text-muted">
      Até {formatDateBR(goal.deadline)} · {days} dias
    </span>
  );
}
