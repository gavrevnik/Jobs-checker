import { z } from 'zod';
import { searchSchema } from './source-tools.js';

export const discoveryReviewSchema = z.strictObject({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  title: z.string().trim().min(1).max(300),
  profileId: z.string().max(100).default(''),
  summary: z.string().trim().min(1).max(30000),
  nextSearches: z.array(z.string().trim().min(1).max(2000)).max(100).default([]),
  queries: z
    .array(
      z.object({
        label: z.string().max(500),
        parameters: searchSchema,
        requests: z.number().int().min(0),
        received: z.number().int().min(0),
        notes: z.string().max(5000).default(''),
      }),
    )
    .max(500)
    .default([]),
  stats: z.object({
    requests: z.number().int().min(0),
    returned: z.number().int().min(0),
    unique: z.number().int().min(0),
    added: z.number().int().min(0),
  }),
  jobIds: z.array(z.string().max(100)).max(5000).default([]),
});
export const discoveryHistorySchema = z.object({
  profileId: z.string().max(100).optional(),
  limit: z.number().int().min(1).max(100).default(20),
});
export type DiscoveryReview = z.infer<typeof discoveryReviewSchema> & {
  createdAt: string;
  updatedAt: string;
};
