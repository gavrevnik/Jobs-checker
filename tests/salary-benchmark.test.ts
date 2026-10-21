import { afterEach, expect, it } from 'vitest';
import { Store } from '../server/store';
import { CompanyResearch } from '../server/company-research';
import { observationSchema, stale, type StoredObservation } from '../shared/company-research';
import { companySummaryText } from '../src/company-summary';
const stores: Store[] = [];
afterEach(() => stores.splice(0).forEach((s) => s.db.close()));
const value = {
  component: 'total',
  statistic: 'median',
  amount: 50000,
  min: null,
  max: null,
  currency: 'EUR',
  period: 'year',
  sample_size: 27,
  sample_scope: 'company_role',
  source_updated_at: '2026-10-17',
  sample_period: null,
  role_relation: 'target',
  notes: 'Country subset size not disclosed.',
};
function observation(extra: Record<string, unknown> = {}) {
  return {
    criterion_id: 'A07_SALARY_BENCHMARK',
    value,
    scope: { country: 'ES', role: 'Data Analyst' },
    confidence: 'high',
    reasoning: 'Public crowd-sourced benchmark; not an employer offer.',
    evidence: [
      {
        url: 'https://www.levels.fyi/companies/fixture/salaries/data-analyst',
        title: 'Levels.fyi',
        source_type: 'market_estimate',
        observed_at: new Date().toISOString(),
        excerpt: 'Median annual total compensation; 27 role submissions.',
      },
    ],
    ...extra,
  };
}
it('round-trips scoped salary research through import/review, preserves N/date and does not change ATS salary or scored criteria', () => {
  const store = new Store(':memory:');
  stores.push(store);
  const company = store.saveCompany({
    name: 'Salary fixture',
    website: 'https://salary-fixture.test',
  });
  const research = new CompanyResearch(store);
  const before = research.profile(company.id),
    jobsBefore = store.list('jobs');
  const data = {
    schema_version: '1.0',
    generated_at: new Date().toISOString(),
    research_mode: 'internal_discovery',
    companies: [
      {
        identity: { name: company.name, company_id: company.id },
        observations: [observation()],
        job_urls: [],
        red_flags: [],
        notes: 'Public web page',
      },
    ],
  };
  const preview = research.preview(data);
  research.apply({ previewId: preview.previewId, confirmed: true });
  const p = research.profile(company.id);
  const o = p.observations[0];
  expect(o.value).toEqual(value);
  expect(o.scope).toEqual({ country: 'ES', role: 'Data Analyst' });
  expect(o.verifiedAt).toBeNull();
  research.review(o.id, { verified: true });
  const after = research.profile(company.id);
  expect(after.scores.A).toEqual(before.scores.A);
  expect(store.list('jobs')).toEqual(jobsBefore);
  const text = companySummaryText(after);
  expect(text).toContain('50 000 EUR / год');
  expect(text).toContain('N=27');
  expect(text).toContain('охват страны/грейда не подтверждён');
  expect(text).toContain('2026-10-17');
  expect(text).toContain('не условие вакансии');
  expect(text).not.toContain('salary_benchmark');
});
it('requires known role/country and rejects invented or internally inconsistent statistics', () => {
  for (const scope of [{}, { role: 'Data Analyst' }, { country: 'ES' }])
    expect(observationSchema.safeParse(observation({ scope })).success).toBe(false);
  for (const patch of [
    { amount: null },
    { sample_size: 0 },
    { sample_size: null },
    { min: 60000, max: 50000, amount: null, statistic: 'range' },
    { currency: '€' },
    { amount: NaN },
  ])
    expect(
      observationSchema.safeParse(observation({ value: { ...value, ...patch } })).success,
    ).toBe(false);
  expect(
    observationSchema.safeParse(
      observation({
        value: { ...value, amount: null, min: 40000, max: 60000, statistic: 'range' },
      }),
    ).success,
  ).toBe(true);
});
it('keeps unknown sample sizes and related roles explicit instead of inventing country N or a target-role salary', () => {
  const store = new Store(':memory:');
  stores.push(store);
  const company = store.saveCompany({ name: 'Related fixture' });
  const research = new CompanyResearch(store);
  research.manual(
    company.id,
    observation({
      scope: { country: 'ES', role: 'Data Scientist' },
      value: {
        ...value,
        sample_size: null,
        sample_scope: 'not_disclosed',
        source_updated_at: null,
        role_relation: 'related',
      },
    }),
  );
  const text = companySummaryText(research.profile(company.id));
  expect(text).toContain('Смежная роль');
  expect(text).toContain('Размер выборки: не раскрыт');
  expect(text).toContain('Обновление источника: не указано');
  expect(text).not.toContain('N=1');
});
it('does not refresh historical source dates merely by reading/reviewing the page today', () => {
  const o = {
    ...observation({ value: { ...value, source_updated_at: '2020-01-01' } }),
    id: 'o',
    companyId: 'c',
    runId: 'r',
    importedAt: new Date().toISOString(),
    verifiedAt: new Date().toISOString(),
    rejected: false,
    reviewNote: '',
    manual: false,
  } as StoredObservation;
  expect(stale(o)).toBe(true);
  expect(
    stale({ ...o, value: { ...value, source_updated_at: '2999-01-01' } } as StoredObservation),
  ).toBe(true);
});
