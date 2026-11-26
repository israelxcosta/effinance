// How the Evolução matrix fits its card without a horizontal scrollbar.

export interface EvolutionLayout {
  /** Width of the category column, px. */
  categoryWidth: number;
  /** Average column (hidden on very narrow screens; Total always stays). */
  showAverage: boolean;
  /** Amounts with cents; without them when the columns get tight (export keeps cents). */
  cents: boolean;
  /** How many of the most recent periods are shown (all of them when they fit). */
  visible: number;
}

const AVERAGE = 96;
const TOTAL = 104;
const WITH_CENTS = 80; // "10.719,72" + padding
const WITHOUT_CENTS = 62; // "10.720" + padding

export function evolutionLayout(width: number, periods: number): EvolutionLayout {
  const categoryWidth = width >= 1100 ? 190 : width >= 720 ? 168 : 132;
  const showAverage = width >= 560;
  const room = Math.max(0, width - categoryWidth - TOTAL - (showAverage ? AVERAGE : 0));
  if (room / periods >= WITH_CENTS) return { categoryWidth, showAverage, cents: true, visible: periods };
  if (room / periods >= WITHOUT_CENTS) return { categoryWidth, showAverage, cents: false, visible: periods };
  return { categoryWidth, showAverage, cents: false, visible: Math.max(1, Math.min(periods, Math.floor(room / WITHOUT_CENTS))) };
}
