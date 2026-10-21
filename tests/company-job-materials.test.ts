import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Store } from '../server/store';
import { CompanyResearch } from '../server/company-research';
import { companyJobMaterials } from '../shared/company-job-materials';
import { companyCulture } from '../src/company-culture';
import { companyInfrastructure } from '../src/company-infrastructure';
import { companySummaryText } from '../src/company-summary';
import { type Job, jobSchema } from '../shared/model';

const stores: Store[] = [];
const dirs: string[] = [];
afterEach(() => {
  stores.splice(0).forEach((s) => s.db.close());
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
});
const recent = () => new Date().toISOString();
function fixture(path = ':memory:') {
  const store = new Store(path);
  stores.push(store);
  const company = store.saveCompany({ name: 'Historical fixture' });
  const add = (id: string, fields: Partial<Job> = {}) => {
    const job: Job = {
      ...jobSchema.parse({
        company: company.name,
        title: 'Senior Data Analyst',
        description: 'The team operates dbt models for product experiments.',
        url: `https://example.test/jobs/${id}`,
        location: 'Berlin',
        ...fields,
      }),
      id,
      companyId: company.id,
      sourceId: 'board',
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: recent(),
      lastSeenAt: recent(),
      history: [],
      ...fields,
    };
    store.writeJob(job);
    return job;
  };
  return { store, company, add, research: new CompanyResearch(store) };
}

it('makes closed, stale, undated and non-target descriptions available in the country-scoped plan without changing ATS', () => {
  const f = fixture();
  f.add('open');
  f.add('archived', { stage: 'archived', notes: 'Private CRM note', aiReason: 'Personal AI' });
  f.add('stale', { lastSeenAt: '2025-05-12T00:00:00Z', publishedAt: '2025-05-01' });
  f.add('undated', { lastSeenAt: '' });
  f.add('missing');
  f.store.db
    .prepare('INSERT INTO job_observations VALUES (?,?,?,?,?,?)')
    .run('board', 'missing', 'missing', '2025-01-01', recent(), 2);
  f.add('non-target', { title: 'Data Engineer', seniority: 'unknown' });
  f.add('empty', { description: '   ' });
  const other = f.store.saveCompany({ name: 'Other company' });
  f.add('other', { company: other.name, companyId: other.id });
  const before = f.store.list<Job>('jobs');
  const materials = f.research.plan(f.company.id, 'ES').jobMaterials;
  expect(materials.map((m) => m.job.id).sort()).toEqual([
    'archived',
    'missing',
    'non-target',
    'open',
    'stale',
    'undated',
  ]);
  const archived = materials.find((m) => m.job.id === 'archived')!;
  expect(archived).toMatchObject({
    researchUse: 'historical',
    availability: { state: 'closed' },
    scope: { role: 'Senior Data Analyst', job_url: archived.job.url, context: 'historical_job' },
  });
  expect(JSON.stringify(materials)).not.toContain('Private CRM note');
  expect(JSON.stringify(materials)).not.toContain('Personal AI');
  expect(materials.find((m) => m.job.id === 'missing')?.availability.state).toBe('closed');
  expect(materials.find((m) => m.job.id === 'stale')).toMatchObject({
    observedAt: '2025-05-12T00:00:00Z',
    publishedAt: '2025-05-01',
    researchUse: 'historical',
  });
  expect(materials.find((m) => m.job.id === 'undated')).toMatchObject({
    observedAt: '',
    availability: { state: 'unverified' },
    researchUse: 'historical',
  });
  expect(materials.find((m) => m.job.id === 'open')?.researchUse).toBe('current_role');
  expect(f.store.list<Job>('jobs')).toEqual(before);
});

it('uses fresh presence from another source without merging different saved descriptions at one URL', () => {
  const f = fixture();
  const a = f.add('a', { lastSeenAt: '2024-01-01', description: 'Earlier source text' });
  const b = { ...a, id: 'b', description: 'Different source text' };
  const materials = companyJobMaterials(
    f.company.id,
    [a, b],
    [
      { sourceId: 'gone', jobId: a.id, lastSeenAt: recent(), missingCount: 2 },
      { sourceId: 'live', jobId: a.id, lastSeenAt: recent(), missingCount: 0 },
    ],
  );
  expect(materials).toHaveLength(2);
  expect(materials[0].researchUse).toBe('current_role');
  expect(materials.map((m) => m.job.description)).toEqual([
    'Earlier source text',
    'Different source text',
  ]);
});

