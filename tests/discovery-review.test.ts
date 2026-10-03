import { it, expect } from 'vitest';
import { Store } from '../server/store';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
it('persists discovery memory across reopen and updates idempotently without touching ATS', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jobs-discovery-'));
  let s = new Store(join(dir, 'test.sqlite'));
  try {
    const job = s.addJob({ title: 'Analyst', company: 'Test' }).job;
    const input = {
      id: 'review-1',
      title: 'Spain',
      profileId: 'p1',
      summary: 'Use broader domains',
      queries: [
        {
          label: 'SQL',
          parameters: { providers: ['adzuna'], country: 'es', adzuna: { what: 'SQL' } },
          requests: 1,
          received: 3,
        },
      ],
      stats: { requests: 1, returned: 3, unique: 2, added: 1 },
      jobIds: [job.id],
    };
    const first = s.saveDiscoveryReview(input);
    s.saveDiscoveryReview({ ...input, summary: 'Avoid duplicate companies' });
    expect(s.discoveryHistory()).toHaveLength(1);
    expect(s.discoveryHistory({ profileId: 'p2' })).toHaveLength(0);
    expect(s.discoveryHistory()[0].createdAt).toBe(first.createdAt);
    expect(() =>
      s.saveDiscoveryReview({ ...input, stats: { ...input.stats, requests: -1 } }),
    ).toThrow();
    s.db.close();
    s = new Store(join(dir, 'test.sqlite'));
    expect(s.discoveryHistory({ profileId: 'p1' })[0].summary).toBe('Avoid duplicate companies');
    expect(s.list('jobs')).toEqual([job]);
  } finally {
    s.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
