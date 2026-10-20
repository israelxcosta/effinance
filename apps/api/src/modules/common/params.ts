import { z } from 'zod';
import { idSchema, monthKeySchema } from '@effinance/shared';

export const idParams = z.object({ id: idSchema });
export const invoiceParams = z.object({ id: idSchema, month: monthKeySchema });
export const contributionParams = z.object({ id: idSchema, contributionId: idSchema });
export const invoiceRangeQuery = z.object({
  from: monthKeySchema.optional(),
  to: monthKeySchema.optional(),
});
