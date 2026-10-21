import { afterEach, expect, it } from 'vitest';
import { Store } from '../server/store';
import { CompanyResearch } from '../server/company-research';
import {
  companyResearchTags,
  uncoveredTechnicalFacts,
  uncoveredAnalyticsFacts,
} from '../shared/company-signals';
import { comparisonHiringTags, uncoveredAvailabilityFacts } from '../src/company-comparison';
import { companyCulture } from '../src/company-culture';

const stores: Store[] = [];
afterEach(() => stores.splice(0).forEach((s) => s.db.close()));
function setup() {
  const store = new Store(':memory:');
  stores.push(store);
  const company = store.saveCompany({ name: 'Signal fixture' });
  const research = new CompanyResearch(store);
  function add(
    criterion_id: string,
    value: unknown,
    options: {
      scope?: Record<string, string>;
      verified?: boolean;
      date?: string;
      confidence?: string;
    } = {},
  ) {
    const result = research.manual(company.id, {
      criterion_id,
      value,
      scope: options.scope || {},
      confidence: options.confidence || 'high',
      reasoning: 'Applies only to the named team; conditions require individual confirmation.',
      evidence: [
        {
          url: options.scope?.job_url || 'https://example.test/engineering',
          title: 'Team source',
          source_type: 'official',
          observed_at: options.date || new Date().toISOString(),
          excerpt: 'The named team uses these tools. Terms apply only to this role and country.',
        },
      ],
    });
    const observation = result.observations[0];
    if (options.verified !== false) research.review(observation.id, { verified: true });
    return observation.id;
  }
  return { store, company, research, add, profile: () => research.profile(company.id) };
}
it('separates researched stack and methods, keeps provenance and never mines raw vacancy requirements', () => {
  const f = setup();
  f.store.importData({
    jobs: [
      {
        company: f.company.name,
        title: 'Senior Product Analyst',
        seniority: 'senior',
        description:
          'Experience with Hadoop or Mixpanel is a bonus; these are examples, not our stack.',
      },
    ],
  });
  const scope = {
    country: 'ES',
    role: 'Senior Product Analyst',
    job_url: 'https://example.test/role',
  };
  f.add(
    'AN09_CULTURE',
    {
      summary: 'Team runs experiments.',
      tags: [
        'Snowflake / dbt',
        'A/B · GrowthBook',
        'Causal inference',
        'CUPED',
        'Bayesian testing',
        'Open source',
        'MCP · продукт',
      ],
    },
    { scope },
  );
  f.add('T01', ['Redshift'], { scope });
  const llm = f.add('T03', true, { scope });
  const before = f.profile().scores;
  const infra = f.add(
    'T08_INFRA',
    {
      summary: 'Confirmed working environment.',
      tags: ['Jupyter', 'Postgre', 'Tableau', 'Snowflake'],
    },
    { scope },
  );
  const p = f.profile();
  const tags = companyResearchTags(p.observations);
  expect(tags.culture.map((t) => t.label).sort()).toEqual([
    'A/B platform',
    'Bayesian testing',
    'CUPED',
    'Causal inference',
    'LLM-assisted analysis',
  ]);
  expect(tags.infrastructure.map((t) => t.label).sort()).toEqual([
    'GrowthBook',
    'Jupyter',
    'PostgreSQL',
    'Redshift',
    'Snowflake',
    'Tableau',
    'dbt',
  ]);
  expect(tags.infrastructure.find((t) => t.label === 'Snowflake')?.observationIds).toContain(infra);
  expect(tags.infrastructure.find((t) => t.label === 'PostgreSQL')?.details).toContain(
    'https://example.test/role',
  );
  expect(tags.culture.find((t) => t.label === 'LLM-assisted analysis')?.observationIds).toContain(
    llm,
  );
  expect(tags.culture[0].scope).toContain('ES');
  expect(uncoveredTechnicalFacts(p.observations)).toEqual([]);
  expect(p.scores).toEqual(before); // descriptive infrastructure never adds points
  expect(p.columnSources.infrastructure.some((s) => s.url === 'https://example.test/role')).toBe(
    true,
  );
  // Another researched source can add tools in the same scope without erasing the first set.
  f.add(
    'T08_INFRA',
    { summary: 'Additional confirmed data tools.', tags: ['Kafka', 'Python'] },
    { scope },
  );
  const combined = f.profile();
  expect(companyResearchTags(combined.observations).infrastructure.map((t) => t.label)).toEqual(
    expect.arrayContaining(['Kafka', 'Python', 'Tableau', 'PostgreSQL']),
  );
  expect(combined.criteria.find((c) => c.criterion.id === 'T08_INFRA')?.conflicting).toBe(false);
});
it('does not promote pending, stale, low-confidence, rejected or disputed signals into tags', () => {
  const f = setup();
  f.add('T08_INFRA', { summary: 'Pending', tags: ['Kafka'] }, { verified: false });
  f.add('T08_INFRA', { summary: 'Historical', tags: ['Hadoop'] }, { date: '2020-01-01T00:00:00Z' });
  f.add('T08_INFRA', { summary: 'Weak claim', tags: ['Tableau'] }, { confidence: 'low' });
  const rejected = f.add('T08_INFRA', { summary: 'Rejected', tags: ['Postgres'] });
  f.research.review(rejected, { verified: false, rejected: true });
  f.add('T03', true, { scope: { country: 'ES' } });
  f.add('T03', false, { scope: { country: 'ES' } });
  expect(companyResearchTags(f.profile().observations).infrastructure).toEqual([]);
  expect(companyResearchTags(f.profile().observations).culture).toEqual([]);
  expect(uncoveredTechnicalFacts(f.profile().observations)).toHaveLength(2);
});
it('preserves scoped visa and relocation conditions in tags, and flags technical negatives before hiding columns', () => {
  const f = setup();
  const scope = {
    country: 'FR',
    role: 'Senior Product Analyst',
    job_url: 'https://example.test/france',
  };
  f.add('A01', ['en'], { scope });
  f.add('A04', true, { scope });
  const relocation = f.add('A04_RELOCATION', true, { scope });
  f.add('A04', false, { scope: { country: 'US', job_url: 'https://example.test/us' } });
  f.add('AN06', 'product_data'); // AN is not the availability section A
  const p = f.profile(),
    tags = comparisonHiringTags(p);
  expect(tags.benefits.map((t) => t.label).sort()).toEqual(['relocation', 'visa sponsorship']);
  expect(tags.benefits.find((t) => t.label === 'relocation')?.observationIds).toContain(relocation);
  expect(tags.benefits.find((t) => t.label === 'visa sponsorship')?.details).toContain('FR');
  expect(tags.benefits.find((t) => t.label === 'visa sponsorship')?.details).not.toContain(
    'https://example.test/us',
  );
  expect(uncoveredAvailabilityFacts(p)).toEqual([]);
  f.add('T03', false);
  expect(uncoveredTechnicalFacts(f.profile().observations).map((o) => o.value)).toEqual([false]);
});
it('imports infrastructure collection provenance through the same research preview contract', () => {
  const f = setup();
  const doc = {
    schema_version: '1.0',
    generated_at: new Date().toISOString(),
    research_mode: 'manual',
    companies: [
      {
        identity: { company_id: f.company.id, name: f.company.name },
        observations: [],
        job_urls: [],
        red_flags: [],
        notes: 'Fixture',
        collection_sources: [
          {
            name: 'Technical blog search',
            kind: 'web_search',
            description: 'Infrastructure research',
            observed_at: new Date().toISOString(),
            outcome: 'empty',
            columns: ['infrastructure'],
          },
        ],
      },
    ],
  };
  f.research.apply({ previewId: f.research.preview(doc).previewId, confirmed: true });
  expect(f.profile().columnSources.infrastructure).toMatchObject([
    { name: 'Technical blog search', outcome: 'empty' },
  ]);
});

