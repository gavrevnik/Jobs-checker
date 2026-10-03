import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../server/store';
import { billingPeriod, quota, requestScope } from '../server/provider-quota';
import { meteredFetcher } from '../server/provider-io';
import { SourceTools } from '../server/source-tools';

const stores: Store[] = [];
const folders: string[] = [];
const db = () => {
  const store = new Store(':memory:');
  stores.push(store);
  return store;
};
const clock = (value: string) => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(value));
};
function record(store: Store, provider: string, at: string, outcome = 'unknown', scope = '') {
  store.db
    .prepare('INSERT INTO provider_requests(provider,at,outcome,scope) VALUES (?,?,?,?)')
    .run(provider, at, outcome, scope);
}
const budget = () => ({ used: 0, limit: 100, cacheHits: 0, observedAt: '' });
const json = (value: unknown) => new Response(JSON.stringify(value));
afterEach(() => {
  for (const store of stores.splice(0)) store.db.close();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('Persistent provider quotas', () => {
  it('resets the UTC month without erasing history or resetting rolling daily/weekly windows', () => {
    clock('2026-10-31T23:59:59.999Z');
    const store = db();
    record(store, 'adzuna', '2026-10-31T23:59:00.000Z');
    expect(quota(store, 'adzuna').windows[0]).toMatchObject({
      used: 1,
      nextResetAt: '2026-11-01T00:00:00.000Z',
    });
    vi.setSystemTime(new Date('2026-11-01T00:00:00.000Z'));
    const next = quota(store, 'adzuna');
    expect(next.used).toBe(0);
    expect(next.windows.map((w) => w.used)).toEqual([0, 1, 1, 0]);
    expect(store.db.prepare('SELECT count(*) AS n FROM provider_requests').get()?.n).toBe(1);
    record(store, 'adzuna', '2026-11-01T00:00:00.000Z');
    expect(quota(store, 'adzuna').used).toBe(1);
    record(store, 'adzuna', '2026-12-01T00:00:00.000Z');
    expect(quota(store, 'adzuna').used).toBe(1);
  });
  it('releases rolling capacity exactly at expiry and enforces the same windows shown in UI', async () => {
    clock('2026-10-03T12:00:30.000Z');
    const store = db();
    for (let i = 0; i < 25; i++) record(store, 'adzuna', '2026-10-03T12:00:00.000Z');
    const mock = vi.fn<typeof fetch>().mockImplementation(async () => json({ results: [] }));
    const run = meteredFetcher(store, 'adzuna', budget(), mock);
    expect(quota(store, 'adzuna').windows[3]).toMatchObject({
      used: 25,
      remaining: 0,
      nextResetAt: '2026-10-03T12:01:00.000Z',
    });
    await expect(run('https://example.com/test')).rejects.toThrow('лимит');
    expect(mock).not.toHaveBeenCalled();
    vi.setSystemTime(new Date('2026-10-03T12:01:00.000Z'));
    await run('https://example.com/test');
    expect(mock).toHaveBeenCalledTimes(1);
    expect(quota(store, 'adzuna').windows[3].used).toBe(1);
  });
  it('uses the actual SerpAPI anniversary, clamps short months without drifting, and handles leap years', () => {
    const anchor = new Date('2026-01-31T12:30:00Z');
    const period = billingPeriod(anchor, new Date('2026-03-01T00:00:00Z'));
    expect(period.start.toISOString()).toBe('2026-02-28T12:30:00.000Z');
    expect(period.end.toISOString()).toBe('2026-03-31T12:30:00.000Z');
    expect(
      billingPeriod(
        new Date('2024-01-31T00:00:00Z'),
        new Date('2024-02-29T00:00:00Z'),
      ).start.toISOString(),
    ).toBe('2024-02-29T00:00:00.000Z');
    clock('2026-10-15T09:00:00Z');
    vi.stubEnv('SERPAPI_BILLING_ANCHOR', '2026-09-15T11:00:00+02:00');
    const store = db();
    record(store, 'serpapi', '2026-10-15T08:59:59.999Z', 'success');
    record(store, 'serpapi', '2026-10-15T09:00:00.000Z', 'success');
    expect(quota(store, 'serpapi').windows[0]).toMatchObject({
      used: 1,
      start: '2026-10-15T09:00:00.000Z',
      end: '2026-11-15T09:00:00.000Z',
    });
  });
  it('does not invent a calendar reset for SerpAPI when the billing date is unknown', () => {
    clock('2026-11-01T00:00:00Z');
    vi.stubEnv('SERPAPI_BILLING_ANCHOR', '');
    const store = db();
    record(store, 'serpapi', '2026-10-31T23:59:59.000Z');
    record(store, 'serpapi', '2026-10-01T00:00:00.000Z');
    expect(quota(store, 'serpapi')).toMatchObject({ used: 1, limit: 250, label: '31 день' });
    expect(quota(store, 'serpapi').windows[0].nextResetAt).toBe('2026-12-01T23:59:59.000Z');
    vi.stubEnv('SERPAPI_BILLING_ANCHOR', 'invalid');
    expect(quota(store, 'serpapi').label).toBe('31 день');
    vi.stubEnv('SERPAPI_MONTHLY_LIMIT', '1000');
    vi.stubEnv('SERPAPI_HOURLY_LIMIT', '200');
    expect(quota(store, 'serpapi').windows.map((w) => w.limit)).toEqual([1000, 200]);
  });
  it('excludes known SerpAPI errors, local cache and repeated search IDs but reserves uncertain attempts', async () => {
    clock('2026-10-03T12:00:00Z');
    const store = db();
    const mock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockImplementationOnce(async () => json({ error: 'Invalid query' }))
      .mockImplementationOnce(async () =>
        json({ search_metadata: { id: 'search-1' }, jobs_results: [] }),
      )
      .mockImplementationOnce(async () =>
        json({ search_metadata: { id: 'search-1' }, jobs_results: [] }),
      )
      .mockRejectedValueOnce(new Error('Network connection lost'));
    const run = meteredFetcher(store, 'serpapi', budget(), mock);
    await run('https://example.com/http-error');
    await expect(run('https://example.com/api-error')).rejects.toThrow('API');
    await run('https://example.com/success');
    await run('https://example.com/success'); // local cache, no request row
    await run('https://example.com/upstream-cache');
    expect(quota(store, 'serpapi').used).toBe(1);
    await expect(run('https://example.com/network')).rejects.toThrow('Network');
    const status = new SourceTools(store).status().providers.find((p) => p.id === 'serpapi')!;
    expect(status.quota.used).toBe(2);
    expect(status.quota.windows[1].used).toBe(5); // hourly rate counts all attempts
    expect(mock).toHaveBeenCalledTimes(5);
  });
  it('keeps Jooble lifetime usage across years and separates regional keys without exposing secrets', async () => {
    clock('2026-10-03T12:00:00Z');
    vi.stubEnv('JOOBLE_API_KEY', 'fixture-key-a');
    vi.stubEnv('JOOBLE_HOST', 'es.jooble.org');
    const store = db();
    const scopeA = requestScope('jooble');
    for (let i = 0; i < 499; i++)
      record(store, 'jooble', '2025-01-01T00:00:00.000Z', 'unknown', scopeA);
    record(store, 'jooble', '2024-01-01T00:00:00.000Z'); // legacy unscoped request
    const mock = vi.fn<typeof fetch>().mockImplementation(async () => json({ jobs: [] }));
    await expect(
      meteredFetcher(store, 'jooble', budget(), mock)('https://example.com/jobs'),
    ).rejects.toThrow('лимит');
    expect(quota(store, 'jooble').windows[0]).toMatchObject({
      used: 500,
      remaining: 0,
      nextResetAt: null,
    });
    vi.setSystemTime(new Date('2027-01-01T00:00:00Z'));
    expect(quota(store, 'jooble').used).toBe(500);
    vi.stubEnv('JOOBLE_API_KEY', 'fixture-key-b');
    expect(quota(store, 'jooble').used).toBe(1);
    await meteredFetcher(store, 'jooble', budget(), mock)('https://example.com/jobs');
    expect(quota(store, 'jooble').used).toBe(2);
    expect(JSON.stringify(store.db.prepare('SELECT * FROM provider_requests').all())).not.toContain(
      'fixture-key',
    );
  });
  it('migrates old request history once and preserves it across process restarts', () => {
    clock('2026-10-03T12:00:00Z');
    const dir = mkdtempSync(join(tmpdir(), 'jobs-quota-'));
    folders.push(dir);
    const file = join(dir, 'test.sqlite');
    const old = new DatabaseSync(file);
    old.exec(
      "CREATE TABLE provider_requests(provider TEXT NOT NULL, at TEXT NOT NULL); INSERT INTO provider_requests VALUES ('serpapi','2026-10-03T10:00:00.000Z')",
    );
    old.close();
    const first = new Store(file);
    expect(quota(first, 'serpapi').used).toBe(1);
    first.db.close();
    const second = new Store(file);
    stores.push(second);
    expect(quota(second, 'serpapi').used).toBe(1);
    expect(second.db.prepare('PRAGMA user_version').get()?.user_version).toBe(3);
  });
});
