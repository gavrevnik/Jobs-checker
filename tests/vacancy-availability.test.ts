import { describe, expect, it, vi } from 'vitest';
import { jobSchema, sourceSchema, type Job, type Source } from '../shared/model';
import { jobAvailability } from '../shared/target-vacancies';
import { companyTargetVacancies } from '../server/company-target-vacancies';
import { Store } from '../server/store';
import { CompanyResearch } from '../server/company-research';
import {
  comparisonHiringOffices,
  comparisonHiringOfficeMatches,
  comparisonHiringTags,
} from '../src/company-comparison';

const now = Date.parse('2026-10-22T12:00:00Z');
const recent = '2026-10-21T12:00:00Z';
const old = '2026-08-01T12:00:00Z';
const posting = (id: string, input: Partial<Job> = {}): Job => ({
  ...jobSchema.parse({ company: 'Artsy fixture', title: 'Senior Product Analyst', ...input }),
  id,
  companyId: 'co',
  sourceId: '',
  createdAt: old,
  updatedAt: recent,
  lastSeenAt: recent,
  history: [],
  ...input,
});
const board = (provider: Source['provider'], id = 'official'): Source => ({
  ...sourceSchema.parse({ provider, name: id, board: 'fixture' }),
  id,
  lastSync: recent,
  lastAttempt: recent,
  error: '',
  count: 1,
});
const verification = (state: 'open' | 'closed', checkedAt = recent) => ({
  state,
  source: 'careers' as const,
  checkedAt,
  url: 'https://careers.example.test/position',
});

