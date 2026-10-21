import { z } from 'zod';

const publicUrl = z
  .url()
  .max(2000)
  .refine(
    (value) => /^https?:\/\//i.test(value) && !new URL(value).username && !new URL(value).password,
    'Нужен публичный HTTP(S) URL без credentials',
  );
// An explicit directory complements immutable evidence; a blog home never replaces an article.
export const companySourceLinkSchema = z.strictObject({
  label: z.string().trim().min(1).max(200),
  url: publicUrl,
  kind: z.enum(['blog', 'article', 'careers', 'ats', 'linkedin', 'profile', 'other']),
  parentUrl: publicUrl.optional(),
  note: z.string().trim().max(500).optional(),
});
export type CompanySourceLink = z.infer<typeof companySourceLinkSchema>;
