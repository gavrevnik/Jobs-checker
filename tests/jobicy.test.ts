import { afterEach, describe, expect, it, vi } from 'vitest';
import { Store } from '../server/store';
import { SourceTools } from '../server/source-tools';
import { meteredFetcher, quota } from '../server/provider-io';
import { normalize } from '../server/providers';
import { sourceSchema, type Job, type Source } from '../shared/model';
import { CompanyResearch } from '../server/company-research';
import { webSearchPlan, searchSchema } from '../shared/source-tools';

const stores: Store[] = [];
const db = () => {
  const s = new Store(':memory:');
  stores.push(s);
  return s;
};
const budget = () => ({ used: 0, limit: 10, cacheHits: 0, observedAt: '' });
const response = (body: unknown) => new Response(JSON.stringify(body));
const row = (id: number, title = 'Product Analyst', level = 'Senior') => ({
  id,
  jobTitle: title,
  jobLevel: level,
  companyName: 'Acme',
  url: `https://jobicy.com/jobs/${id}`,
  jobGeo: 'Europe',
  jobDescription: '<p>SQL experiments</p>',
  jobIndustry: ['Data Science'],
  jobType: ['Full-Time'],
  pubDate: '2026-10-19T08:00:00Z',
});
const source: Source = {
  ...sourceSchema.parse({ provider: 'jobicy', name: 'Jobicy' }),
  id: 'discovery:jobicy',
  lastSync: '',
  lastAttempt: '',
  error: '',
  count: 0,
};
afterEach(() => {
  for (const s of stores.splice(0)) s.db.close();
  vi.useRealTimers();
});

