// Credit card invoice ("fatura") date rules.
//
// An invoice is identified by the month of its DUE date ('YYYY-MM').
// - Closing date of invoice M: day `closingDay` of M when dueDay > closingDay, otherwise of M-1.
// - A purchase belongs to the first invoice whose closing date is AFTER the purchase date
//   (purchases made on the closing day already fall into the next invoice — the "melhor dia").

import {
  addMonthKey,
  daysInMonth,
  monthKey,
  parseISODate,
  toISODate,
  type ISODate,
  type MonthKey,
} from './dates';
import type { InvoiceStatus } from '../constants';

function clampDay(key: MonthKey, day: number): ISODate {
  const { year, month } = parseISODate(`${key}-01`);
  return toISODate(year, month, Math.min(day, daysInMonth(year, month)));
}

export interface InvoiceDates {
  month: MonthKey;
  closingDate: ISODate;
  dueDate: ISODate;
}

export function getInvoiceDates(month: MonthKey, closingDay: number, dueDay: number): InvoiceDates {
  const closingMonth = dueDay > closingDay ? month : addMonthKey(month, -1);
  return {
    month,
    closingDate: clampDay(closingMonth, closingDay),
    dueDate: clampDay(month, dueDay),
  };
}

export function getInvoiceForPurchase(
  purchaseDate: ISODate,
  closingDay: number,
  dueDay: number,
): InvoiceDates {
  // Start from the invoice whose closing month is the purchase month and walk forward.
  const purchaseMonth = monthKey(purchaseDate);
  let month = dueDay > closingDay ? purchaseMonth : addMonthKey(purchaseMonth, 1);
  for (let i = 0; i < 3; i++) {
    const dates = getInvoiceDates(month, closingDay, dueDay);
    if (purchaseDate < dates.closingDate) return dates;
    month = addMonthKey(month, 1);
  }
  return getInvoiceDates(month, closingDay, dueDay);
}

export function getInvoiceStatus(
  dates: InvoiceDates,
  options: { total: number; unpaidTotal: number; today: ISODate },
): InvoiceStatus {
  if (options.total > 0 && options.unpaidTotal === 0) return 'paid';
  if (options.today >= dates.dueDate && options.unpaidTotal > 0) return 'overdue';
  if (options.today >= dates.closingDate) return 'closed';
  return 'open';
}
