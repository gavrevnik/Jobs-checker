import { z } from 'zod';

const text = z.string().trim().min(1).max(200);
const amount = z.number().int().min(0).max(1e9);
// Names follow Adzuna's public OpenAPI search specification. Boolean flags emit 1 or nothing.
export const adzunaSearchSchema = z
  .strictObject({
    what: text.optional().describe('Search words; overrides keyword-generated Adzuna queries.'),
    what_and: text.optional().describe('All space-separated words must match.'),
    what_or: text.optional().describe('Any space-separated word may match; not an OR of phrases.'),
    what_phrase: text.optional().describe('Exact phrase in title or description.'),
    what_exclude: text.optional().describe('Exclude space-separated words at the provider.'),
    title_only: text.optional().describe('Search words only in the title.'),
    where: text.optional().describe('Place or postal code; overrides top-level location.'),
    distance: z
      .number()
      .int()
      .min(0)
      .max(10000)
      .optional()
      .describe('Radius in km; requires where or location. Provider default: 5 km.'),
    location0: text.optional(),
    location1: text.optional(),
    location2: text.optional(),
    location3: text.optional(),
    location4: text.optional(),
    location5: text.optional(),
    location6: text.optional(),
    location7: text.optional(),
    max_days_old: z
      .number()
      .int()
      .min(1)
      .max(365)
      .optional()
      .describe('Maximum advert age in days, applied by Adzuna.'),
    category: text
      .optional()
      .describe('Category tag from the selected market categories endpoint.'),
    company: text.optional().describe('Canonical employer name from Adzuna results.'),
    salary_min: amount
      .optional()
      .describe('Provider salary floor in the market currency; independent of local minSalary.'),
    salary_max: amount.optional().describe('Provider salary ceiling in the market currency.'),
    salary_include_unknown: z
      .boolean()
      .optional()
      .describe('true includes jobs with unknown salary; false omits the flag.'),
    full_time: z.boolean().optional(),
    part_time: z.boolean().optional(),
    permanent: z.boolean().optional(),
    contract: z.boolean().optional(),
    sort_by: z
      .enum(['default', 'hybrid', 'date', 'salary', 'relevance'])
      .optional()
      .describe(
        'Search ordering; hybrid is ranking, not hybrid work. Default in Jobs checker: date.',
      ),
    sort_dir: z.enum(['up', 'down']).optional(),
    page: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .optional()
      .describe('First page; maxPages remains the page/request budget.'),
    results_per_page: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe('Jobs checker limit: 1–50 results per request; default 50.'),
  })
  .superRefine((v, ctx) => {
    if (v.salary_min !== undefined && v.salary_max !== undefined && v.salary_min > v.salary_max)
      ctx.addIssue({
        code: 'custom',
        path: ['salary_max'],
        message: 'salary_max должен быть не меньше salary_min',
      });
    for (const [a, b] of [
      ['full_time', 'part_time'],
      ['permanent', 'contract'],
    ] as const)
      if (v[a] && v[b])
        ctx.addIssue({
          code: 'custom',
          path: [b],
          message: `Выберите ${a} или ${b}, не оба одновременно`,
        });
  });
export type AdzunaSearch = z.infer<typeof adzunaSearchSchema>;
export const hasAdzunaQuery = (v?: AdzunaSearch) =>
  !!(v?.what || v?.what_and || v?.what_or || v?.what_phrase || v?.title_only);

// Safe to expose in dry-run plans: credentials are added only in fetchJobs.
export function adzunaSearchParams(
  query: string,
  location: string,
  options?: AdzunaSearch,
  maxAgeDays?: number,
) {
  const v = adzunaSearchSchema.parse(options || {});
  if (v.distance !== undefined && !(v.where || location))
    throw new Error('Для adzuna.distance укажите adzuna.where или location');
  const { page: _page, ...filters } = v;
  const params = new URLSearchParams({ results_per_page: '50', sort_by: 'date' });
  if (query && !hasAdzunaQuery(v)) params.set('what', query);
  if (location) params.set('where', location);
  for (const [key, value] of Object.entries(filters)) {
    if (typeof value === 'boolean') {
      if (value) params.set(key, '1');
    } else if (value !== undefined) params.set(key, String(value));
  }
  if (maxAgeDays !== undefined)
    params.set('max_days_old', String(Math.min(maxAgeDays, v.max_days_old ?? maxAgeDays)));
  return params;
}
