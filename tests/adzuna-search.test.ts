import { afterEach, describe, expect, it, vi } from 'vitest';
import { Store } from '../server/store';
import { SourceTools } from '../server/source-tools';
import { adzunaSearchParams } from '../shared/adzuna';
import { searchSchema } from '../shared/source-tools';

const stores: Store[] = [];
const setup = () => {
  vi.stubEnv('ADZUNA_APP_ID', 'test-app');
  vi.stubEnv('ADZUNA_APP_KEY', 'test-key');
  const store = new Store(':memory:');
  stores.push(store);
  const fetcher = vi.fn<typeof fetch>();
  return { store, fetcher, tools: new SourceTools(store, fetcher) };
};
const result = (count: number) =>
  new Response(
    JSON.stringify({
      results: Array.from({ length: count }, (_, i) => ({
        id: String(i),
        title: 'Product Analyst',
        company: { display_name: 'Acme' },
        location: { display_name: 'Madrid' },
        description: 'Product analytics',
        redirect_url: `https://example.com/job/${i}`,
      })),
    }),
  );
afterEach(() => {
  for (const s of stores.splice(0)) s.db.close();
  vi.unstubAllEnvs();
});

describe('Native Adzuna search filters', () => {
  it('plans native queries without fan-out, tokens or external calls', async () => {
    const { tools, fetcher } = setup();
    const plan = await tools.search({
      providers: ['adzuna'],
      country: 'es',
      keywords: ['SQL', 'Python'],
      location: 'Barcelona',
      adzuna: { what_phrase: 'product analyst', salary_min: 60000, full_time: true },
    });
    expect(plan.targets).toHaveLength(1);
    expect(plan.targets[0].params).toMatchObject({
      what_phrase: 'product analyst',
      salary_min: '60000',
      full_time: '1',
      where: 'Barcelona',
    });
    expect(JSON.stringify(plan.targets)).not.toContain('test-key');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('passes filters through API search, paginates by requested size, and keeps unknown salary', async () => {
    const { tools, fetcher } = setup();
    fetcher.mockResolvedValueOnce(result(2)).mockResolvedValueOnce(result(1));
    const found = await tools.search({
      providers: ['adzuna'],
      country: 'es',
      keywords: [],
      maxAgeDays: 14,
      maxPages: 3,
      maxRequests: 3,
      execute: true,
      adzuna: {
        what: 'analyst',
        what_and: 'SQL Python',
        what_or: 'product growth',
        what_phrase: 'product analyst',
        what_exclude: 'intern junior',
        title_only: 'analyst',
        where: 'Madrid',
        distance: 30,
        salary_min: 60000,
        salary_max: 100000,
        salary_include_unknown: true,
        full_time: true,
        permanent: true,
        contract: false,
        part_time: false,
        max_days_old: 7,
        category: 'it-jobs',
        company: 'Acme',
        sort_by: 'salary',
        sort_dir: 'down',
        location0: 'España',
        location1: 'Comunidad de Madrid',
        page: 2,
        results_per_page: 2,
      },
    });
    expect(found.requests).toBe(2);
    expect(found.jobs).toHaveLength(2); // repeated IDs deduplicated; unknown salaries aren't locally rejected
    const urls = fetcher.mock.calls.map(([u]) => new URL(String(u)));
    expect(urls.map((u) => u.pathname)).toEqual([
      '/v1/api/jobs/es/search/2',
      '/v1/api/jobs/es/search/3',
    ]);
    expect(Object.fromEntries(urls[0].searchParams)).toMatchObject({
      what: 'analyst',
      what_and: 'SQL Python',
      what_or: 'product growth',
      what_phrase: 'product analyst',
      what_exclude: 'intern junior',
      title_only: 'analyst',
      where: 'Madrid',
      distance: '30',
      salary_min: '60000',
      salary_max: '100000',
      salary_include_unknown: '1',
      full_time: '1',
      permanent: '1',
      max_days_old: '7',
      category: 'it-jobs',
      company: 'Acme',
      sort_by: 'salary',
      sort_dir: 'down',
      location0: 'España',
      location1: 'Comunidad de Madrid',
      results_per_page: '2',
    });
    expect(urls[0].searchParams.has('contract')).toBe(false);
    expect(urls[0].searchParams.has('part_time')).toBe(false);
  });
  it('separates cached salary searches and retains local salary semantics', async () => {
    const { tools, fetcher } = setup();
    fetcher.mockImplementation(async () => result(1));
    const args = {
      providers: ['adzuna'],
      country: 'es',
      execute: true,
      adzuna: { salary_min: 50000 },
    };
    expect((await tools.search(args)).jobs).toHaveLength(1);
    expect((await tools.search(args)).requests).toBe(0);
    expect((await tools.search({ ...args, adzuna: { salary_min: 70000 } })).requests).toBe(1);
    expect((await tools.search({ ...args, minSalary: 1 })).jobs).toHaveLength(0);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('preserves defaults and bounds the API budget even with a start page', async () => {
    expect(Object.fromEntries(adzunaSearchParams('SQL', 'Barcelona'))).toEqual({
      results_per_page: '50',
      sort_by: 'date',
      what: 'SQL',
      where: 'Barcelona',
    });
    const { tools, fetcher, store } = setup();
    fetcher.mockImplementation(async () => result(1));
    const found = await tools.search({
      providers: ['adzuna'],
      country: 'es',
      execute: true,
      store: true,
      maxRequests: 1,
      maxPages: 2,
      adzuna: { page: 4, results_per_page: 1 },
    });
    expect(found.requests).toBe(1);
    expect(found.results[0].error).toBeTruthy();
    expect(store.list('jobs')).toHaveLength(0);
  });
  it('rejects contradictory or misspelled filters and a radius without a centre', async () => {
    for (const adzuna of [
      { salary_min: 90000, salary_max: 60000 },
      { full_time: true, part_time: true },
      { permanent: true, contract: true },
      { results_per_page: 51 },
      { distance: -1 },
      { max_days_old: 0 },
      { salary_min: '60000' },
      { remote: true },
      { salaryMin: 60000 },
    ])
      expect(searchSchema.safeParse({ adzuna }).success).toBe(false);
    const { tools, fetcher } = setup();
    await expect(tools.search({ providers: ['adzuna'], adzuna: { distance: 20 } })).rejects.toThrow(
      'where',
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('does not forward native Adzuna filters to other providers', async () => {
    const { tools, fetcher } = setup();
    fetcher.mockResolvedValue(new Response(JSON.stringify({ jobs: [] })));
    await tools.search({ providers: ['remotive'], execute: true, adzuna: { salary_min: 50000 } });
    expect(String(fetcher.mock.calls[0][0])).not.toContain('salary_min');
  });
});
