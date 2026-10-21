import { z } from 'zod';
import { canonicalUrl } from './model.js';
import registry from '../discovery/criteria.json';
export { registry };
export const sections = registry.sections;
export type Section = keyof typeof sections;
export const verdicts = ['pass', 'fail', 'unknown', 'conflicting', 'not_applicable'] as const;
export type Verdict = (typeof verdicts)[number];
const httpUrl = z
  .url()
  .max(2000)
  .refine(
    (v) => /^https?:\/\//i.test(v) && !new URL(v).username && !new URL(v).password,
    'Нужна публичная HTTP(S) ссылка без credentials',
  );
const date = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);
const short = z.string().trim().max(4000);
export const scopeSchema = z.strictObject({
  country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional(),
  city: z.string().max(200).optional(),
  role: z.string().max(300).optional(),
  job_url: httpUrl.optional(),
  level: z.string().max(100).optional(),
  context: z.string().max(500).optional(),
});
export const evidenceSchema = z.strictObject({
  url: httpUrl,
  title: z.string().min(1).max(500),
  source_type: z.enum([
    'official',
    'job',
    'engineering',
    'report',
    'conference',
    'employee_report',
    'news',
    'market_estimate',
    'user',
  ]),
  published_at: date.optional(),
  observed_at: date,
  excerpt: z.string().trim().min(1).max(5000),
});
export const valueSchemas = {
  salary_benchmark: z
    .strictObject({
      component: z.enum(['total', 'base', 'stock', 'bonus', 'sign_on']),
      statistic: z.enum(['median', 'mean', 'range', 'individual']),
      amount: z.number().finite().nonnegative().nullable(),
      min: z.number().finite().nonnegative().nullable(),
      max: z.number().finite().nonnegative().nullable(),
      currency: z.string().regex(/^[A-Z]{3}$/),
      period: z.enum(['year', 'month', 'hour']),
      sample_size: z.number().int().positive().nullable(),
      sample_scope: z.enum([
        'role_country_level',
        'role_country',
        'company_role',
        'individual',
        'not_disclosed',
      ]),
      source_updated_at: date.nullable(),
      sample_period: z.string().trim().max(500).nullable(),
      role_relation: z.enum(['target', 'related']),
      notes: short,
    })
    .superRefine((v, ctx) => {
      if (
        v.statistic === 'range'
          ? v.amount !== null || (v.min === null && v.max === null)
          : v.amount === null || v.min !== null || v.max !== null
      )
        ctx.addIssue({
          code: 'custom',
          message: 'Нужна отдельная сумма либо диапазон, в соответствии со statistic',
        });
      if (v.min !== null && v.max !== null && v.min > v.max)
        ctx.addIssue({ code: 'custom', message: 'Нижняя граница превышает верхнюю' });
      if ((v.sample_size === null) !== (v.sample_scope === 'not_disclosed'))
        ctx.addIssue({
          code: 'custom',
          message: 'Неизвестный N требует sample_scope=not_disclosed',
        });
    }),
  infrastructure: z.strictObject({
    summary: short.min(1),
    tags: z.array(z.string().trim().min(1).max(80)).max(12),
    assessments: z
      .array(
        z.strictObject({
          label: z.string().trim().min(1).max(80),
          basis: short.min(1),
        }),
      )
      .max(4)
      .optional(),
  }),
  interview: z
    .strictObject({
      summary: short.min(1),
      stages: z
        .array(
          z.strictObject({
            title: z.string().trim().min(1).max(200),
            details: short,
            duration: z.string().trim().max(300).optional(),
          }),
        )
        .max(20),
      assignment: z
        .strictObject({
          kind: z.enum(['take_home', 'live', 'none', 'unspecified']),
          details: short.min(1),
          duration: z.string().trim().max(300).optional(),
        })
        .optional(),
    })
    .refine(
      (v) => v.stages.length > 0 || !!v.assignment,
      'Нужны конкретные этапы или сведения о задании',
    ),
  culture: z.strictObject({
    summary: short.min(1),
    tags: z.array(z.string().trim().min(1).max(80)).max(12),
  }),
  strings: z.array(z.string().trim().min(1).max(200)).min(1).max(100),
  text: short.min(1),
  boolean: z.boolean(),
  work: z.strictObject({
    modes: z.array(z.enum(['remote', 'hybrid', 'onsite'])).max(3),
    eligible_countries: z.array(z.string().regex(/^[A-Z]{2}$/)).max(100),
  }),
  role: z.enum(['product_data', 'bi_de_ml', 'mixed']),
};
// Criterion and value are validated together; the same discriminated union generates the JSON Schema.
const variants = registry.criteria.map((c) =>
  z
    .strictObject({
      criterion_id: z.literal(c.id),
      value: (c.id === 'A02_OFFICES' || c.id === 'A02_HQ'
        ? z
            .array(z.string().regex(/^[A-Z]{2}$/))
            .min(1)
            .max(100)
        : valueSchemas[c.value_type as keyof typeof valueSchemas]
      ).nullable(),
      verdict: z.enum(verdicts).optional(),
      confidence: z.enum(['high', 'medium', 'low']),
      scope: scopeSchema,
      reasoning: short,
      short_facts: z.array(z.string().trim().min(1).max(100)).max(3).optional(),
      evidence: z.array(evidenceSchema).max(30),
      complete: z.boolean().optional(),
      applicability: z.enum(['applicable', 'not_applicable']).optional(),
    })
    .superRefine((o, ctx) => {
      if (o.short_facts?.length && (o.value === null || !o.evidence.length))
        ctx.addIssue({
          code: 'custom',
          path: ['short_facts'],
          message: 'Краткие факты требуют заполненного ответа и evidence',
        });
      if (
        c.id === 'A07_SALARY_BENCHMARK' &&
        o.value !== null &&
        (!o.scope.country || !o.scope.role)
      )
        ctx.addIssue({
          code: 'custom',
          path: ['scope'],
          message: 'Для зарплатного ориентира обязательны страна и точная роль',
        });
    }),
);
export const observationSchema = z.union(
  variants as [
    (typeof variants)[number],
    (typeof variants)[number],
    ...(typeof variants)[number][],
  ],
);
export type Observation = z.infer<typeof observationSchema>;
export type InfrastructureValue = z.infer<typeof valueSchemas.infrastructure>;
export type SalaryBenchmarkValue = z.infer<typeof valueSchemas.salary_benchmark>;
export const redFlagSchema = z.strictObject({
  title: z.string().min(1).max(500),
  description: short,
  severity: z.enum(['low', 'medium', 'high']),
  confidence: z.enum(['high', 'medium', 'low']),
  scope: scopeSchema,
  occurred_at: date.optional(),
  evidence: z.array(evidenceSchema).min(1).max(30),
});
export const researchImportSchema = z.strictObject({
  schema_version: z.literal('1.0'),
  generated_at: z.iso.datetime({ offset: true }),
  research_mode: z.enum(['external_research', 'internal_discovery', 'manual']),
  companies: z
    .array(
      z.strictObject({
        identity: z.strictObject({
          name: z.string().trim().min(1).max(200),
          website: httpUrl.optional(),
          company_id: z.string().min(1).max(100).optional(),
          aliases: z.array(z.string().trim().min(1).max(200)).max(30).optional(),
        }),
        observations: z.array(observationSchema).max(1000),
        job_urls: z.array(httpUrl).max(300),
        red_flags: z.array(redFlagSchema).max(100),
        notes: z.string().max(30000),
        collection_sources: z
          .array(
            z.strictObject({
              name: z.string().min(1).max(200),
              kind: z.enum(['api', 'web_search', 'web_page', 'model', 'manual']),
              description: z.string().min(1).max(1000),
              url: httpUrl.optional(),
              observed_at: date,
              query: z.string().max(1000).optional(),
              outcome: z.enum(['success', 'empty', 'error', 'partial', 'cached']),
              columns: z
                .array(
                  z.enum([
                    'company',
                    'business',
                    'target_vacancies',
                    'analytics_culture',
                    'infrastructure',
                  ]),
                )
                .min(1)
                .max(5),
            }),
          )
          .max(300)
          .optional(),
      }),
    )
    .min(1)
    .max(500),
});
export type ResearchImport = z.infer<typeof researchImportSchema>;
export type StoredObservation = Observation & {
  id: string;
  companyId: string;
  runId: string;
  importedAt: string;
  verifiedAt: string | null;
  rejected: boolean;
  reviewNote: string;
  manual: boolean;
};
export const EU = new Set([
  'AT',
  'BE',
  'BG',
  'HR',
  'CY',
  'CZ',
  'DK',
  'EE',
  'FI',
  'FR',
  'DE',
  'GR',
  'HU',
  'IE',
  'IT',
  'LV',
  'LT',
  'LU',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SK',
  'SI',
  'ES',
  'SE',
]);
export const scopeKey = (scope: Observation['scope']) =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(scope)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [
          k,
          typeof v === 'string' ? (k === 'job_url' ? canonicalUrl(v) : v.trim().toLowerCase()) : v,
        ]),
    ),
  );
