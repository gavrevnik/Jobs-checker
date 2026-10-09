import { jobSchema, type JobInput, type Source, type Profile } from '../shared/model.js';
import type { Store } from './store.js';
import { acceptsJob, searchSchema, boardProviders } from '../shared/source-tools.js';
import { meteredFetcher, providerEnabled, safeProviderError } from './provider-io.js';

import {
  plain,
  normalize as normalizeRow,
  fetchJobs as fetchRows,
} from '@personal-radar/connectors/ats';
export { plain };
function seniority(title: string): JobInput['seniority'] {
  if (/\b(lead|staff|principal|head|director)\b/i.test(title)) return 'lead';
  if (/\b(senior|sr\.?)\b/i.test(title)) return 'senior';
  if (/\b(junior|jr\.?)\b/i.test(title)) return 'junior';
  if (/\b(intern|internship)\b/i.test(title)) return 'intern';
  if (/\b(mid|middle|mid-level)\b/i.test(title)) return 'middle';
  return 'unknown';
}

function validateJob(row: { title: string }) {
  return jobSchema.parse({ ...row, seniority: seniority(row.title) });
}
export type Fetcher = typeof fetch;
export function normalize(provider: Source['provider'], raw: unknown, source: Source): JobInput {
  return validateJob(normalizeRow(provider, raw, source));
}
export async function fetchJobs(
  source: Source,
  fetcher: Fetcher = fetch,
  options: Parameters<typeof fetchRows>[2] = {},
): Promise<JobInput[]> {
  return (await fetchRows(source, fetcher, options)).map((row) => validateJob(row));
}

export class SyncService {
  busy = false;
  constructor(
    private store: Store,
    private fetcher: Fetcher = fetch,
  ) {}
  async run(sourceId?: string) {
    if (this.busy) throw new Error('Обновление уже выполняется');
    this.busy = true;
    const results: {
      id: string;
      name: string;
      added: number;
      total: number;
      cached?: boolean;
      error?: string;
    }[] = [];
    try {
      const sources = this.store
        .list<Source>('sources')
        .filter(
          (s) =>
            s.enabled &&
            providerEnabled(this.store, s.provider) &&
            (!sourceId || sourceId === s.id),
        );
      for (const source of sources) {
        const cooldown = source.provider === 'remotive' ? 6 * 3600000 : 15 * 60000;
        const last = source.lastSync && new Date(source.lastSync).getTime();
        const attempted = source.lastAttempt && new Date(source.lastAttempt).getTime();
        if (
          (last && Date.now() - last < cooldown) ||
          (attempted && Date.now() - attempted < 60000)
        ) {
          results.push({
            id: source.id,
            name: source.name,
            added: 0,
            total: source.count,
            cached: true,
            ...(source.error ? { error: source.error } : {}),
          });
          continue;
        }
        source.lastAttempt = new Date().toISOString();
        this.store.put('sources', source);
        const budget = { used: 0, limit: 30, cacheHits: 0, observedAt: '' };
        try {
          const jobs = await fetchJobs(
            source,
            meteredFetcher(this.store, source.provider, budget, this.fetcher),
          );
          const profile = source.profileId
            ? this.store.get<Profile>('profiles', source.profileId)
            : undefined;
          if (source.profileId && !profile) throw new Error('Профиль не найден');
          const selected = profile
            ? jobs.filter((job) => acceptsJob(job, searchSchema.parse({}), profile))
            : jobs;
          let added = 0;
          this.store.transaction(() => {
            added = this.store.ingestJobs(
              selected,
              source.id,
              boardProviders.includes(source.provider) && !budget.cacheHits ? jobs : undefined,
              budget.observedAt,
            ).added;
            this.store.recordRun({
              provider: source.provider,
              sourceId: source.id,
              kind: 'sync',
              query: source.query,
              received: jobs.length,
              matched: selected.length,
              added,
              requests: budget.used,
              cached: budget.cacheHits > 0,
              error: '',
            });
            this.store.put('sources', {
              ...source,
              lastSync: new Date().toISOString(),
              error: '',
              count: jobs.length,
            });
          });
          results.push({ id: source.id, name: source.name, added, total: jobs.length });
        } catch (error) {
          const safeMessage = safeProviderError(error);
          this.store.recordRun({
            provider: source.provider,
            sourceId: source.id,
            kind: 'sync',
            query: source.query,
            received: 0,
            matched: 0,
            added: 0,
            requests: budget.used,
            cached: budget.cacheHits > 0,
            error: safeMessage,
          });
          this.store.put('sources', { ...source, error: safeMessage });
          results.push({
            id: source.id,
            name: source.name,
            added: 0,
            total: 0,
            error: safeMessage,
          });
        }
      }
      return results;
    } finally {
      this.busy = false;
    }
  }
}