it('preserves analytic role focus, mixed duties and A/B evidence in tags before hiding analytical scores', () => {
  const f = setup();
  const scope = { country: 'ES', role: 'Product Analyst', job_url: 'https://example.test/product' };
  const experiments = f.add('AN04', true, { scope });
  const product = f.add('AN06', 'product_data', { scope });
  const bi = f.add('AN06', 'bi_de_ml', { scope: { role: 'Reporting Analyst' } });
  const mixed = f.add('AN06', 'mixed', { scope: { role: 'Data Scientist' } });
  const noInfluence = f.add('AN01', false, { scope });
  const tags = companyResearchTags(f.profile().observations).culture;
  expect(tags.map((t) => t.label)).toEqual(
    expect.arrayContaining([
      'A/B platform',
      'Product/Data analytics',
      'BI / DE / ML focus',
      'Mixed analytics role',
      'Нет влияния на продуктовые решения',
    ]),
  );
  for (const id of [experiments, product, bi, mixed, noInfluence])
    expect(tags.some((t) => t.observationIds.includes(id))).toBe(true);
  expect(tags.find((t) => t.label === 'A/B platform')?.details).toContain(
    'https://example.test/product',
  );
  expect(uncoveredAnalyticsFacts(f.profile().observations)).toEqual([]);
  // A future useful criterion without a tag keeps the column; a conflict never becomes a tag.
  const publications = f.add('AN07', true);
  expect(uncoveredAnalyticsFacts(f.profile().observations).map((o) => o.id)).toEqual([
    publications,
  ]);
  f.add('AN04', false, { scope });
  expect(
    companyResearchTags(f.profile().observations).culture.some((t) => t.label === 'A/B platform'),
  ).toBe(false);
  expect(uncoveredAnalyticsFacts(f.profile().observations).some((o) => o.id === experiments)).toBe(
    true,
  );
});

it('shows verified employee publications in Analytics with their original scope and evidence, without rewriting research', () => {
  const f = setup();
  const publication = f.add('AN08', true, {
    scope: { role: 'Data Analytics II', context: 'Named employee; published case' },
  });
  f.add('AN08', true, { scope: { role: 'Pending author' }, verified: false });
  f.add('AN08', true, { scope: { role: 'Historical author' }, date: '2020-01-01T00:00:00Z' });
  f.add('AN08', true, { scope: { role: 'Disputed author' } });
  f.add('AN08', false, { scope: { role: 'Disputed author' } });
  const p = f.profile();
  const original = JSON.stringify({ observations: p.observations, scores: p.scores });
  const tag = companyCulture(p.observations).tags.find((t) => t.label === 'Публикации сотрудников');
  expect(tag?.observationIds).toEqual([publication]);
  expect(tag?.scope).toContain('Data Analytics II');
  expect(tag?.details).toContain('https://example.test/engineering');
  expect(tag?.details).toContain('Проверено ');
  expect(uncoveredAnalyticsFacts(p.observations).some((o) => o.id === publication)).toBe(false);
  expect(JSON.stringify({ observations: p.observations, scores: p.scores })).toBe(original);
  expect(f.profile().observations).toEqual(p.observations);
});
