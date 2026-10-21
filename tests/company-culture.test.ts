import { expect, it } from 'vitest';
import { Store } from '../server/store';
import { CompanyResearch } from '../server/company-research';
import { companyCulture } from '../src/company-culture';
import { companySummaryText } from '../src/company-summary';
import { employerKey, analyticsMaterial } from '../scripts/collect-company-materials';

it('shows only verified fresh culture tags, preserves job scope, GitHub identity links and dated traffic without changing scores', () => {
  const store = new Store(':memory:');
  try {
    const c = store.saveCompany({ name: 'Culture fixture' }),
      research = new CompanyResearch(store),
      before = research.profile(c.id).scores;
    const add = (
      id: string,
      value: unknown,
      url: string,
      source_type = 'engineering',
      scope: Record<string, string> = {},
    ) => {
      research.manual(c.id, {
        criterion_id: id,
        value,
        confidence: 'high',
        scope,
        reasoning: 'Read content',
        evidence: [
          {
            url,
            title: 'Fixture source',
            source_type,
            observed_at: new Date().toISOString(),
            excerpt: 'The team uses Spark and A/B experiments.',
          },
        ],
      });
      return research.profile(c.id).observations[0];
    };
    const pending = add(
      'AN09_CULTURE',
      { summary: 'Экспериментальная платформа для продуктовых решений.', tags: ['A/B', 'Spark'] },
      'https://blog.example/experiments',
    );
    expect(companyCulture(research.profile(c.id).observations).tags).toEqual([]);
    research.review(pending.id, { verified: true });
    const job = add(
      'AN09_CULTURE',
      { summary: 'В роли аналитика требуется LLM-инструментарий.', tags: ['LLM'] },
      'https://jobs.example/role',
      'job',
      { job_url: 'https://jobs.example/role', role: 'Senior Data Analyst' },
    );
    research.review(job.id, { verified: true });
    const github = add('AN07', true, 'https://github.com/company/experiments');
    research.review(github.id, { verified: true });
    const traffic = add(
      'B06',
      '100 млн MAU · сентябрь 2026, не число клиентов.',
      'https://ir.example/report',
      'report',
    );
    research.review(traffic.id, { verified: true });
    const p = research.profile(c.id),
      culture = companyCulture(p.observations);
    expect(culture.tags.map((t) => t.label).sort()).toEqual(['A/B', 'LLM']);
    expect(culture.tags.find((t) => t.label === 'LLM')?.scope).toContain('По вакансии');
    expect(culture.github[0].url).toContain('github.com/company/experiments');
    expect(culture.traffic[0].text).toContain('MAU');
    const historical = p.observations.map((o) => ({
      ...o,
      evidence: o.evidence.map((e) => ({ ...e, published_at: '2020-01-01' })),
    }));
    expect(companyCulture(historical).tags).toEqual([]);
    expect(companyCulture(historical).github).toHaveLength(1);
    expect(companyCulture(historical).traffic[0].date).toBe('2020-01-01');
    expect(p.scores.A).toEqual(before.A);
    expect(p.scores.AN.pass).toBe(1); // AN07 only; AN09 is descriptive
    expect(companySummaryText(p)).toContain('Экспериментальная платформа');
    research.review(pending.id, { verified: false, rejected: true });
    expect(
      companyCulture(research.profile(c.id).observations).tags.map((t) => t.label),
    ).not.toContain('Spark');
  } finally {
    store.db.close();
  }
});
it('preserves named API and web-search provenance, including empty/error results per column', () => {
  const store = new Store(':memory:');
  try {
    const c = store.saveCompany({ name: 'Provenance fixture' }),
      research = new CompanyResearch(store);
    const doc = {
      schema_version: '1.0',
      generated_at: new Date().toISOString(),
      research_mode: 'internal_discovery',
      companies: [
        {
          identity: { name: c.name, company_id: c.id },
          observations: [],
          job_urls: [],
          red_flags: [],
          notes: 'Authorized refresh',
          collection_sources: [
            {
              name: 'Adzuna API',
              kind: 'api',
              description: 'Агрегатор вакансий',
              observed_at: new Date().toISOString(),
              outcome: 'empty',
              query: 'company=fixture',
              columns: ['target_vacancies'],
            },
            {
              name: 'Web search',
              kind: 'web_search',
              description: 'Поиск аналитических публикаций',
              observed_at: new Date().toISOString(),
              outcome: 'success',
              query: 'fixture analytics',
              columns: ['analytics_culture', 'business'],
            },
          ],
        },
      ],
    };
    research.apply({ previewId: research.preview(doc).previewId, confirmed: true });
    const p = research.profile(c.id);
    expect(p.columnSources.target_vacancies).toMatchObject([
      { name: 'Adzuna API', outcome: 'empty' },
    ]);
    expect(p.columnSources.business[0].kind).toBe('web_search');
    expect(p.columnSources.company).toEqual([]);
  } finally {
    store.db.close();
  }
});
it('matches existing employer identity conservatively and distinguishes analytic materials from unrelated postings', () => {
  expect(employerKey('Credit Wellness, LLC')).toBe(employerKey('Credit Wellness'));
  expect(employerKey('Glovo')).not.toBe(employerKey('Delivery Hero'));
  expect(analyticsMaterial('Senior Data Engineer')).toBe(true);
  expect(analyticsMaterial('Product Manager')).toBe(false);
});