describe('Vacancy availability evidence', () => {
  it.each(['greenhouse', 'lever', 'ashby', 'smartrecruiters'] as const)(
    'confirms a fresh %s observation on an imported card without changing its identity',
    (provider) => {
      const job = posting('imported', { source: 'import' });
      const result = jobAvailability(
        job,
        [{ sourceId: 'official', jobId: job.id, lastSeenAt: recent, missingCount: 0 }],
        now,
        [board(provider)],
      );
      expect(result).toMatchObject({
        state: 'open',
        checkedAt: recent,
        verifiedAt: recent,
        reason: 'official_observation',
      });
    },
  );

  it.each(['adzuna', 'serpapi', 'jooble', 'arbeitnow', 'remotive', 'jobicy'] as const)(
    'retains a fresh %s result as an unconfirmed candidate even with an ATS URL',
    (source) => {
      const job = posting('candidate', {
        source,
        url: 'https://job-boards.greenhouse.io/artsy/jobs/123',
      });
      const result = jobAvailability(
        job,
        [{ sourceId: `discovery:${source}`, jobId: job.id, lastSeenAt: recent, missingCount: 0 }],
        now,
      );
      expect(result).toMatchObject({ state: 'unverified', checkedAt: recent, verifiedAt: '' });
    },
  );

  it('separates stale and undated records and ignores future dates and edits', () => {
    for (const source of ['import', 'greenhouse', 'adzuna'] as const) {
      expect(jobAvailability(posting('old', { source, lastSeenAt: old }), [], now).state).toBe(
        'stale',
      );
      expect(jobAvailability(posting('undated', { source, lastSeenAt: '' }), [], now).state).toBe(
        'unverified',
      );
    }
    expect(
      jobAvailability(
        posting('future', {
          source: 'greenhouse',
          lastSeenAt: '2099-01-01',
          availabilityVerification: verification('open', '2099-01-01T00:00:00Z'),
        }),
        [],
        now,
      ).state,
    ).toBe('unverified');
  });

  it('does not refresh an old official confirmation with a fresh aggregator result', () => {
    const job = posting('mixed', { source: 'greenhouse', sourceId: 'official', lastSeenAt: old });
    const observations = [
      { sourceId: 'official', jobId: job.id, lastSeenAt: old, missingCount: 0 },
      { sourceId: 'discovery:adzuna', jobId: job.id, lastSeenAt: recent, missingCount: 0 },
    ];
    expect(jobAvailability(job, observations, now, [board('greenhouse')])).toMatchObject({
      state: 'unverified',
      verifiedAt: old,
      checkedAt: recent,
    });
  });

  it('uses explicit Careers verification for a manual/aggregator posting, retaining closure until official reopening', () => {
    const job = posting('explicit', {
      source: 'adzuna',
      availabilityVerification: verification('closed', old),
    });
    const aggregator = {
      sourceId: 'discovery:adzuna',
      jobId: job.id,
      lastSeenAt: recent,
      missingCount: 0,
    };
    expect(jobAvailability(job, [aggregator], now)).toMatchObject({
      state: 'closed',
      verifiedAt: old,
      checkedAt: recent,
    });
    expect(
      jobAvailability({ ...job, availabilityVerification: verification('open') }, [aggregator], now)
        .state,
    ).toBe('open');
    const reopened = { ...aggregator, sourceId: 'discovery:lever' };
    expect(jobAvailability(job, [aggregator, reopened], now).state).toBe('open');
  });

  it('requires official full-board disappearances for closure and ignores the personal archive stage', () => {
    const job = posting('missing', { source: 'adzuna', stage: 'archived' });
    const missing = { sourceId: 'official', jobId: job.id, lastSeenAt: old, missingCount: 2 };
    expect(jobAvailability(job, [missing], now, [board('adzuna')]).state).toBe('unverified');
    expect(jobAvailability(job, [missing], now, [board('greenhouse')])).toMatchObject({
      state: 'closed',
      reason: 'official_snapshot_missing',
    });
    expect(
      jobAvailability(job, [{ ...missing, missingCount: 1 }], now, [board('greenhouse')]).state,
    ).toBe('unverified');
    expect(jobAvailability({ ...job, source: 'greenhouse' }, [], now).state).toBe('open');
    expect(jobAvailability(job, [{ ...missing, sourceId: 'unknown' }], now).state).toBe(
      'unverified',
    );
  });

  it('keeps URL deduplication, counters, city filters and hiring tags consistent without losing candidates', () => {
    const jobs = [
      posting('open', { source: 'greenhouse', location: 'Berlin', workMode: 'hybrid' }),
      posting('candidate', { source: 'adzuna', location: 'Paris', workMode: 'remote' }),
      posting('stale', { source: 'greenhouse', lastSeenAt: old, location: 'Madrid' }),
      posting('closed', { availabilityVerification: verification('closed'), location: 'London' }),
    ];
    const targets = companyTargetVacancies('co', jobs, [], [], now);
    expect(targets).toMatchObject({
      total: 4,
      open: 1,
      unverified: 1,
      stale: 1,
      closed: 1,
      needsReview: 2,
    });
    expect(targets.jobIds).toHaveLength(4);
    expect(targets.openOffices.map((o) => o.name)).toEqual(['Berlin']);
    expect(targets.unverifiedOffices.map((o) => o.name)).toEqual(['Paris']);
    expect(targets.closedOffices.map((o) => o.name)).toEqual(['London']);
    const store = new Store(':memory:');
    try {
      const company = store.saveCompany({ name: 'Artsy fixture' });
      const profile = {
        ...new CompanyResearch(store).profile(company.id),
        targetVacancies: { ...targets, checkedSources: [] },
      };
      expect(
        comparisonHiringOffices([profile]).map((o) => [o.name, o.count, o.unverifiedCount]),
      ).toEqual([
        ['Berlin', 1, 0],
        ['Paris', 0, 1],
      ]);
      expect(comparisonHiringOfficeMatches(profile, targets.unverifiedOffices[0].id)).toBe(true);
      expect(comparisonHiringOfficeMatches(profile, targets.unverifiedOffices[0].id, false)).toBe(
        false,
      );
      expect(comparisonHiringOffices([profile], false).map((o) => o.name)).toEqual(['Berlin']);
      expect(
        comparisonHiringOfficeMatches(
          profile,
          targets.offices.find((o) => o.name === 'Madrid')!.id,
        ),
      ).toBe(false);
      expect(comparisonHiringTags(profile).modes).toEqual(['hybrid']);
    } finally {
      store.db.close();
    }
  });

  it('does not let duplicate aggregator cards reopen a closed URL or refresh stale official city evidence', () => {
    const url = 'https://careers.example.test/position';
    const closed = posting('closed', {
      url,
      location: 'Berlin',
      availabilityVerification: verification('closed'),
    });
    const duplicate = posting('duplicate', { source: 'adzuna', url, location: 'Paris' });
    const olderOpen = posting('olderOpen', {
      source: 'greenhouse',
      url,
      lastSeenAt: '2026-10-20T12:00:00Z',
      location: 'London',
    });
    for (const copies of [
      [closed, duplicate, olderOpen],
      [olderOpen, duplicate, closed],
    ]) {
      const result = companyTargetVacancies('co', copies, [], [], now);
      expect(result).toMatchObject({ total: 1, open: 0, closed: 1, unverified: 0 });
      expect(result.openOffices).toEqual([]);
      expect(result.unverifiedOffices).toEqual([]);
      expect(result.jobs[0].atsJobIds).toHaveLength(3);
    }
    const oldClosure = {
      ...closed,
      lastSeenAt: old,
      availabilityVerification: verification('closed', '2026-07-01T12:00:00Z'),
    };
    const pastReopening = { ...olderOpen, lastSeenAt: old };
    expect(companyTargetVacancies('co', [oldClosure, pastReopening], [], [], now)).toMatchObject({
      open: 0,
      closed: 0,
      stale: 1,
    });
    const stale = { ...olderOpen, lastSeenAt: old };
    const result = companyTargetVacancies('co', [stale, duplicate], [], [], now);
    expect(result).toMatchObject({ open: 0, unverified: 1 });
    expect(result.unverifiedOffices.map((o) => o.name)).toEqual(['Paris']);
  });

  it('keeps the company card closed when an aggregator rediscovers an officially closed ATS position', () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const store = new Store(':memory:');
    try {
      const company = store.saveCompany({ name: 'Artsy fixture' });
      store.writeJob(
        posting('closed', {
          companyId: company.id,
          source: 'greenhouse',
          sourceId: 'official',
          url: 'https://careers.example.test/role',
          location: 'Berlin',
          lastSeenAt: '2026-10-20T12:00:00Z',
          availabilityVerification: verification('closed'),
          description: 'Product experimentation',
        }),
      );
      store.db
        .prepare('INSERT INTO job_observations VALUES (?,?,?,?,?,?)')
        .run('official', 'role', 'closed', old, '2026-10-20T12:00:00Z', 0);
      store.db
        .prepare('INSERT INTO job_observations VALUES (?,?,?,?,?,?)')
        .run('discovery:adzuna', 'role', 'closed', old, '2026-10-22T10:00:00Z', 0);
      const research = new CompanyResearch(store);
      const profile = research.profile(company.id);
      expect(profile.targetVacancies).toMatchObject({ total: 1, closed: 1, open: 0 });
      expect(profile.currentJobs).toEqual([]);
      expect(profile.jobs.every((j) => !j.current && j.availability.state === 'closed')).toBe(true);
      expect(comparisonHiringOffices([profile])).toEqual([]);
      expect(research.plan(company.id).jobMaterials[0]).toMatchObject({
        researchUse: 'historical',
        availability: { state: 'closed' },
      });
    } finally {
      store.db.close();
      vi.useRealTimers();
    }
  });

  it('persists explicit official verification through PATCH and JSON export/import with CRM intact', () => {
    const store = new Store(':memory:');
    const restored = new Store(':memory:');
    try {
      const { job } = store.addJob({
        company: 'Fixture',
        title: 'Senior Data Analyst',
        source: 'adzuna',
        notes: 'Keep note',
        stage: 'saved',
      });
      store.updateJob(job.id, { availabilityVerification: verification('closed') });
      const saved = store.list<Job>('jobs')[0];
      expect(saved).toMatchObject({
        notes: 'Keep note',
        stage: 'saved',
        availabilityVerification: verification('closed'),
      });
      restored.importData(JSON.parse(JSON.stringify(store.state())));
      expect(restored.list<Job>('jobs')[0].availabilityVerification).toEqual(
        verification('closed'),
      );
      expect(jobAvailability(saved, [], now).state).toBe('closed');
    } finally {
      store.db.close();
      restored.db.close();
    }
  });
});
