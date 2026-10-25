import { z } from 'zod';

// Publication labels may be a year, an explanatory date, or «без указанной даты».
// Do not manufacture an exact publication date from a year in a supplied report.
export const companyPublicCaseSchema = z.object({
  id: z.string().min(1).max(100),
  title: z.string().trim().min(1).max(500),
  summary: z.string().trim().min(1).max(12000),
  scope: z.string().trim().min(1).max(2000),
  topics: z.array(z.string().trim().min(1).max(100)).max(40),
  source: z.object({
    title: z.string().trim().min(1).max(1000),
    url: z.url().refine((url) => /^https?:\/\//i.test(url), 'Нужна ссылка http(s)'),
    publication: z.string().trim().min(1).max(300),
  }),
  importedAt: z.iso.datetime(),
  sourceDocument: z.string().trim().min(1).max(300),
  sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
});

export type CompanyPublicCase = z.infer<typeof companyPublicCaseSchema>;
