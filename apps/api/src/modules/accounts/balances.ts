import { sql } from 'drizzle-orm';
import type { ISODate } from '@effinance/shared';
import type { DbExecutor } from '../../db/client';
import { toNumber } from '../../lib/sql';

export interface AccountMovementSums {
  /** Paid movements with effective date <= asOf. */
  realized: number;
  /** Paid (effective <= until) + pending (due <= until) movements. */
  projected: number;
}

/**
 * Net movement per account. Income adds, expense subtracts, a transfer subtracts from the origin
 * and adds to the destination. Card purchases have no account and never count here.
 */
export async function accountMovements(
  db: DbExecutor,
  userId: string,
  asOf: ISODate,
  projectedUntil: ISODate = asOf,
): Promise<Map<string, AccountMovementSums>> {
  const rows = await db.execute<{ acc: string; realized: string; projected: string }>(sql`
    with m as (
      select account_id as acc,
             case when type = 'income' then amount else -amount end as delta,
             paid, coalesce(paid_at, date) as eff, date
        from transactions
       where user_id = ${userId} and account_id is not null
      union all
      select to_account_id as acc, amount as delta, paid, coalesce(paid_at, date) as eff, date
        from transactions
       where user_id = ${userId} and type = 'transfer' and to_account_id is not null
    )
    select acc,
           coalesce(sum(case when paid and eff <= ${asOf} then delta else 0 end), 0) as realized,
           coalesce(sum(case when (paid and eff <= ${projectedUntil}) or (not paid and date <= ${projectedUntil})
                             then delta else 0 end), 0) as projected
      from m
     group by acc
  `);
  const map = new Map<string, AccountMovementSums>();
  for (const r of rows) {
    map.set(r.acc, { realized: toNumber(r.realized), projected: toNumber(r.projected) });
  }
  return map;
}
