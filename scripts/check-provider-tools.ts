import { Store } from '../server/store.js';
import { fetchJobs } from '../server/providers.js';
import { meteredFetcher } from '../server/provider-io.js';
import { sourceSchema, type Source } from '../shared/model.js';
// Deliberately isolated: no user .env, no live database, no ATS writes.
const store = new Store(':memory:');
const boards = {
  greenhouse: 'greenhouse',
  lever: 'lever',
  ashby: 'Ashby',
  smartrecruiters: 'smartrecruiters',
  arbeitnow: '',
  remotive: '',
} as const;
try {
  for (const [provider, board] of Object.entries(boards)) {
    const source: Source = {
      ...sourceSchema.parse({ provider, board, name: board || provider }),
      id: 'check',
      lastSync: '',
      lastAttempt: '',
      error: '',
      count: 0,
    };
    const budget = { used: 0, limit: 5, cacheHits: 0, observedAt: '' };
    try {
      const jobs = await fetchJobs(source, meteredFetcher(store, source.provider, budget), {
        maxPages: 1,
      });
      console.log(JSON.stringify({ provider, ok: true, jobs: jobs.length, requests: budget.used }));
    } catch (error) {
      console.log(
        JSON.stringify({
          provider,
          ok: false,
          error: error instanceof Error ? error.message : 'error',
        }),
      );
      process.exitCode = 1;
    }
  }
} finally {
  store.db.close();
}
