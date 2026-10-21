import { afterEach, describe, expect, it, vi } from 'vitest';
import { Store } from '../server/store';
import { SourceTools } from '../server/source-tools';
import { meteredFetcher, quota } from '../server/provider-io';
import { fetchJobs, normalize, SyncService } from '../server/providers';
import { acceptsJob, searchSchema, webSearchPlan } from '../shared/source-tools';
import { jobSchema, sourceSchema, type Job, type Source } from '../shared/model';
const stores: Store[] = [];
const db = () => {
  const s = new Store(':memory:');
  stores.push(s);
  return s;
};
const response = (body: unknown) => new Response(JSON.stringify(body));
const board = (provider: Source['provider']): Source => ({
  ...sourceSchema.parse({ provider, board: 'Acme', name: 'Acme', country: 'de' }),
  id: 'board',
  lastSync: '',
  lastAttempt: '',
  count: 0,
  error: '',
});
const posting = {
  id: 'role-1',
  title: 'Senior Product Analyst',
  company_name: 'Acme',
  location: 'Berlin, Germany',
  slug: 'role-1',
  remote: true,
  url: 'https://example.com/role-1',
  jobUrl: 'https://example.com/role-1',
  isListed: true,
  workplaceType: 'Remote',
  descriptionPlain: 'SQL experiments',
};
afterEach(() => {
  for (const s of stores.splice(0)) s.db.close();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
describe('Provider tools and ATS ingestion', () => {
  it('keeps UK and German Arbeitnow cache, source identity and workflow independent', async () => {
    const s = db();
    const mock = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      const uk = new URL(String(url)).hostname === 'www.arbeitnow.co.uk';
      return response({
        data: [
          {
            ...posting,
            url: `https://${uk ? 'www.arbeitnow.co.uk' : 'www.arbeitnow.com'}/jobs/shared-slug`,
            location: uk ? 'London' : 'Berlin',
            tags: ['x'.repeat(200), '<b>Analytics</b>'],
          },
        ],
      });
    });
    const tools = new SourceTools(s, mock);
    const args = { providers: ['arbeitnow'], keywords: ['analyst'], execute: true, store: true };
    const de = await tools.search(args);
    s.updateJob(de.jobs[0].atsId!, { stage: 'saved', notes: 'Keep German workflow' });
    const uk = await tools.search({ ...args, country: 'gb' });
    expect(uk.targets[0]).toMatchObject({
      name: 'Arbeitnow UK',
      country: 'gb',
      sourceId: 'discovery:arbeitnow:gb',
    });
    expect(uk.jobs[0]).toMatchObject({
      source: 'arbeitnow',
      location: 'London',
      seniority: 'senior',
    });
    expect(uk.jobs[0].tags).toEqual(['x'.repeat(80), 'Analytics']);
    expect(s.list<Job>('jobs')).toHaveLength(2);
    expect(s.get<Job>('jobs', de.jobs[0].atsId!)?.notes).toBe('Keep German workflow');
    expect((await tools.search({ ...args, country: 'gb' })).requests).toBe(0);
    expect(mock).toHaveBeenCalledTimes(2);
  });
  it('stores only reviewed external IDs even when the search filters are broad', async () => {
    const s = db();
    const mock = vi.fn<typeof fetch>().mockResolvedValue(
      response({
        jobs: [posting, { ...posting, id: 'role-2', jobUrl: 'https://example.com/role-2' }],
      }),
    );
    const tools = new SourceTools(s, mock);
    tools.addBoard({ provider: 'ashby', board: 'Acme', name: 'Acme' });
    const result = await tools.search({
      providers: ['ashby'],
      externalIds: ['role-2'],
      execute: true,
      store: true,
    });
    expect(result.jobs.map((j) => j.externalId)).toEqual(['role-2']);
    expect(s.list<Job>('jobs').map((j) => j.externalId)).toEqual(['role-2']);
  });
  it('plans without network calls or importing records when tokens are missing', async () => {
    const s = db(),
      mock = vi.fn<typeof fetch>(),
      tools = new SourceTools(s, mock);
    vi.stubEnv('SERPAPI_API_KEY', '');
    const result = await tools.search({
      providers: ['serpapi'],
      keywords: ['analyst'],
      store: true,
    });
    expect(result.execute).toBe(false);
    expect(mock).not.toHaveBeenCalled();
    expect(s.list('jobs')).toHaveLength(0);
    expect(result.providers[0].missing).toContain('SERPAPI_API_KEY');
  });
  it('ingests by keyword, respects excludes, preserves workflow and reuses shared cache', async () => {
    const s = db(),
      mock = vi.fn<typeof fetch>().mockImplementation(async () =>
        response({
          data: [
            posting,
            { ...posting, slug: '2', url: 'https://example.com/2', title: 'Recruiter' },
          ],
        }),
      );
    const tools = new SourceTools(s, mock);
    const args = { providers: ['arbeitnow'], keywords: ['analyst'], execute: true, store: true };
    const first = await tools.search(args);
    expect(first.jobs).toHaveLength(1);
    expect(first.results[0].added).toBe(1);
    const job = s.list<Job>('jobs')[0];
    s.updateJob(job.id, { stage: 'interview', notes: 'keep', favorite: true });
    const lastSeen = job.lastSeenAt;
    await tools.search(args);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(s.list<Job>('jobs')[0]).toMatchObject({
      stage: 'interview',
      notes: 'keep',
      favorite: true,
      lastSeenAt: lastSeen,
    });
    expect(s.observations()).toHaveLength(1);
    expect((await tools.search({ ...args, exclude: ['SQL'] })).jobs).toHaveLength(1); // no description in fixture
    expect((await tools.search({ ...args, exclude: ['Analyst'] })).jobs).toHaveLength(0);
  });
  it('uses saved board filters through the legacy sync button too', async () => {
    const s = db();
    const profile = s.saveProfile({ name: 'Analysts', keywords: ['Analyst'] });
    const source = new SourceTools(s).addBoard({
      provider: 'ashby',
      board: 'Acme',
      name: 'Acme',
      profileId: profile.id,
    });
    const mock = vi.fn<typeof fetch>().mockResolvedValue(
      response({
        jobs: [
          posting,
          { ...posting, id: 'other', jobUrl: 'https://example.com/other', title: 'Recruiter' },
        ],
      }),
    );
    await new SyncService(s, mock).run(source.id);
    expect(s.list<Job>('jobs').map((j) => j.title)).toEqual(['Senior Product Analyst']);
  });
  it('applies explicit profile filters and does not infer remote eligibility or salary', () => {
    const j = jobSchema.parse({
      title: 'Senior analyst',
      company: 'Acme',
      workMode: 'remote',
      location: 'US only',
    });
    expect(acceptsJob(j, searchSchema.parse({ locations: ['Europe'] }))).toBe(false);
    expect(acceptsJob(j, searchSchema.parse({ minSalary: 1 }))).toBe(false);
    expect(acceptsJob(j, searchSchema.parse({ seniority: 'senior' }))).toBe(false); // explicit unknown
    expect(acceptsJob(j, searchSchema.parse({ maxAgeDays: 7, includeUnknownDate: false }))).toBe(
      false,
    );
    expect(acceptsJob(j, searchSchema.parse({ maxAgeDays: 7 }))).toBe(true);
  });
  it('isolates missing credentials and disabled adapters from a working provider', async () => {
    vi.stubEnv('SERPAPI_API_KEY', '');
    const s = db(),
      mock = vi.fn<typeof fetch>().mockImplementation(async () => response({ data: [posting] }));
    const tools = new SourceTools(s, mock);
    tools.configure('remotive', { enabled: false });
    const result = await tools.search({
      providers: ['serpapi', 'remotive', 'arbeitnow'],
      execute: true,
    });
    expect(result.results.filter((r) => r.error)).toHaveLength(2);
    expect(result.jobs).toHaveLength(1);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(new SourceTools(s).status().providers.find((p) => p.id === 'remotive')?.status).toBe(
      'disabled',
    );
  });
  it('enforces a batch request budget and never stores a truncated board snapshot', async () => {
    const s = db(),
      mock = vi.fn<typeof fetch>().mockImplementation(async () =>
        response(
          Array.from({ length: 100 }, (_, i) => ({
            text: 'Analyst',
            id: i,
            hostedUrl: `https://example.com/${i}`,
          })),
        ),
      );
    new SourceTools(s).addBoard({ provider: 'lever', name: 'Acme', board: 'Acme' });
    const result = await new SourceTools(s, mock).monitor({ execute: true, maxRequests: 1 });
    expect(mock).toHaveBeenCalledTimes(1);
    expect(result.results?.[0].error).toContain('лимит');
    expect(s.list('jobs')).toHaveLength(0);
    expect(s.observations()).toHaveLength(0);
  });
  it('marks missing only after full fresh snapshots and keeps ATS stages', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-03T08:00:00Z'));
    const s = db(),
      mock = vi.fn<typeof fetch>().mockImplementation(async () => response({ jobs: [posting] }));
    const tools = new SourceTools(s, mock);
    tools.addBoard({ provider: 'ashby', board: 'Acme', name: 'Acme', intervalHours: 6 });
    await tools.monitor({ execute: true });
    const job = s.list<Job>('jobs')[0];
    s.updateJob(job.id, { stage: 'applied', notes: 'preserve' });
    mock.mockImplementation(async () => response({ jobs: [] }));
    vi.advanceTimersByTime(7 * 3600000);
    await tools.monitor({ execute: true });
    expect(s.observations()[0].missingCount).toBe(1);
    await tools.monitor({ execute: true });
    expect(s.observations()[0].missingCount).toBe(1);
    vi.advanceTimersByTime(7 * 3600000);
    mock.mockImplementation(async () => new Response('', { status: 503 }));
    await tools.monitor({ execute: true });
    expect(s.observations()[0].missingCount).toBe(1);
    vi.advanceTimersByTime(7 * 3600000);
    mock.mockImplementation(async () => response({ jobs: [] }));
    await tools.monitor({ execute: true });
    expect(s.observations()[0].missingCount).toBe(2);
    expect(s.list<Job>('jobs')[0]).toMatchObject({ stage: 'applied', notes: 'preserve' });
    vi.advanceTimersByTime(7 * 3600000);
    mock.mockImplementation(async () => response({ jobs: [posting] }));
    await tools.monitor({ execute: true });
    expect(s.observations()[0].missingCount).toBe(0);
  });
  it('does not mark filtered-out jobs missing on an intact board', async () => {
    const s = db();
    const source = new SourceTools(s).addBoard({ provider: 'ashby', board: 'Acme', name: 'Acme' });
    const job = normalize('ashby', posting, source);
    s.transaction(() => s.ingestJobs([job], source.id, [job]));
    s.transaction(() => s.ingestJobs([], source.id, [job]));
    expect(s.observations()[0].missingCount).toBe(0);
  });
  it('keeps separate source observations when multiple adapters find the same canonical URL', () => {
    const s = db(),
      job = jobSchema.parse({
        title: 'Analyst',
        company: 'Acme',
        externalId: 'x',
        url: 'https://example.com/job?utm_source=a',
      });
    s.transaction(() => {
      s.ingestJobs([job], 'a');
      s.ingestJobs([{ ...job, url: 'https://example.com/job', externalId: 'other' }], 'b');
    });
    expect(s.list('jobs')).toHaveLength(1);
    expect(s.observations()).toHaveLength(2);
  });
  it('remaps company and profile board links on export/import into a fresh database', () => {
    const s = db(),
      other = db();
    const profile = s.saveProfile({ name: 'Product' });
    new SourceTools(s).addBoard({
      name: 'Acme',
      provider: 'ashby',
      board: 'Acme',
      profileId: profile.id,
    });
    other.importData(s.state());
    const source = other.list<Source>('sources').find((v) => v.provider === 'ashby')!;
    expect(other.get('companies', source.companyId)).toBeDefined();
    expect(other.get('profiles', source.profileId)).toBeDefined();
    expect(source.monitoring).toBe(true);
  });
  it('registers EU Lever links and rejects mismatched or arbitrary hosts atomically', () => {
    const s = db(),
      tools = new SourceTools(s);
    expect(
      tools.addBoard({ provider: 'lever', name: 'Acme', board: 'https://jobs.eu.lever.co/Acme' })
        .region,
    ).toBe('eu');
    expect(() =>
      tools.addBoard({ provider: 'ashby', name: 'Bad', board: 'https://localhost/private' }),
    ).toThrow();
    expect(s.list('companies')).toHaveLength(1);
  });
  it('prepares web search using the profile and does not fabricate results', () => {
    const plan = webSearchPlan(
      searchSchema.parse({
        keywords: ['product analyst | product analytics'],
        locations: ['Berlin'],
        exclude: ['intern'],
      }),
    );
    expect(plan[0].query).toContain('site:linkedin.com/jobs/view');
    expect(plan[0].query).toContain('OR');
    expect(plan[0].query).toContain('-"intern"');
  });
});
describe('Additional provider contracts and quotas', () => {
  it('paginates SmartRecruiters on totalFound and normalizes detail sections', async () => {
    const mock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({
          totalFound: 101,
          content: Array.from({ length: 100 }, (_, id) => ({
            id,
            name: 'Analyst',
            location: { city: 'Berlin' },
          })),
        }),
      )
      .mockResolvedValueOnce(response({ totalFound: 101, content: [{ id: 101, name: 'Final' }] }));
    const jobs = await fetchJobs(board('smartrecruiters'), mock);
    expect(jobs).toHaveLength(101);
    expect(String(mock.mock.calls[1][0])).toContain('offset=100');
    expect(
      normalize(
        'smartrecruiters',
        { id: 'a', name: 'Role', jobAd: { sections: { jobDescription: { text: '<p>SQL</p>' } } } },
        board('smartrecruiters'),
      ).description,
    ).toBe('SQL');
  });
  it('preserves SmartRecruiters enrichment during subsequent list refreshes', () => {
    const s = db(),
      source = board('smartrecruiters');
    const full = normalize(
      'smartrecruiters',
      {
        id: 'detail',
        name: 'Analyst',
        jobAd: { sections: { description: { text: '<p>SQL experiments</p>' } } },
      },
      source,
    );
    const saved = s.addJob(full, source.id, true).job;
    s.updateJob(saved.id, { stage: 'saved', notes: 'prepare' });
    const summary = normalize('smartrecruiters', { id: 'detail', name: 'Analyst' }, source);
    s.transaction(() => s.ingestJobs([summary], source.id));
    expect(s.get<Job>('jobs', saved.id)).toMatchObject({
      description: 'SQL experiments',
      stage: 'saved',
      notes: 'prepare',
    });
  });
  it('follows only SerpAPI tokens, preserves unknown dates and authenticates server-side', async () => {
    vi.stubEnv('SERPAPI_API_KEY', 'fixture-key');
    const mock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({
          jobs_results: [
            {
              job_id: 'a',
              title: 'Analyst',
              company_name: 'Acme',
              detected_extensions: { posted_at: '2 days ago' },
              apply_options: [{ link: 'https://example.com/a' }],
            },
          ],
          serpapi_pagination: { next_page_token: 'next', next: 'https://evil.example' },
        }),
      )
      .mockResolvedValueOnce(response({ jobs_results: [] }));
    const jobs = await fetchJobs({ ...board('serpapi'), query: 'Analyst' }, mock, { maxPages: 2 });
    expect(jobs[0].publishedAt).toBe('');
    expect(jobs[0].url).toBe('https://example.com/a');
    expect(String(mock.mock.calls[1][0])).toContain('serpapi.com/search.json');
    expect(String(mock.mock.calls[1][0])).toContain('next_page_token=next');
  });
  it('uses Jooble regional POST and rejects mismatched key markets before calling', async () => {
    vi.stubEnv('JOOBLE_API_KEY', 'fixture-key');
    vi.stubEnv('JOOBLE_COUNTRY', 'de');
    vi.stubEnv('JOOBLE_HOST', 'de.jooble.org');
    const mock = vi.fn<typeof fetch>().mockResolvedValue(
      response({
        jobs: [
          {
            id: 'a',
            title: 'Analyst',
            company: 'Acme',
            link: 'https://example.com/a',
            updated: '2026-10-02',
          },
        ],
      }),
    );
    expect((await fetchJobs(board('jooble'), mock))[0].publishedAt).toBe('');
    expect(mock.mock.calls[0][1]?.method).toBe('POST');
    expect(String(mock.mock.calls[0][0])).toContain('de.jooble.org');
    await expect(fetchJobs({ ...board('jooble'), country: 'gb' }, mock)).rejects.toThrow(
      'JOOBLE_COUNTRY',
    );
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it('caps SerpAPI requests across instances and never leaks secrets into status or cache', async () => {
    vi.stubEnv('SERPAPI_API_KEY', 'fixture-secret');
    const s = db(),
      mock = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          response({ jobs_results: [], search_parameters: { api_key: 'fixture-secret' } }),
        );
    const f = meteredFetcher(
      s,
      'serpapi',
      { used: 0, limit: 1, cacheHits: 0, observedAt: '' },
      mock,
    );
    await f('https://serpapi.com/search.json?api_key=fixture-secret');
    expect(JSON.stringify(s.db.prepare('SELECT * FROM provider_cache').all())).not.toContain(
      'fixture-secret',
    );
    for (let i = 0; i < 249; i++)
      s.db
        .prepare('INSERT INTO provider_requests(provider,at) VALUES (?,?)')
        .run('serpapi', new Date().toISOString());
    expect(quota(s, 'serpapi').remaining).toBe(0);
    await expect(
      meteredFetcher(
        s,
        'serpapi',
        { used: 0, limit: 10, cacheHits: 0, observedAt: '' },
        mock,
      )('https://serpapi.com/search.json?q=new'),
    ).rejects.toThrow('лимит API');
    expect(JSON.stringify(new SourceTools(s).status())).not.toContain('fixture-secret');
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it('shares the Remotive rate limit across queries and instances', async () => {
    const s = db(),
      mock = vi.fn<typeof fetch>().mockResolvedValue(response({ jobs: [] }));
    const f = () =>
      meteredFetcher(s, 'remotive', { used: 0, limit: 10, cacheHits: 0, observedAt: '' }, mock);
    await f()('https://remotive.com/api/remote-jobs');
    await f()('https://remotive.com/api/remote-jobs');
    await expect(f()('https://remotive.com/api/remote-jobs?changed=1')).rejects.toThrow('частоты');
    expect(mock).toHaveBeenCalledTimes(1);
  });
});
