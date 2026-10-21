import { z } from 'zod';

export const paidOperationSchema = z.strictObject({
  provider: z.literal('apify'),
  actor: z.string().min(1).max(200),
  operation: z.string().min(1).max(100),
  companyIds: z.array(z.string().min(1)).min(1).max(20),
  volume: z.number().int().min(1).max(1000),
  parameters: z.record(z.string(), z.json()),
  maxCostUsd: z.number().positive().max(1000),
});
export type PaidOperation = z.infer<typeof paidOperationSchema>;