describe('Jobicy public integration', () => {
  it('plans with no credentials/network and makes one feed target for multiple keywords', async () => {
    const store = db(),
      mock = vi.fn<typeof fetch>();
    const plan = await new SourceTools(store, mock).search({
      providers: ['jobicy'],
      keywords: ['product analyst', 'data analyst'],
    });
    expect(plan.targets).toHaveLength(1);
    expect(plan.providers[0]).toMatchObject({ id: 'jobicy', status: 'ready', missing: [] });
    expect(mock).not.toHaveBeenCalled();
    expect(store.list('jobs')).toHaveLength(0);
  });
  it('imports into the same company/target contract and preserves workflow on cached repeats', async () => {
    const store = db();
    const mock = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        response({ jobs: [row(1), row(2, 'Designer')], nextCursor: null }),
      );
    const tools = new SourceTools(store, mock);
    const args = {
      providers: ['jobicy'],
      keywords: ['product analyst', 'data analyst'],
      execute: true,
      store: true,
    };
    const first = await tools.search(args);
    expect(first.requests).toBe(1);
    expect(first.jobs).toHaveLength(1);
    const job = store.list<Job>('jobs')[0];
    expect(job).toMatchObject({
      source: 'jobicy',
      seniority: 'senior',
      location: 'Europe',
      url: 'https://jobicy.com/jobs/1',
    });
    expect(new CompanyResearch(store).profile(job.companyId).targetVacancies.total).toBe(1);
    store.updateJob(job.id, { stage: 'applied', favorite: true, notes: 'keep' });
    const again = await tools.search(args);
    expect(again.requests).toBe(0);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(store.list<Job>('jobs')).toHaveLength(1);
    expect(store.list<Job>('jobs')[0]).toMatchObject({
      id: job.id,
      stage: 'applied',
      favorite: true,
      notes: 'keep',
    });
    expect(quota(store, 'jobicy').today?.attempts).toBe(1);
  });
  it('uses explicit levels conservatively and never promotes Junior/Lead titles', () => {
    expect(normalize('jobicy', row(1, 'Data Analyst', ''), source).seniority).toBe('unknown');
    expect(normalize('jobicy', row(1, 'Data Analyst', 'Mid-Level'), source).seniority).toBe(
      'middle',
    );
    expect(normalize('jobicy', row(1, 'Junior Data Analyst', 'Senior'), source).seniority).toBe(
      'junior',
    );
    expect(normalize('jobicy', row(1, 'Lead Data Analyst', 'Senior'), source).seniority).toBe(
      'lead',
    );
  });
  it('permits cursor pages within a pass, shares the hourly guard across callers and resumes from cache', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-19T12:00:00Z'));
    const store = db();
    const mock = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url) =>
        response({ jobs: [row(1)], nextCursor: String(url).includes('cursor=') ? null : 'page2' }),
      );
    const tools = new SourceTools(store, mock);
    await tools.search({ providers: ['jobicy'], execute: true, maxPages: 2 });
    expect(mock).toHaveBeenCalledTimes(2);
    const other = meteredFetcher(store, 'jobicy', budget(), mock);
    await expect(other('https://jobicy.com/api/v2/remote-jobs?count=100')).rejects.toThrow(
      'раза в час',
    );
    await new SourceTools(store, mock).search({
      providers: ['jobicy'],
      execute: true,
      maxPages: 2,
    });
    expect(mock).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(3600001);
    await new SourceTools(store, mock).search({
      providers: ['jobicy'],
      execute: true,
      maxPages: 2,
    });
    expect(mock).toHaveBeenCalledTimes(4);
  });
  it('retains failed-pass guard and hard per-run budget', async () => {
    const store = db();
    const mock = vi.fn<typeof fetch>().mockRejectedValue(new Error('network failure'));
    await new SourceTools(store, mock).search({ providers: ['jobicy'], execute: true });
    const result = await new SourceTools(store, mock).search({
      providers: ['jobicy'],
      execute: true,
    });
    expect(result.results[0].error).toContain('раза в час');
    expect(mock).toHaveBeenCalledTimes(1);
    const second = db();
    const pages = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => response({ jobs: [row(1)], nextCursor: 'next' }));
    const limited = await new SourceTools(second, pages).search({
      providers: ['jobicy'],
      execute: true,
      maxPages: 2,
      maxRequests: 1,
    });
    expect(limited.results[0].error).toContain('лимит запросов');
    expect(pages).toHaveBeenCalledTimes(1);
  });
  it('does not close old jobs when they disappear from the 7-day feed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-19T12:00:00Z'));
    const store = db();
    const mock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ jobs: [row(1)], nextCursor: null }))
      .mockResolvedValueOnce(response({ jobs: [], nextCursor: null }));
    const tools = new SourceTools(store, mock);
    const args = { providers: ['jobicy'], execute: true, store: true };
    await tools.search(args);
    vi.advanceTimersByTime(3600001);
    await tools.search(args);
    expect(store.list<Job>('jobs')[0].stage).toBe('new');
    expect(store.observations()[0].missingCount).toBe(0);
  });
  it('exposes Workday and existing web platforms as query plans without doing network work', () => {
    const plan = webSearchPlan(searchSchema.parse({ keywords: ['Data Analyst'] }));
    expect(plan.map((p) => p.id)).toEqual(
      expect.arrayContaining(['workday', 'indeed', 'welcome', 'wellfound', 'eures']),
    );
    expect(plan.find((p) => p.id === 'workday')?.query).toContain('site:myworkdayjobs.com');
  });
  it('blocks paid headers and unchained cursors before network', async () => {
    const store = db(),
      mock = vi.fn<typeof fetch>();
    const f = meteredFetcher(store, 'jobicy', budget(), mock);
    await expect(
      f('https://jobicy.com/api/v2/remote-jobs', { headers: { Authorization: 'Bearer fake' } }),
    ).rejects.toThrow('бесплатный');
    await expect(f('https://jobicy.com/api/v2/remote-jobs?cursor=unrelated')).rejects.toThrow(
      'предыдущую',
    );
    expect(mock).not.toHaveBeenCalled();
  });
});
