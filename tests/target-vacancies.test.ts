import { describe, expect, it, vi } from 'vitest';
import { SourceTools } from '../server/source-tools';
import { normalize } from '../server/providers';
import {
  companySchema,
  jobSchema,
  sourceSchema,
  type Company,
  type Job,
  type Source,
} from '../shared/model';
import { jobAvailability, targetLevel } from '../shared/target-vacancies';
import { companyTargetVacancies } from '../server/company-target-vacancies';
import { companyPresentation } from '../src/company-presentation';
import { Store } from '../server/store';
import { CompanyResearch } from '../server/company-research';

const now = Date.parse('2026-10-16T12:00:00Z');
const recent = '2026-10-14T12:00:00Z';
const job = (id: string, input: Record<string, unknown> = {}): Job => ({
  ...jobSchema.parse({
    company: 'Fixture',
    title: 'Senior Product Analyst',
    location: 'Barcelona',
    ...input,
  }),
  id,
  companyId: 'co',
  sourceId: '',
  createdAt: recent,
  updatedAt: recent,
  lastSeenAt: recent,
  history: [],
  ...input,
});
describe('Target vacancies contract', () => {
  it('connects Adzuna search → ATS → comparison, preserves attribution on a pre-existing imported URL, and does not import store=false results', async () => {
    const store = new Store(':memory:');
    vi.stubEnv('ADZUNA_APP_ID', 'fixture');
    vi.stubEnv('ADZUNA_APP_KEY', 'fixture');
    try {
      const saved = store.addJob({
        company: 'Adzuna Fixture',
        title: 'Senior Product Analyst',
        seniority: 'senior',
        url: 'https://example.test/adzuna',
        source: 'import',
      }).job;
      const mock = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            results: [
              {
                id: 'adzuna-1',
                title: 'Senior Product Analyst',
                company: { display_name: 'Adzuna Fixture' },
                location: { display_name: 'Madrid, Spain' },
                redirect_url: saved.url,
                description: 'SQL and experimentation',
              },
            ],
          }),
        ),
      );
      const tools = new SourceTools(store, mock);
      const args = {
        providers: ['adzuna'],
        country: 'es',
        keywords: ['Product Analyst'],
        execute: true,
        maxRequests: 1,
      };
      await tools.search({ ...args, store: false });
      expect(new CompanyResearch(store).profile(saved.companyId).targetVacancies.open).toBe(0);
      await tools.search({ ...args, store: true });
      const targets = new CompanyResearch(store).profile(saved.companyId).targetVacancies;
      expect(targets.total).toBe(1);
      expect(targets.open).toBe(1);
      expect(targets.jobIds).toEqual([saved.id]);
      expect(targets.sources.some((s) => s.label === 'Adzuna' && !!s.updatedAt)).toBe(true);
      expect(mock).toHaveBeenCalledTimes(1); // second read uses the provider cache
    } finally {
      store.db.close();
      vi.unstubAllEnvs();
    }
  });
  it.each([
    'adzuna',
    'serpapi',
    'jooble',
    'arbeitnow',
    'remotive',
    'jobicy',
    'greenhouse',
    'lever',
    'ashby',
    'smartrecruiters',
  ] as const)('connects normalized %s postings to the same company/ATS contract', (provider) => {
    const store = new Store(':memory:');
    try {
      const source: Source = {
        ...sourceSchema.parse({
          provider,
          name: 'Provider Fixture',
          board: 'fixture',
          country: 'es',
        }),
        id: `discovery:${provider}`,
        lastSync: '',
        lastAttempt: '',
        error: '',
        count: 0,
      };
      const raw = {
        id: '1',
        slug: '1',
        job_id: '1',
        jobTitle: 'Senior Data Analyst',
        companyName: 'Provider Fixture',
        jobGeo: 'Madrid',
        title: 'Senior Data Analyst',
        text: 'Senior Data Analyst',
        name: 'Senior Data Analyst',
        company_name: 'Provider Fixture',
        company:
          provider === 'adzuna'
            ? { display_name: 'Provider Fixture' }
            : provider === 'smartrecruiters'
              ? { name: 'Provider Fixture' }
              : 'Provider Fixture',
        location: ['adzuna', 'greenhouse', 'smartrecruiters'].includes(provider)
          ? { name: 'Madrid', display_name: 'Madrid', city: 'Madrid' }
          : 'Madrid',
        candidate_required_location: 'Madrid',
        categories: { location: 'Madrid' },
        url: 'https://example.test/role',
        redirect_url: 'https://example.test/role',
        absolute_url: 'https://example.test/role',
        hostedUrl: 'https://example.test/role',
        jobUrl: 'https://example.test/role',
        link: 'https://example.test/role',
        apply_options: [{ link: 'https://example.test/role' }],
      };
      const normalized = normalize(provider, raw, source);
      const ids = store.ingestJobs([normalized], source.id).ids;
      const saved = store.list<Job>('jobs')[0];
      const targets = new CompanyResearch(store).profile(saved.companyId).targetVacancies;
      expect(targets.total).toBe(1);
      expect(targets.open).toBe(1);
      expect(targets.jobIds).toEqual(ids);
      expect(targets.sources.some((s) => s.id === `provider:${provider}`)).toBe(true);
    } finally {
      store.db.close();
    }
  });
  it('uses explicit middle/senior Product/Data Analyst roles and rejects adjacent roles and unknown grades', () => {
    for (const title of [
      'Senior Product Analyst',
      'Sr. Data Analyst',
      'Senior Product Data Analyst',
      'Senior Product & Data Analyst',
      'Data Analyst II',
    ]) {
      expect(targetLevel(job(title, { title })), title).not.toBeNull();
    }
    expect(targetLevel(job('middle', { title: 'Product Analyst', seniority: 'middle' }))).toBe(
      'middle',
    );
    for (const title of [
      'Product Analyst',
      'Analyst II, Full Stack',
      'Analytics Engineer II',
      'Senior Business Analyst',
      'Senior Data Scientist',
      'Lead Data Analyst',
      'Junior Data Analyst',
      'Product Manager',
      'Senior Product Analyst / Manager',
    ]) {
      expect(targetLevel(job(title, { title })), title).toBeNull();
    }
    expect(targetLevel(job('junior', { title: 'Data Analyst', seniority: 'junior' }))).toBeNull();
  });
  it('keeps stale/unknown/archived distinct from open and uses fresh evidence from any observing source', () => {
    expect(jobAvailability(job('a', { lastSeenAt: '' }), [], now).state).toBe('unverified');
    expect(jobAvailability(job('a', { lastSeenAt: '2025-01-01' }), [], now).state).toBe('stale');
    expect(jobAvailability(job('a', { stage: 'archived' }), [], now).state).toBe('closed');
    expect(jobAvailability(job('a', { lastSeenAt: '2099-01-01' }), [], now).state).toBe(
      'unverified',
    );
    const gone = { sourceId: 'old', jobId: 'a', lastSeenAt: recent, missingCount: 2 };
    expect(jobAvailability(job('a'), [gone], now).state).toBe('closed');
    expect(
      jobAvailability(job('a'), [gone, { ...gone, sourceId: 'new', missingCount: 0 }], now).state,
    ).toBe('open');
  });
  it('counts all saved dates and deduplicates URLs without marking historical cities green', () => {
    const a = job('a', {
      url: 'https://example.test/jobs/1',
      location: 'Paris',
      lastSeenAt: '2024-01-01',
    });
    const b = job('b', { url: a.url, location: 'Barcelona' });
    const c = job('c', {
      title: 'Data Analyst',
      seniority: 'middle',
      location: 'Berlin',
      lastSeenAt: '2024-01-01',
      stage: 'archived',
    });
    const result = companyTargetVacancies(
      'co',
      [a, b, c, job('other', { companyId: 'different' })],
      [],
      [],
      now,
    );
    expect(result.total).toBe(2);
    expect(result.open).toBe(1);
    expect(result.closed).toBe(1);
    expect(result.openOffices.map((o) => o.name)).toEqual(['Barcelona']);
    expect(result.closedOffices.map((o) => o.name)).toEqual(['Berlin']);
    expect(result.jobIds.sort()).toEqual(['b', 'c']);
    expect(result.jobs[0].atsJobIds.sort()).toEqual(['a', 'b']);
    expect(result.offices.map((o) => [o.name, o.open])).toEqual([
      ['Barcelona', true],
      ['Berlin', false],
      ['Paris', false],
    ]);
    expect(
      companyTargetVacancies('co', [job('remote', { location: 'Remote, Spain' })], [], [], now)
        .offices,
    ).toEqual([]);
  });
  it('does not count stale or unverified vacancies and their offices as closed', () => {
    const result = companyTargetVacancies(
      'co',
      [
        job('open', { location: 'Dublin' }),
        job('closed', { location: 'Berlin', stage: 'archived' }),
        job('old', { location: 'Paris', lastSeenAt: '2024-01-01' }),
        job('unknown', { location: 'Madrid', lastSeenAt: '' }),
      ],
      [],
      [],
      now,
    );
    expect({
      total: result.total,
      open: result.open,
      closed: result.closed,
      needsReview: result.needsReview,
    }).toEqual({ total: 4, open: 1, closed: 1, needsReview: 2 });
    expect(result.openOffices.map((o) => o.name)).toEqual(['Dublin']);
    expect(result.closedOffices.map((o) => o.name)).toEqual(['Berlin']);
  });
  it('dates used sources from successful sync/observations rather than edits and skips unused boards', () => {
    const board = (id: string, lastSync = ''): Source => ({
      ...sourceSchema.parse({ provider: 'ashby', name: id, board: id, companyId: 'co' }),
      id,
      lastSync,
      lastAttempt: '',
      error: '',
      count: 0,
    });
    const result = companyTargetVacancies(
      'co',
      [job('j', { sourceId: 'used' }), job('manual', { source: 'manual', lastSeenAt: '' })],
      [board('used', recent), board('unused')],
      [],
      now,
    );
    expect(result.sources.map((s) => [s.id, s.updatedAt])).toEqual([
      ['used', recent],
      ['provider:manual', ''],
    ]);
  });
  it('exposes the same ATS identities independently of country and search profile without mutating stored jobs', () => {
    const store = new Store(':memory:');
    try {
      const saved = store.addJob({
        company: 'Fixture',
        title: 'Senior Data Analyst',
        location: 'Berlin',
        seniority: 'senior',
      }).job;
      const before = store.list<Job>('jobs');
      const profile = new CompanyResearch(store).profile(saved.companyId, 'ES');
      expect(profile.currentJobs).toHaveLength(0);
      expect(profile.targetVacancies.jobIds).toEqual([saved.id]);
      expect(profile.targetVacancies.total).toBe(1);
      expect(profile.targetVacancies.open).toBe(0);
      expect(store.list<Job>('jobs')).toEqual(before);
    } finally {
      store.db.close();
    }
  });
});
describe('Company column projection', () => {
  const company = (input: Record<string, unknown> = {}): Company => ({
    ...companySchema.parse({ name: 'Fixture', ...input }),
    id: 'co',
    createdAt: '',
    updatedAt: '',
  });
  it('compacts headcount without source caveats or inventing a startup stage', () => {
    const p = companyPresentation(
      company({
        companyType: 'gaming',
        sizeCategory: 'large',
        size: '1 001–5 000 сотрудников по корпоративной странице LinkedIn; размер группы.',
        description: 'Игровая студия. Создаёт мобильные игры. https://source.example',
      }),
      [],
    );
    expect(p.businessType).toBe('Gaming');
    expect(p.size).toBe('Крупная · 1 001–5 000 человек');
    expect(p.tagline).toBe('Игровая студия.');
    expect(p.description).toBe('Игровая студия. Создаёт мобильные игры.');
  });
  it('uses dashes and hides unknown business type instead of default badges', () => {
    expect(
      companyPresentation(
        company({
          size: 'Численность не подтверждена: LinkedIn указывает 1 001–5 000 участников.',
        }),
        [],
      ).size,
    ).toBe('—');
    expect(companyPresentation(company(), [])).toMatchObject({
      businessType: '',
      size: '—',
      tagline: '—',
      description: '—',
      blogs: [],
    });
  });
  it('projects existing research descriptions and deduplicates real technical links without changing verification', () => {
    const store = new Store(':memory:');
    try {
      const c = store.saveCompany({ name: 'Fixture' });
      const research = new CompanyResearch(store);
      for (const criterion_id of ['B04', 'AN07', 'AN08'])
        research.manual(c.id, {
          criterion_id,
          value: criterion_id === 'B04' ? 'Платформа обучения. Продаёт подписки.' : true,
          confidence: 'high',
          scope: {},
          reasoning: 'Fixture',
          evidence: [
            {
              source_type: criterion_id === 'B04' ? 'official' : 'engineering',
              url: 'https://engineering.example/blog/analytics',
              title: 'Data blog',
              observed_at: new Date().toISOString(),
              excerpt: 'Fixture source',
            },
          ],
        });
      const profile = research.profile(c.id);
      const before = JSON.stringify(profile.observations);
      const p = companyPresentation(c, profile.observations);
      expect(p.tagline).toBe('Платформа обучения.');
      expect(p.blogs).toHaveLength(1);
      expect(JSON.stringify(research.profile(c.id).observations)).toBe(before);
      expect(profile.scores.AN.pass).toBe(0);
    } finally {
      store.db.close();
    }
  });
});
