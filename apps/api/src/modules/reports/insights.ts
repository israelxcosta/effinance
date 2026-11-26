// Rule-based insights (pt-BR) shared by the dashboard and the overview report.
// Texts stay short (title ~1 line, description up to 2 lines in the dashboard card). Overdue bills are
// not an insight: the dashboard shows them in their own red card.

import { formatBRL, formatPercent, type Goal, type Insight } from '@effinance/shared';

export interface CategoryTotal {
  name: string;
  amount: number;
}

export interface InsightContext {
  income: number;
  expense: number;
  previousExpenseByCategory: Map<string, CategoryTotal>;
  expenseByCategory: Map<string, CategoryTotal>;
  cards?: { name: string; usedLimit: number; limit: number }[];
  goals?: Goal[];
  fixedExpense?: number;
  upcomingWeek?: { count: number; amount: number };
  /** Label for the compared period, e.g. "mês anterior". */
  previousLabel: string;
}

const MIN_RELEVANT_CHANGE = 5_000; // R$ 50,00
const MIN_RELEVANT_RATIO = 0.15;

export function buildInsights(ctx: InsightContext): Insight[] {
  const out: { priority: number; insight: Insight }[] = [];
  const push = (priority: number, insight: Insight) => out.push({ priority, insight });

  const net = ctx.income - ctx.expense;
  const savingsRate = ctx.income > 0 ? net / ctx.income : null;

  if (ctx.income > 0 && net < 0) {
    push(95, {
      kind: 'warning',
      title: 'Despesas acima das receitas',
      description: `Gastou ${formatBRL(-net)} a mais do que recebeu.`,
      href: '/relatorios?tab=fluxo',
    });
  } else if (savingsRate !== null && savingsRate >= 0.2) {
    push(60, {
      kind: 'achievement',
      title: 'Ótima taxa de economia',
      description: `Você guardou ${formatPercent(savingsRate, 0)} da renda. Continue assim!`,
    });
  } else if (savingsRate !== null && savingsRate >= 0 && savingsRate < 0.1) {
    push(70, {
      kind: 'opportunity',
      title: 'Espaço para economizar mais',
      description: `Guardou ${formatPercent(savingsRate, 0)} da renda; o ideal é 20%.`,
      href: '/relatorios?tab=categorias',
    });
  }

  // Biggest increase / decrease by category vs the previous period.
  let worst: { name: string; cur: number; prev: number; ratio: number } | null = null;
  let best: { name: string; cur: number; prev: number; ratio: number } | null = null;
  const keys = new Set([...ctx.expenseByCategory.keys(), ...ctx.previousExpenseByCategory.keys()]);
  for (const key of keys) {
    const cur = ctx.expenseByCategory.get(key)?.amount ?? 0;
    const prevEntry = ctx.previousExpenseByCategory.get(key);
    const prev = prevEntry?.amount ?? 0;
    const name = ctx.expenseByCategory.get(key)?.name ?? prevEntry?.name ?? 'Sem categoria';
    if (prev <= 0) continue;
    const ratio = (cur - prev) / prev;
    if (cur - prev >= MIN_RELEVANT_CHANGE && ratio >= MIN_RELEVANT_RATIO && (!worst || cur - prev > worst.cur - worst.prev)) {
      worst = { name, cur, prev, ratio };
    }
    if (prev - cur >= MIN_RELEVANT_CHANGE && -ratio >= MIN_RELEVANT_RATIO && (!best || prev - cur > best.prev - best.cur)) {
      best = { name, cur, prev, ratio };
    }
  }
  if (worst) {
    push(80, {
      kind: 'warning',
      title: `${worst.name} subiu ${formatPercent(worst.ratio, 0)}`,
      description: `${formatBRL(worst.cur)} contra ${formatBRL(worst.prev)} no ${ctx.previousLabel}.`,
      href: '/relatorios?tab=comparacao',
    });
  }
  if (best) {
    push(65, {
      kind: 'achievement',
      title: `${best.name} caiu ${formatPercent(-best.ratio, 0)}`,
      description: `Economia de ${formatBRL(best.prev - best.cur)} sobre o ${ctx.previousLabel}.`,
    });
  }

  for (const card of ctx.cards ?? []) {
    if (card.limit <= 0) continue;
    const usage = card.usedLimit / card.limit;
    if (usage >= 0.7) {
      push(85, {
        kind: 'warning',
        title: `Limite do ${card.name} em ${formatPercent(usage, 0)}`,
        description: `Restam ${formatBRL(Math.max(0, card.limit - card.usedLimit))}. Evite novos parcelamentos.`,
        href: '/cartoes',
      });
    }
  }

  const activeGoals = (ctx.goals ?? []).filter((g) => !g.archived);
  const completed = activeGoals.find((g) => g.completed);
  if (completed) {
    push(55, {
      kind: 'achievement',
      title: `Meta "${completed.name}" concluída! 🎉`,
      description: `Você chegou a ${formatBRL(completed.targetAmount)}. Hora do próximo objetivo.`,
      href: '/metas',
    });
  }
  const closest = activeGoals
    .filter((g) => !g.completed && g.progress >= 0.4)
    .sort((a, b) => b.progress - a.progress)[0];
  if (closest) {
    const remaining = Math.max(0, closest.targetAmount - closest.currentAmount);
    push(58, {
      kind: 'opportunity',
      title: `Meta "${closest.name}" em ${formatPercent(closest.progress, 0)}`,
      description:
        `Faltam ${formatBRL(remaining)}.` +
        (closest.monthlyNeeded ? ` Guarde ${formatBRL(closest.monthlyNeeded)}/mês para o prazo.` : ''),
      href: '/metas',
    });
  }

  if (ctx.fixedExpense && ctx.income > 0) {
    const share = ctx.fixedExpense / ctx.income;
    if (share >= 0.5) {
      push(50, {
        kind: 'info',
        title: `Fixos levam ${formatPercent(share, 0)} da renda`,
        description: 'O ideal é ficar abaixo de 50% para ter folga.',
        href: '/contas-a-pagar',
      });
    }
  }

  const top = [...ctx.expenseByCategory.values()].sort((a, b) => b.amount - a.amount)[0];
  if (top && ctx.expense > 0 && top.amount / ctx.expense >= 0.35) {
    push(45, {
      kind: 'info',
      title: `${top.name}: ${formatPercent(top.amount / ctx.expense, 0)} das despesas`,
      description: `${formatBRL(top.amount)} no período. Veja se dá para reduzir.`,
      href: '/relatorios?tab=categorias',
    });
  }

  if (ctx.upcomingWeek && ctx.upcomingWeek.count > 0) {
    push(75, {
      kind: 'info',
      title:
        ctx.upcomingWeek.count === 1
          ? '1 conta vence em 7 dias'
          : `${ctx.upcomingWeek.count} contas vencem em 7 dias`,
      description: `Total de ${formatBRL(ctx.upcomingWeek.amount)}. Confira o saldo para pagar.`,
      href: '/contas-a-pagar',
    });
  }

  return out
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 6)
    .map((o) => o.insight);
}