it('retains reviewed historical insights in full information but excludes them from current score and tags even with recent dates', () => {
  const f = fixture();
  f.add('closed', { stage: 'archived' });
  const material = f.research.plan(f.company.id).jobMaterials[0];
  for (const [criterion_id, value] of [
    ['AN01', true],
    ['AN09_CULTURE', { summary: 'Historically ran product experiments', tags: ['A/B'] }],
    ['T08_INFRA', { summary: 'Historical dbt platform', tags: ['dbt'] }],
  ] as const) {
    const profile = f.research.manual(f.company.id, {
      criterion_id,
      value,
      scope: material.scope,
      confidence: 'high',
      reasoning: 'Historical role context, not current company conditions.',
      evidence: [
        {
          url: material.job.url,
          title: material.job.title,
          source_type: 'job',
          observed_at: material.observedAt,
          excerpt: material.job.description,
        },
      ],
    });
    f.research.review(profile.observations[0].id, { verified: true });
  }
  const profile = f.research.profile(f.company.id);
  expect(profile.observations.every((o) => !!o.verifiedAt)).toBe(true);
  expect(profile.criteria.find((c) => c.criterion.id === 'AN01')?.verdict).toBe('unknown');
  expect(profile.confirmed).toEqual([]);
  expect(companyCulture(profile.observations).tags).toEqual([]);
  expect(companyInfrastructure(profile.observations).tags).toEqual([]);
  expect(companySummaryText(profile)).toContain('Historical dbt platform');
  expect(companySummaryText(profile)).toContain('Историческая вакансия');
  expect(companySummaryText(profile)).toContain('текущие условия не подтверждены');
  expect(companySummaryText(profile)).toContain('наблюдение ' + material.observedAt.slice(0, 10));
  expect(profile.observations.every((o) => o.evidence[0].url === material.job.url)).toBe(true);
  // A separately sourced current fact can still be reviewed and used normally.
  const current = f.research.manual(f.company.id, {
    criterion_id: 'AN01',
    value: true,
    confidence: 'high',
    scope: {},
    reasoning: 'Current case study',
    evidence: [
      {
        url: 'https://example.test/current',
        title: 'Current',
        source_type: 'official',
        observed_at: recent(),
        excerpt: 'Analysts shape product decisions via experiments.',
      },
    ],
  });
  f.research.review(current.observations[0].id, { verified: true });
  expect(
    f.research.profile(f.company.id).criteria.find((c) => c.criterion.id === 'AN01')?.verdict,
  ).toBe('pass');
});

it('exports historical materials with local-only CLI and leaves the SQLite file unchanged', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'jobs-local-materials-'));
  dirs.push(dir);
  const db = resolve(dir, 'fixture.sqlite');
  const f = fixture(db);
  f.add('closed', { stage: 'archived', lastSeenAt: '2025-05-12T00:00:00Z' });
  f.store.db.close();
  stores.splice(stores.indexOf(f.store), 1);
  const before = readFileSync(db);
  const output = resolve(dir, 'materials.json');
  const run = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'scripts/collect-company-materials.ts', '--local-only', '--output', output],
    {
      cwd: resolve(import.meta.dirname, '..'),
      env: { ...process.env, SCOUT_DB: db },
      encoding: 'utf8',
      timeout: 15000,
    },
  );
  expect(run.status, run.stderr).toBe(0);
  const result = JSON.parse(readFileSync(output, 'utf8'));
  expect(result.requests).toBe(0);
  expect(result.runs).toEqual([]);
  expect(result.companies[0].materials[0]).toMatchObject({
    origin: 'saved_ats',
    researchUse: 'historical',
    observedAt: '2025-05-12T00:00:00Z',
    job: { id: 'closed', description: 'The team operates dbt models for product experiments.' },
  });
  expect(readFileSync(db)).toEqual(before);
});