export const isHistoricalJob = (o: Pick<Observation, 'scope'>) =>
  /^historical_job(?:;|$)/.test(o.scope.context || '');
export function stale(o: StoredObservation, now = Date.now()) {
  // A reviewed historical role is useful evidence, but never a current company claim.
  if (isHistoricalJob(o)) return true;
  const criterion = registry.criteria.find((c) => c.id === o.criterion_id)!;
  // Rechecking an old report doesn't turn its historical publication into current conditions.
  const dates = o.evidence.map((e) =>
    Math.min(
      Date.parse(e.observed_at),
      Date.parse(e.published_at || e.observed_at),
      o.criterion_id === 'A07_SALARY_BENCHMARK' &&
        o.value &&
        typeof o.value === 'object' &&
        'source_updated_at' in o.value &&
        o.value.source_updated_at
        ? Date.parse(String(o.value.source_updated_at))
        : Infinity,
    ),
  );
  return (
    !dates.length ||
    o.evidence.some(
      (e) =>
        Date.parse(e.observed_at) > now + 60000 ||
        Date.parse(e.published_at || e.observed_at) > now + 60000 ||
        (o.criterion_id === 'A07_SALARY_BENCHMARK' &&
          o.value &&
          typeof o.value === 'object' &&
          'source_updated_at' in o.value &&
          !!o.value.source_updated_at &&
          Date.parse(String(o.value.source_updated_at)) > now + 60000),
    ) ||
    Math.max(...dates) < now - criterion.stale_days * 86400000 ||
    !o.verifiedAt ||
    Date.parse(o.verifiedAt) < now - criterion.stale_days * 86400000
  );
}
export function effectiveVerdict(o: StoredObservation, now = Date.now()): Verdict {
  const c = registry.criteria.find((c) => c.id === o.criterion_id)!;
  if (o.rejected || !o.verifiedAt || o.confidence === 'low') return 'unknown';
  if (o.applicability === 'not_applicable') return o.manual ? 'not_applicable' : 'unknown';
  if (
    stale(o, now) ||
    o.value === null ||
    !o.evidence.some(
      (e) =>
        c.allowed_sources.includes(e.source_type) &&
        ['official', 'job', 'engineering', 'report', 'conference'].includes(e.source_type),
    )
  )
    return 'unknown';
  if (c.kind !== 'scored') return 'unknown';
  switch (c.rule) {
    case 'boolean':
      return o.value === true ? 'pass' : o.value === false ? 'fail' : 'unknown';
    case 'languages':
      return (o.value as string[]).some((x) =>
        /^(en|ru|english|russian|английский|русский)$/i.test(x),
      )
        ? 'pass'
        : o.complete
          ? 'fail'
          : 'unknown';
    case 'modern_data':
      return (o.value as string[]).some((x) =>
        /clickhouse|spark|bigquery|hadoop|snowflake|redshift|databricks/i.test(x),
      )
        ? 'pass'
        : o.complete
          ? 'fail'
          : 'unknown';
    case 'role_fit':
      return o.value === 'product_data' ? 'pass' : o.value === 'bi_de_ml' ? 'fail' : 'unknown';
    default:
      return 'unknown';
  }
}
// String sets and structured fields are independent of JSON key/list ordering.
export function valueKey(value: unknown): string {
  if (Array.isArray(value))
    return JSON.stringify(value.map((v) => (typeof v === 'string' ? v.toLowerCase() : v)).sort());
  if (value && typeof value === 'object')
    return JSON.stringify(
      Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => [k, valueKey(v)]),
      ),
    );
  return JSON.stringify(value);
}
export function observationsDisagree(a: Observation, b: Observation) {
  if (a.value === null || b.value === null) return false;
  // Independent researched summaries describe partial practices/tools; different wording or
  // additional tags from another source does not negate an earlier summary in the same scope.
  if (
    typeof a.value === 'object' &&
    typeof b.value === 'object' &&
    !Array.isArray(a.value) &&
    !Array.isArray(b.value) &&
    'summary' in a.value &&
    'tags' in a.value &&
    'summary' in b.value &&
    'tags' in b.value
  )
    return false;
  // Partial technology/country/language lists add information; they don't negate other lists.
  if (Array.isArray(a.value) && Array.isArray(b.value)) {
    const av = a.value.map((v) => String(v).toLowerCase()),
      bv = b.value.map((v) => String(v).toLowerCase());
    return (
      (!!a.complete && bv.some((v) => !av.includes(v))) ||
      (!!b.complete && av.some((v) => !bv.includes(v)))
    );
  }
  return valueKey(a.value) !== valueKey(b.value);
}
export function matchesCountry(o: Observation, country: string) {
  if (!country || o.criterion_id === 'A02_HQ') return true;
  if (o.scope.country) return o.scope.country === country;
  if (o.criterion_id === 'A02_OFFICES') return Array.isArray(o.value) && o.value.includes(country);
  if (o.criterion_id === 'A05' && o.value) {
    const value = o.value as { eligible_countries: string[] };
    return value.eligible_countries.includes(country);
  }
  // A job-specific statement without country is not a country-wide policy.
  return !o.scope.job_url;
}
export function criterionState(
  id: string,
  observations: StoredObservation[],
  country = '',
  now = Date.now(),
) {
  const c = registry.criteria.find((c) => c.id === id)!;
  const all = observations.filter((o) => o.criterion_id === id && matchesCountry(o, country));
  const groups = new Map<string, StoredObservation[]>();
  for (const o of all.filter((o) => !o.rejected)) {
    const key = scopeKey(o.scope);
    groups.set(key, [...(groups.get(key) || []), o]);
  }
  let conflicting = false,
    pendingConflict = false;
  for (const group of groups.values()) {
    const usable = group.filter(
      (o) =>
        o.value !== null &&
        o.verifiedAt &&
        !stale(o, now) &&
        o.confidence !== 'low' &&
        (c.kind !== 'scored' || ['pass', 'fail'].includes(effectiveVerdict(o, now))),
    );
    if (
      usable.length &&
      group.some(
        (o) => !o.verifiedAt && o.value !== null && usable.some((k) => observationsDisagree(k, o)),
      )
    )
      pendingConflict = true;
    if (usable.some((a, i) => usable.slice(i + 1).some((b) => observationsDisagree(a, b))))
      conflicting = true;
  }
  const known = all.filter(
    (o) =>
      !o.rejected &&
      o.verifiedAt &&
      !stale(o, now) &&
      o.value !== null &&
      o.confidence !== 'low' &&
      (c.kind === 'subjective' ||
        o.evidence.some((e) => c.allowed_sources.includes(e.source_type))),
  );
  const values = all.map((o) => effectiveVerdict(o, now)).filter((v) => v !== 'unknown');
  const verdict: Verdict =
    conflicting || (values.includes('pass') && values.includes('fail'))
      ? 'conflicting'
      : values.includes('pass')
        ? 'pass'
        : values.includes('fail')
          ? 'fail'
          : values.includes('not_applicable')
            ? 'not_applicable'
            : 'unknown';
  return {
    criterion: c,
    observations: all,
    known,
    verdict,
    conflicting,
    pendingConflict,
    highlights:
      verdict === 'pass'
        ? known
            .filter((o) => effectiveVerdict(o, now) === 'pass')
            .map((o) => o.reasoning || c.name)
            .slice(0, 2)
        : [],
  };
}
export function summarize(observations: StoredObservation[], country = '', now = Date.now()) {
  const criteria = registry.criteria.map((c) => criterionState(c.id, observations, country, now));
  const scores = Object.fromEntries(
    Object.keys(sections).map((section) => {
      const items = criteria.filter(
        (c) => c.criterion.section === section && c.criterion.kind === 'scored',
      );
      const counts = Object.fromEntries(
        verdicts.map((v) => [v, items.filter((c) => c.verdict === v).length]),
      ) as Record<Verdict, number>;
      const total = items.length - counts.not_applicable;
      const evaluated = counts.pass + counts.fail;
      return [
        section,
        {
          ...counts,
          total,
          coverage: total ? evaluated / total : 0,
          positiveShare: evaluated ? counts.pass / evaluated : null,
          highlights: items.flatMap((c) => c.highlights).slice(0, 3),
        },
      ];
    }),
  ) as Record<
    Section,
    Record<Verdict, number> & {
      total: number;
      coverage: number;
      positiveShare: number | null;
      highlights: string[];
    }
  >;
  return { criteria, scores };
}

