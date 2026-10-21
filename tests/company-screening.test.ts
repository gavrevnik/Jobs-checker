import { expect, it } from 'vitest';
import { Store } from '../server/store';
import { CompanyResearch } from '../server/company-research';
import { observationSchema, type StoredObservation } from '../shared/company-research';
import { companyScreening } from '../src/company-screening';
import { companyPresentation } from '../src/company-presentation';
import { companyCulture } from '../src/company-culture';
import { companyColumnSources } from '../shared/company-provenance';
import type { ComparisonProfile } from '../src/company-comparison';
const now = new Date().toISOString();
function fact(
  id: string,
  value: unknown,
  short_facts: string[] = [],
  extra: Record<string, unknown> = {},
): StoredObservation {
  return {
    ...observationSchema.parse({
      criterion_id: id,
      value,
      short_facts,
      confidence: 'high',
      scope: {},
      reasoning: 'Scoped source facts',
      evidence: [
        {
          url: 'https://fixture.test/evidence',
          title: 'Primary source',
          source_type: 'official',
          observed_at: now,
          excerpt: 'Full original source',
        },
      ],
      ...extra,
    }),
    id: crypto.randomUUID(),
    companyId: 'c',
    runId: 'r',
    importedAt: now,
    verifiedAt: now,
    manual: false,
    rejected: false,
    reviewNote: '',
  };
}
function profile(observations: StoredObservation[], open = true) {
  return {
    observations,
    jobs: [],
    targetVacancies: {
      jobs: open ? [{ url: 'https://fixture.test/role', availability: { state: 'open' } }] : [],
    },
  } as unknown as Pick<ComparisonProfile, 'observations' | 'jobs' | 'targetVacancies'>;
}
it('round-trips optional short facts through import and review without changing the underlying answer or score', () => {
  const s = new Store(':memory:');
  try {
    const c = s.saveCompany({ name: 'Screening fixture', description: 'Company product' }),
      r = new CompanyResearch(s);
    const data = {
      schema_version: '1.0',
      generated_at: now,
      research_mode: 'internal_discovery',
      companies: [
        {
          identity: { company_id: c.id, name: c.name },
          observations: [
            {
              criterion_id: 'AN02',
              value: 'Team works with PM',
              short_facts: ['Совместное планирование с PM'],
              confidence: 'high',
              scope: { role: 'Product Analyst' },
              reasoning: 'Published team model',
              evidence: [
                {
                  url: 'https://fixture.test/team',
                  title: 'Team',
                  source_type: 'official',
                  observed_at: now,
                  excerpt: 'Team works with PM',
                },
              ],
            },
          ],
          job_urls: [],
          red_flags: [],
          notes: '',
        },
      ],
    };
    const before = r.profile(c.id).scores;
    const preview = r.preview(data);
    r.apply({ previewId: preview.previewId, confirmed: true });
    expect(companyScreening(r.profile(c.id)).team).toHaveLength(0);
    r.review(r.profile(c.id).observations[0].id, { verified: true });
    const p = r.profile(c.id);
    expect(companyScreening(p).team[0].label).toBe('Совместное планирование с PM');
    expect(companyScreening(p).team[0].details).toContain('Product Analyst');
    expect(companyScreening(p).team[0].details).toContain('https://fixture.test/team');
    expect(p.observations[0].value).toBe('Team works with PM');
    expect(p.scores).toEqual(before);
    expect(
      observationSchema.safeParse({ ...data.companies[0].observations[0], value: null }).success,
    ).toBe(false);
    expect(
      observationSchema.safeParse({ ...data.companies[0].observations[0], evidence: [] }).success,
    ).toBe(false);
  } finally {
    s.db.close();
  }
});
it('separates company business, scoped role focus and dated audience, including their provenance', () => {
  const business = fact('B04', 'Software for small businesses', ['B2B · SMB']);
  const focus = fact('B04', 'B2B retention and pricing', ['Retention / pricing'], {
    scope: { role: 'Senior Analyst', country: 'ES', job_url: 'https://fixture.test/role' },
  });
  const audience = fact('B06', '100 million registrations; activity period unknown', [
    '100 млн регистраций · не MAU',
  ]);
  const p = profile([focus, business, audience]);
  const v = companyScreening(p);
  expect(v.business.map((t) => t.label)).toEqual(['B2B · SMB']);
  expect(v.focus[0].label).toBe('Retention / pricing');
  expect(v.traffic[0].label).toContain('регистраций · не MAU');
  expect(v.traffic[0].label).toContain('проверено');
  expect(v.traffic[0].details).toContain('activity period unknown');
  expect(
    companyCulture([audience, { ...audience, id: 'old', short_facts: undefined }]).traffic,
  ).toHaveLength(1);
  const s = new Store(':memory:');
  try {
    const c = s.saveCompany({ name: 'Fixture', description: 'Fallback company description' });
    expect(companyPresentation(c, [focus]).description).toBe('Fallback company description');
    const sources = companyColumnSources(c, [audience], [], { sources: [] }, []);
    expect(sources.business.some((s) => s.url === 'https://fixture.test/evidence')).toBe(true);
    expect(sources.analytics_culture).toHaveLength(0);
  } finally {
    s.db.close();
  }
});
it('hides unverified, stale and conflicting quick facts and keeps remote eligibility tied to an open role', () => {
  const work = fact(
    'A05',
    { modes: ['remote'], eligible_countries: ['ES'] },
    ['Remote · только ES'],
    { scope: { job_url: 'https://fixture.test/role', role: 'Product Analyst' } },
  );
  const pending = { ...fact('AN02', 'A', ['Pending']), verifiedAt: null };
  const stale = fact('AN03', 'B', ['Old'], {
    evidence: [
      {
        url: 'https://fixture.test/old',
        title: 'Old',
        source_type: 'official',
        observed_at: '2020-01-01',
        excerpt: 'Old',
      },
    ],
  });
  const conflict1 = fact('AN02', 'Central', ['Central']),
    conflict2 = fact('AN02', 'Embedded', ['Embedded']);
  const p = profile([work, pending, stale, conflict1, conflict2]);
  expect(companyScreening(p).team).toHaveLength(0);
  expect(companyScreening(p).work.map((t) => t.label)).toContain('Remote · только ES');
  expect(companyScreening(profile([work], false)).work).toHaveLength(0);
  expect(
    companyScreening(profile([{ ...work, scope: { country: 'ES', role: 'Product Analyst' } }]))
      .work,
  ).toHaveLength(0);
});
it('makes interview assignment and related salary context explicit without inventing N or resolving conflicting amounts', () => {
  const interview = fact(
    'P07_INTERVIEW',
    {
      summary: 'Published process',
      stages: [{ title: 'Technical', details: 'SQL' }],
      assignment: { kind: 'take_home', details: 'Case; effort not specified' },
    },
    [],
    { scope: { role: 'Product Analyst' } },
  );
  const salary = fact(
    'A07_SALARY_BENCHMARK',
    {
      component: 'total',
      statistic: 'median',
      amount: 100000,
      min: null,
      max: null,
      currency: 'EUR',
      period: 'year',
      sample_size: null,
      sample_scope: 'not_disclosed',
      source_updated_at: now.slice(0, 10),
      sample_period: null,
      role_relation: 'related',
      notes: '',
    },
    [],
    {
      scope: { country: 'ES', role: 'Data Scientist' },
      evidence: [
        {
          url: 'https://www.levels.fyi/fixture',
          title: 'Levels.fyi',
          source_type: 'market_estimate',
          observed_at: now,
          excerpt: 'Published median',
        },
      ],
    },
  );
  const view = companyScreening(profile([interview, salary]));
  expect(view.interview.label).toContain('take-home');
  expect(view.salary[0].label).toContain('Data Scientist · ES · смежная роль');
  expect(view.salary[0].details).toContain('Размер выборки: не раскрыт');
  expect(
    companyScreening(profile([interview, { ...salary, verifiedAt: null }])).salary,
  ).toHaveLength(0);
  expect(
    companyScreening(
      profile([
        salary,
        {
          ...salary,
          id: 'conflict',
          value: { ...(salary.value as object), amount: 90000 } as typeof salary.value,
        },
      ]),
    ).salary,
  ).toHaveLength(0);
});
