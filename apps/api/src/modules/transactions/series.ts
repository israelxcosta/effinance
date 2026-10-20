// Recurring series: building occurrences and materializing open-ended series on demand.

import { and, eq, inArray, isNotNull, lte } from 'drizzle-orm';
import {
  addMonths,
  getInvoiceForPurchase,
  maxISO,
  minISO,
  occurrenceDate,
  type Frequency,
  type ISODate,
} from '@effinance/shared';
import type { DbExecutor } from '../../db/client';
import {
  creditCards,
  recurrences,
  transactions,
  type CreditCardRow,
  type NewTransactionRow,
  type RecurrenceRow,
  type RecurrenceTemplate,
} from '../../db/schema';
import { today } from '../../lib/clock';

/** Open-ended series are always generated at least this far ahead… */
export const MIN_HORIZON_MONTHS = 12;
/** …and never beyond this, whatever period is requested. */
export const MAX_HORIZON_MONTHS = 60;

export function materializationHorizon(until?: ISODate): ISODate {
  const now = today();
  const min = addMonths(now, MIN_HORIZON_MONTHS);
  const max = addMonths(now, MAX_HORIZON_MONTHS);
  return minISO(maxISO(until ?? min, min), max);
}

export function invoiceMonthFor(card: CreditCardRow | null | undefined, date: ISODate): string | null {
  return card ? getInvoiceForPurchase(date, card.closingDay, card.dueDay).month : null;
}

export function occurrenceRow(
  workspaceId: string,
  series: Pick<RecurrenceRow, 'id' | 'kind' | 'frequency'>,
  template: RecurrenceTemplate,
  index: number,
  date: ISODate,
  card: CreditCardRow | null,
): NewTransactionRow {
  return {
    workspaceId,
    type: template.type,
    description: template.description,
    amount: template.amount,
    date,
    paid: false,
    paidAt: null,
    accountId: template.accountId,
    creditCardId: template.creditCardId,
    invoiceMonth: invoiceMonthFor(card, date),
    categoryId: template.categoryId,
    subcategoryId: template.subcategoryId,
    contactId: template.contactId,
    paymentMethod: template.paymentMethod,
    notes: template.notes,
    splitGroupId: template.splitGroupId ?? null,
    recurrenceId: series.id,
    recurrenceKind: series.kind,
    frequency: series.frequency,
    occurrenceIndex: index,
  };
}

/** Generates the missing occurrences of one open-ended series up to `until`. */
export async function materializeSeries(
  db: DbExecutor,
  series: RecurrenceRow,
  until: ISODate,
  card?: CreditCardRow | null,
): Promise<void> {
  if (!series.nextDate || series.nextDate > until) return;

  let resolvedCard = card ?? null;
  if (card === undefined && series.template.creditCardId) {
    const [row] = await db.select().from(creditCards).where(eq(creditCards.id, series.template.creditCardId));
    resolvedCard = row ?? null;
  }

  const rows: NewTransactionRow[] = [];
  let index = series.nextIndex;
  let date: ISODate = occurrenceDate(series.startDate, series.frequency as Frequency, index);
  const max = series.totalOccurrences ?? Number.POSITIVE_INFINITY;
  while (index < max && date <= until && rows.length < 1000) {
    rows.push(occurrenceRow(series.workspaceId, series, series.template, index, date, resolvedCard));
    index += 1;
    date = occurrenceDate(series.startDate, series.frequency as Frequency, index);
  }

  if (rows.length > 0) {
    await db.insert(transactions).values(rows).onConflictDoNothing();
  }
  await db
    .update(recurrences)
    .set({ nextIndex: index, nextDate: index < max ? date : null })
    .where(eq(recurrences.id, series.id));
}

/**
 * Makes sure every open-ended series of the workspace has rows up to the horizon derived from `until`.
 * Cheap when nothing is pending (single indexed query).
 */
export async function ensureMaterialized(db: DbExecutor, workspaceId: string, until?: ISODate): Promise<void> {
  const limit = materializationHorizon(until);
  const pending = await db
    .select()
    .from(recurrences)
    .where(and(eq(recurrences.workspaceId, workspaceId), isNotNull(recurrences.nextDate), lte(recurrences.nextDate, limit)));
  if (pending.length === 0) return;

  const cardIds = [...new Set(pending.map((s) => s.template.creditCardId).filter((v): v is string => !!v))];
  const cards = cardIds.length
    ? await db.select().from(creditCards).where(inArray(creditCards.id, cardIds))
    : [];
  const cardMap = new Map(cards.map((c) => [c.id, c]));

  for (const series of pending) {
    const card = series.template.creditCardId ? (cardMap.get(series.template.creditCardId) ?? null) : null;
    await materializeSeries(db, series, limit, card);
  }
}