export function headquartersProfile(observations: StoredObservation[], now = Date.now()) {
  // HQ stays a global company property even when hiring is filtered to another country.
  const state = criterionState('A02_HQ', observations, '', now);
  const known = state.known.filter((o) =>
    o.evidence.some(
      (e) =>
        ['official', 'report'].includes(e.source_type) ||
        (e.source_type === 'job' && o.scope.context === 'company_headquarters'),
    ),
  );
  const distributedObservations = state.observations.filter(
    (o) =>
      !o.rejected &&
      o.verifiedAt &&
      o.confidence !== 'low' &&
      !stale(o, now) &&
      o.scope.context === 'distributed_headquarters' &&
      o.evidence.some((e) => e.source_type === 'official'),
  );
  const countries = state.conflicting
    ? []
    : [...new Set(known.flatMap((o) => o.value as string[]))].sort();
  return {
    countries,
    status: state.conflicting
      ? 'conflicting'
      : distributedObservations.length && !countries.length
        ? 'distributed'
        : countries.length
          ? 'verified'
          : state.observations.some((o) => !o.rejected && o.value !== null)
            ? 'pending'
            : 'unknown',
    checkedAt:
      [...known, ...distributedObservations]
        .map((o) => o.verifiedAt || '')
        .sort()
        .at(-1) || '',
    evidence: [...known, ...distributedObservations].flatMap((o) => o.evidence),
  };
}
