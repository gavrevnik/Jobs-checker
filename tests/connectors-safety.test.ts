import { afterEach, expect, it, vi } from 'vitest';
import { Store } from '../server/store';
import { meteredFetcher, quota } from '../server/provider-io';
import { SourceTools } from '../server/source-tools';
import { normalize } from '../server/providers';
import { sourceSchema, type Source, type Job } from '../shared/model';

const stores: Store[] = [];
const db = () => {
  const store = new Store(':memory:');
  stores.push(store);
  return store;
};
const budget = () => ({ used: 0, limit: 1, cacheHits: 0, observedAt: '' });
afterEach(() => {
  for (const store of stores.splice(0)) store.db.close();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it('shares a per-run budget across concurrent requests and retains a failed attempt', async () => {
  const store = db(),
    allowance = budget();
  const network = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"jobs":[]}'));
  const fetcher = meteredFetcher(store, 'ashby', allowance, network);
  const outcomes = await Promise.allSettled(
    [1, 2, 3].map((i) => fetcher(`https://example.test/${i}`)),
  );
  expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
  expect(network).toHaveBeenCalledTimes(1);
  expect(allowance.used).toBe(1);
  const failed = budget(),
    timeout = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new DOMException('Fixture timeout', 'TimeoutError'));
  const failedFetcher = meteredFetcher(store, 'ashby', failed, timeout);
  await expect(failedFetcher('https://example.test/timeout')).rejects.toThrow('Fixture timeout');
  await expect(failedFetcher('https://example.test/retry')).rejects.toThrow('лимит запросов');
  expect(timeout).toHaveBeenCalledTimes(1);
  expect(failed.used).toBe(1);
  expect(store.db.prepare('SELECT count(*) AS n FROM provider_requests').get()?.n).toBe(2);
});

it('does not charge a repeated SerpAPI search ID twice across different query URLs', async () => {
  const store = db(),
    allowance = { ...budget(), limit: 2 };
  const network = vi
    .fn<typeof fetch>()
    .mockImplementation(
      async () => new Response('{"search_metadata":{"id":"same-search"},"jobs_results":[]}'),
    );
  const fetcher = meteredFetcher(store, 'serpapi', allowance, network);
  await fetcher('https://example.test/search?q=first');
  await fetcher('https://example.test/search?q=second');
  expect(network).toHaveBeenCalledTimes(2);
  expect(quota(store, 'serpapi').used).toBe(1);
  expect(
    store.db.prepare("SELECT count(*) AS n FROM provider_requests WHERE outcome='cached'").get()?.n,
  ).toBe(1);
});

it('returns and stores the completed source when the next source exceeds the request cap', async () => {
  const store = db();
  const network = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response(
        JSON.stringify({
          jobs: [
            {
              id: 'fixture-role',
              title: 'Senior Analyst',
              jobUrl: 'https://example.test/role',
              absolute_url: 'https://example.test/role',
              location: 'Berlin',
              isListed: true,
            },
          ],
        }),
      ),
    );
  const tools = new SourceTools(store, network);
  tools.addBoard({ provider: 'ashby', name: 'A Fixture', board: 'fixture' });
  tools.addBoard({ provider: 'greenhouse', name: 'Z Fixture', board: 'fixture' });
  const result = await tools.search({
    providers: ['ashby', 'greenhouse'],
    execute: true,
    store: true,
    maxRequests: 1,
  });
  expect(network).toHaveBeenCalledTimes(1);
  expect(result.requests).toBe(1);
  expect(result.jobs).toHaveLength(1);
  expect(store.list<Job>('jobs')).toHaveLength(1);
  expect(result.results.filter((r) => r.error)).toHaveLength(1);
});

it('keeps ATS ID, history, notes, AI feedback and follow-up after repeated normalized source updates', () => {
  const store = db();
  const source: Source = {
    ...sourceSchema.parse({ provider: 'ashby', name: 'Fixture Co', board: 'fixture' }),
    id: 'fixture-board',
    lastSync: '',
    lastAttempt: '',
    count: 0,
    error: '',
  };
  store.put('sources', source);
  const raw = {
    id: 'fixture-role',
    title: 'Senior Analyst',
    jobUrl: 'https://example.test/role',
    location: 'Berlin',
    isListed: true,
    descriptionPlain: 'Initial description',
  };
  const first = store.addJob(normalize('ashby', raw, source), source.id, true).job;
  const changed = store.updateJob(first.id, {
    stage: 'applied',
    notes: 'Personal note',
    favorite: true,
    followUp: '2026-10-20',
    aiScore: 9,
    aiSummary: 'Personal review',
  });
  for (let n = 0; n < 2; n++)
    store.addJob(
      normalize('ashby', { ...raw, descriptionPlain: 'Updated description' }, source),
      source.id,
      true,
    );
  expect(store.list<Job>('jobs')).toHaveLength(1);
  expect(store.get<Job>('jobs', first.id)).toMatchObject({
    id: first.id,
    stage: 'applied',
    notes: 'Personal note',
    favorite: true,
    followUp: '2026-10-20',
    aiScore: 9,
    aiSummary: 'Personal review',
    description: 'Updated description',
    history: changed.history,
  });
});
