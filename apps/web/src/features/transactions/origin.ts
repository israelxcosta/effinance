import { TRANSACTION_ORIGINS, type Transaction, type TransactionOrigin } from '@effinance/shared';

/**
 * URL parameter of the "Origem" filter in the lists (`?entrada=`). `origem` was already taken by
 * the account/card filter. Unknown values mean "todas".
 */
export const ORIGIN_PARAM = 'entrada';

export function originFromParam(value: string | null | undefined): TransactionOrigin | '' {
  return value && (TRANSACTION_ORIGINS as readonly string[]).includes(value) ? (value as TransactionOrigin) : '';
}

/** Origin of a row; APIs older than the field don't send it (treated as manual). */
export function transactionOrigin(tx: Transaction): TransactionOrigin {
  const value = (tx as Partial<Pick<Transaction, 'origin'>>).origin;
  return value && (TRANSACTION_ORIGINS as readonly string[]).includes(value) ? value : 'manual';
}
