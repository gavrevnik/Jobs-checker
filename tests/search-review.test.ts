import { afterEach, expect, it, vi } from 'vitest';
import { Store } from '../server/store';
import { SourceTools } from '../server/source-tools';
import { CompanyResearch } from '../server/company-research';
import type { Job } from '../shared/model';

const store = () => new Store(':memory:');
const rows = (title: string, slug: string, company: string, description: string) => ({
  slug,
  title,
  company_name: company,
  location: 'Paris, France',
  url: `https://www.arbeitnow.fr/jobs/${slug}`,
  description,
});
const experiment = 'Design experiments and recommend product changes.';
const reporting = 'Own product metrics but spend most of the week on routine reporting.';
const ad = [
  rows('Senior Product Analyst', 'target', 'Target Co', experiment),
  rows('Product Analyst', 'practice', 'Practice Co', reporting),
  rows('Senior Data Analyst', 'reject', 'Rejected Co', 'Support finance reporting.'),
  rows('Product Analyst', 'pending', 'Pending Co', 'See the full listing.'),
  rows('Analyste produit', 'foreign', 'Foreign Co', 'Piloter les analyses du produit.'),
];
const response = (value: unknown, options?: ResponseInit) =>
  new Response(JSON.stringify(value), options);

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

it('keeps unreviewed and rejected companies out of comparison and saves target/practice with evidence', async () => {
  const db = store();
  try {
    const network = vi.fn<typeof fetch>().mockImplementation(async () => response({ data: ad }));
    const tools = new SourceTools(db, network);
    const result = await tools.search({
      providers: ['arbeitnow'],
      country: 'FR',
      execute: true,
      store: true,
    });
    expect(result.jobs.map((job) => job.externalId)).toEqual([
      'target',
      'practice',
      'reject',
      'pending',
    ]);
    expect(db.list('jobs')).toHaveLength(0);
    expect(new CompanyResearch(db).list().companies).toHaveLength(0);
    const batchId = result.reviewBatchId!;
    const [target, practice, reject, pending] = result.jobs.map((job) => job.candidateId!);
    const reviewed = {
      category: 'target',
      roleFamily: 'product_analytics',
      language: 'en',
      reason: 'Influence product decisions',
      candidateId: target,
      quote: experiment,
    };
    expect(() =>
      tools.reviews.review({
        batchId,
        decisions: [reviewed, { ...reviewed, candidateId: practice, quote: 'Invented text' }],
      }),
    ).toThrow('Цитата');
    expect(db.list('jobs')).toHaveLength(0);
    expect(() =>
      tools.reviews.review({ batchId, decisions: [{ ...reviewed, language: 'other' }] }),
    ).toThrow('EN/RU');
    const saved = tools.reviews.review({
      batchId,
      decisions: [
        reviewed,
        {
          ...reviewed,
          candidateId: practice,
          category: 'practice',
          reason: 'Product analytics with routine reporting',
          quote: reporting,
          uncertainties: ['Визовая поддержка'],
        },
        { candidateId: reject, category: 'reject', language: 'en', reason: 'Finance reporting' },
      ],
    });
    expect(saved).toMatchObject({
      target: 1,
      practice: 1,
      reject: 1,
      pending: 1,
      added: 2,
      newCompanies: 2,
    });
    expect(tools.reviews.review({ batchId }).candidates?.map((item) => item.id)).toEqual([pending]);
    const companies = new CompanyResearch(db).list().companies;
    expect(companies.map((item) => item.company.name).sort()).toEqual(['Practice Co', 'Target Co']);
    expect(
      companies.find((item) => item.company.name === 'Practice Co')?.targetVacancies,
    ).toMatchObject({ practice: 1, unverified: 1, open: 0 });
    expect(network).toHaveBeenCalledTimes(1);
  } finally {
    db.db.close();
  }
});

it('reports supported markets under a shared budget and only skips review when asked', async () => {
  vi.stubEnv('ADZUNA_APP_ID', 'fixture-id');
  vi.stubEnv('ADZUNA_APP_KEY', 'fixture-key');
  const db = store();
  try {
    const network = vi.fn<typeof fetch>().mockResolvedValue(response({ data: [ad[0]] }));
    const tools = new SourceTools(db, network);
    const planned = await tools.search({
      providers: ['jobtech', 'arbeitnow', 'adzuna'],
      countries: ['FR', 'SE', 'PT'],
      keywords: ['product analyst'],
      maxRequests: 2,
    });
    expect(planned.targets.map((target) => [target.provider, target.country])).toEqual([
      ['jobtech', 'se'],
      ['arbeitnow', 'fr'],
    ]);
    expect(planned).toMatchObject({
      omittedTargets: 1,
      plannedRequestUpperBound: 2,
      reviewRequired: true,
    });
    expect(planned.skipped).toContainEqual(
      expect.objectContaining({ provider: 'adzuna', country: 'pt' }),
    );
    expect(network).not.toHaveBeenCalled();
    const saved = await tools.search({
      providers: ['arbeitnow'],
      country: 'fr',
      keywords: ['analyst'],
      execute: true,
      store: true,
      reviewRequired: false,
    });
    expect(saved.reviewBatchId).toBeNull();
    expect(db.list<Job>('jobs')).toHaveLength(1);
  } finally {
    db.db.close();
  }
});

it('stages new board findings while updating presence for an existing ATS card', async () => {
  const db = store();
  try {
    const network = vi.fn<typeof fetch>().mockResolvedValue(
      response({
        jobs: [
          {
            id: 'known',
            title: 'Senior Product Analyst',
            jobUrl: 'https://jobs.ashbyhq.com/fixture/known',
            isListed: true,
          },
          {
            id: 'new',
            title: 'Product Analyst',
            jobUrl: 'https://jobs.ashbyhq.com/fixture/new',
            isListed: true,
          },
        ],
      }),
    );
    const tools = new SourceTools(db, network);
    const board = tools.addBoard({ provider: 'ashby', board: 'fixture', name: 'Fixture Co' });
    const existing = db.addJob(
      {
        source: 'ashby',
        externalId: 'known',
        company: 'Fixture Co',
        title: 'Senior Product Analyst',
        url: 'https://jobs.ashbyhq.com/fixture/known',
        notes: 'Keep',
      },
      board.id,
    ).job;
    const result = await tools.monitor({ execute: true });
    expect(result.results?.[0]).toMatchObject({
      added: 0,
      pendingReview: 1,
      reviewBatchIds: [expect.any(String)],
    });
    expect(db.list<Job>('jobs')).toHaveLength(1);
    expect(db.get<Job>('jobs', existing.id)?.notes).toBe('Keep');
    expect(db.observations(existing.id)).toHaveLength(1);
  } finally {
    db.db.close();
  }
});

it('honors Retry-After across new search runs and resumes after the cooldown', async () => {
  vi.useFakeTimers();
  const db = store();
  try {
    const network = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({}, { status: 429, headers: { 'Retry-After': '120' } }))
      .mockResolvedValue(response({ jobs: [] }));
    const args = { providers: ['himalayas'], country: 'fr', keywords: ['analyst'], execute: true };
    expect((await new SourceTools(db, network).search(args)).results[0].error).toContain('429');
    expect((await new SourceTools(db, network).search(args)).requests).toBe(0);
    vi.advanceTimersByTime(121000);
    expect((await new SourceTools(db, network).search(args)).requests).toBe(1);
  } finally {
    db.db.close();
  }
});

it('records a Himalayas 410 without treating the provider as official Careers evidence', async () => {
  const db = store();
  try {
    const guid = 'https://himalayas.app/companies/fixture/jobs/product-analyst';
    const existing = db.addJob(
      {
        title: 'Senior Product Analyst',
        company: 'Fixture Co',
        seniority: 'senior',
        source: 'himalayas',
        externalId: guid,
        url: guid,
      },
      'discovery:himalayas:fr',
    ).job;
    const network = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 410 }))
      .mockResolvedValueOnce(response({ job: { guid } }));
    const tools = new SourceTools(db, network);
    expect(await tools.enrich({ jobId: existing.id, execute: true })).toMatchObject({
      state: 'closed',
    });
    const research = new CompanyResearch(db);
    expect(research.profile(existing.companyId).targetVacancies).toMatchObject({
      closed: 1,
      open: 0,
    });
    expect(await tools.enrich({ jobId: existing.id, execute: true })).toMatchObject({
      state: 'open',
    });
    expect(research.profile(existing.companyId).targetVacancies).toMatchObject({
      closed: 0,
      open: 0,
      unverified: 1,
    });
  } finally {
    db.db.close();
  }
});

it('keeps the working funnel and the company work list on the same saved cards', () => {
  const db = store();
  try {
    const add = (slug: string, stage: Job['stage'] = 'new', open = true) =>
      db.addJob({
        title: 'Senior Product Analyst',
        company: 'Fixture Co',
        url: `https://example.test/${slug}`,
        description: experiment,
        stage,
        notes: 'Keep personal notes',
        ...(open
          ? {
              availabilityVerification: {
                state: 'open',
                source: 'careers',
                checkedAt: new Date().toISOString(),
                url: `https://example.test/${slug}`,
              },
            }
          : {}),
      }).job;
    const target = add('target'),
      archived = add('archived', 'archived');
    const rejected = add('rejected'),
      pending = add('pending', 'new', false);
    const reviews = ([target, archived, rejected, pending] as const).map((job, i) => ({
      id: job.id,
      expectedUpdatedAt: job.updatedAt,
      category: ['target', 'practice', 'reject', 'target'][i],
      reason: 'Reviewed example',
    }));
    expect(() =>
      db.reviewSavedJobs({
        reviews: [
          reviews[0],
          {
            ...reviews[1],
            expectedUpdatedAt: '2000-01-01T00:00:00.000Z',
          },
        ],
      }),
    ).toThrow('изменилась');
    expect(db.state().workingJobIds).toEqual([]);
    expect(db.reviewSavedJobs({ reviews })).toEqual({ reviewed: 4 });
    expect(db.state().workingJobIds).toEqual([target.id]);
    const research = new CompanyResearch(db);
    const company = research.profile(target.companyId);
    expect(company.jobs.some((job) => job.id === rejected.id)).toBe(false);
    expect(company.currentJobs.some((job) => job.id === archived.id)).toBe(false);
    const view = company.targetVacancies;
    expect(view.workingJobIds).toEqual([target.id]);
    expect(view.historyJobs.map((job) => job.id)).toEqual(
      expect.arrayContaining([archived.id, pending.id]),
    );
    expect(view.historyJobs.some((job) => job.id === rejected.id)).toBe(false);
    expect(db.get<Job>('jobs', archived.id)).toMatchObject({
      stage: 'archived',
      notes: 'Keep personal notes',
    });
    const { jobMaterials } = research.plan(target.companyId);
    expect(jobMaterials.find((m) => m.job.id === archived.id)?.researchUse).toBe('historical');
    expect(jobMaterials.some((m) => m.job.id === rejected.id)).toBe(false);
  } finally {
    db.db.close();
  }
});
