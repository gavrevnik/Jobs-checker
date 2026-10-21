import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { Store } from '../server/store';
import { CompanyResearch } from '../server/company-research';
import { ResearchPaidGate, type PaidOperation } from '../server/research-paid';
import {
  observationSchema,
  researchImportSchema,
  summarize,
  effectiveVerdict,
  registry,
  type StoredObservation,
  type Observation,
} from '../shared/company-research';
import { SourceTools } from '../server/source-tools';
const stores: Store[] = [];
const setup = () => {
  const store = new Store(':memory:');
  stores.push(store);
  return { store, research: new CompanyResearch(store) };
};
const at = () => new Date().toISOString();
const evidence = (
  source_type: 'official' | 'job' | 'engineering' | 'employee_report' = 'official',
  url = 'https://example.test/policy',
) => ({
  url,
  title: 'Fixture',
  source_type,
  observed_at: at(),
  excerpt: 'Explicit, verifiable fixture statement',
});
const observation = (
  criterion_id = 'A04',
  value: Observation['value'] = true,
  extra: Record<string, unknown> = {},
) =>
  observationSchema.parse({
    criterion_id,
    value,
    confidence: 'high',
    scope: {},
    reasoning: 'Fixture reasoning',
    evidence: [evidence()],
    ...extra,
  });
const stored = (
  id = 'A04',
  value: Observation['value'] = true,
  extra: Record<string, unknown> = {},
): StoredObservation =>
  ({
    ...observation(
      id,
      value,
      Object.fromEntries(
        Object.entries(extra).filter(([k]) => !['verifiedAt', 'rejected', 'manual'].includes(k)),
      ),
    ),
    id: Math.random().toString(),
    companyId: 'fixture',
    runId: 'run',
    importedAt: at(),
    verifiedAt: at(),
    rejected: false,
    reviewNote: '',
    manual: false,
    ...extra,
  }) as StoredObservation;
const document = (
  observations = [observation()],
  identity: Record<string, unknown> = { name: 'Fixture Co', website: 'https://example.test' },
) => ({
  schema_version: '1.0',
  generated_at: at(),
  research_mode: 'external_research',
  companies: [{ identity, observations, job_urls: [], red_flags: [], notes: 'External notes' }],
});
const apply = (research: CompanyResearch, data: unknown) =>
  research.apply({ previewId: research.preview(data).previewId, confirmed: true });
afterEach(() => {
  stores.splice(0).forEach((s) => s.db.close());
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe('Evidence and deterministic scores', () => {
  it('counts pass/fail/unknown/conflicting separately and does not inflate low coverage', () => {
    const result = summarize([
      stored('AN01', true),
      stored('AN04', false),
      stored('AN06', 'product_data'),
      stored('AN06', 'bi_de_ml'),
    ]);
    expect(result.scores.AN).toMatchObject({
      pass: 1,
      fail: 1,
      unknown: 2,
      conflicting: 1,
      total: 5,
      coverage: 0.4,
      positiveShare: 0.5,
    });
    const sparse = summarize([stored('AN04', true)]).scores.AN;
    expect(sparse.coverage).toBe(0.2);
    expect(sparse.pass).toBe(1);
    expect(sparse.unknown).toBe(4);
  });
  it('excludes descriptive and subjective criteria from numeric scores', () => {
    const base = summarize([]).scores;
    expect(summarize([stored('B02', 'scale-up'), stored('B03', 'Love UX')]).scores).toEqual(base);
    expect(registry.criteria.filter((c) => c.kind === 'subjective').map((c) => c.id)).toEqual([
      'B03',
    ]);
  });
  it('does not treat suggested LLM verdict, weak evidence or employee reports as confirmed positives', () => {
    expect(effectiveVerdict(stored('A04', false, { verdict: 'pass' }))).toBe('fail');
    expect(effectiveVerdict(stored('A04', true, { verifiedAt: null, verdict: 'pass' }))).toBe(
      'unknown',
    );
    expect(effectiveVerdict(stored('A04', true, { confidence: 'low' }))).toBe('unknown');
    expect(effectiveVerdict(stored('A04', true, { evidence: [evidence('employee_report')] }))).toBe(
      'unknown',
    );
    expect(effectiveVerdict(stored('A04', true, { evidence: [] }))).toBe('unknown');
  });
  it('requires an explicitly complete list before failing a language or technology criterion', () => {
    expect(effectiveVerdict(stored('A01', ['es']))).toBe('unknown');
    expect(effectiveVerdict(stored('A01', ['es'], { complete: true }))).toBe('fail');
    expect(effectiveVerdict(stored('T01', ['PostgreSQL']))).toBe('unknown');
    expect(effectiveVerdict(stored('T01', ['BigQuery']))).toBe('pass');
  });
  it('respects countries and jobs; opposing conditions in separate scopes are retained', () => {
    const a = stored('A04', true, { scope: { country: 'ES', job_url: 'https://example.test/es' } }),
      b = stored('A04', false, { scope: { country: 'DE', job_url: 'https://example.test/de' } });
    expect(summarize([a, b], 'ES').scores.A.pass).toBe(1);
    expect(summarize([a, b], 'ES').scores.A.fail).toBe(0);
    expect(summarize([a, b], 'DE').scores.A.fail).toBe(1);
    expect(summarize([a, b]).scores.A.conflicting).toBe(1);
    expect(
      summarize([a, b], 'ES').criteria.find((c) => c.criterion.id === 'A04')!.observations,
    ).toHaveLength(1);
  });
  it('treats historical/future evidence and stale verification as unknown', () => {
    expect(
      effectiveVerdict(
        stored('A04', true, { evidence: [{ ...evidence(), published_at: '2020-01-01' }] }),
      ),
    ).toBe('unknown');
    expect(effectiveVerdict(stored('A04', true, { verifiedAt: '2020-01-01' }))).toBe('unknown');
    expect(
      effectiveVerdict(
        stored('A04', true, { evidence: [{ ...evidence(), observed_at: '2100-01-01' }] }),
      ),
    ).toBe('unknown');
  });
});
describe('Research import, identity and histories', () => {
  it('strictly validates types/version/URLs/criterion IDs and the documented multi-company example', () => {
    const sample = JSON.parse(
      readFileSync('discovery/examples/research-import.example.json', 'utf8'),
    );
    expect(researchImportSchema.parse(sample).companies).toHaveLength(2);
    for (const patch of [{ schema_version: '2.0' }, { unexpected: true }])
      expect(() => researchImportSchema.parse({ ...document(), ...patch })).toThrow();
    expect(() => observationSchema.parse({ ...observation(), criterion_id: 'T04' })).toThrow();
    expect(() => observationSchema.parse({ ...observation(), value: 'yes' })).toThrow();
    expect(() =>
      observationSchema.parse({
        ...observation(),
        evidence: [{ ...evidence(), url: 'javascript:alert(1)' }],
      }),
    ).toThrow();
    expect(() =>
      observationSchema.parse({ ...observation('A02_OFFICES', ['ES']), value: ['Spain'] }),
    ).toThrow();
    for (const criterion_id of ['A02', 'A06'])
      expect(() => observationSchema.parse({ ...observation(), criterion_id })).toThrow();
    expect(JSON.parse(readFileSync('discovery/research-import.schema.json', 'utf8'))).toEqual(
      z.toJSONSchema(researchImportSchema),
    );
  });
  it('previews without changing companies/ATS, applies transactionally and deduplicates the same document', () => {
    const { store, research } = setup(),
      data = document(),
      p = research.preview(data);
    expect(store.list('companies')).toHaveLength(0);
    expect(p.summary.newCompanies).toBe(1);
    const r = research.apply({ previewId: p.previewId, confirmed: true });
    expect(r.addedFacts).toBe(1);
    expect(store.list('companies')).toHaveLength(1);
    expect(store.list('jobs')).toHaveLength(0);
    expect(research.apply({ previewId: p.previewId, confirmed: true }).alreadyImported).toBe(true);
    const reordered = {
      companies: data.companies,
      research_mode: data.research_mode,
      generated_at: data.generated_at,
      schema_version: data.schema_version,
    };
    expect(apply(research, reordered).alreadyImported).toBe(true);
    expect(research.history()).toHaveLength(1);
    expect(research.list().companies[0].scores.A.pass).toBe(0);
    expect('history' in research.list().companies[0]).toBe(false);
  });
  it('requires explicit confirmation, binds a preview to current state and expires it', () => {
    const { store, research } = setup(),
      p = research.preview(document());
    expect(() => research.apply({ previewId: p.previewId })).toThrow();
    store.saveCompany({ name: 'Added after preview' });
    expect(() => research.apply({ previewId: p.previewId, confirmed: true })).toThrow(
      'Данные изменились',
    );
    const next = research.preview(document());
    vi.useFakeTimers();
    vi.advanceTimersByTime(3600001);
    expect(() => research.apply({ previewId: next.previewId, confirmed: true })).toThrow('истёк');
  });
  it('links to existing IDs by domain or explicit ID, and refuses ambiguous names or conflicting IDs', () => {
    const { store, research } = setup(),
      c = store.saveCompany({
        name: 'Existing Co',
        website: 'https://www.example.test',
        notes: 'Keep',
        dataDrivenScore: 9,
        status: 'contacted',
      });
    expect(research.preview(document()).entries[0]).toMatchObject({
      kind: 'existing',
      companyId: c.id,
    });
    const r = apply(research, document());
    expect(r.companies[0].companyId).toBe(c.id);
    expect(store.get('companies', c.id)).toMatchObject({
      notes: 'Keep',
      dataDrivenScore: 9,
      status: 'contacted',
    });
    expect(research.match({ name: 'Existing Co' }).kind).toBe('skip');
    expect(
      research.match({ name: 'Alias', company_id: c.id, website: 'https://wrong.test' }).kind,
    ).toBe('skip');
    expect(research.match({ name: 'Alias', company_id: c.id }).kind).toBe('existing');
    expect(research.match({ name: 'New without website' }).kind).toBe('skip');
    store.saveCompany({ name: 'Domain collision', website: 'https://example.test' });
    expect(research.match({ name: 'Anything', website: 'https://example.test' }).kind).toBe('skip');
  });
  it('rejects duplicate companies within one document before writing', () => {
    const { store, research } = setup(),
      data = document();
    expect(() =>
      research.preview({
        ...data,
        companies: [
          data.companies[0],
          {
            ...data.companies[0],
            identity: { name: 'Different name', website: 'https://example.test' },
          },
        ],
      }),
    ).toThrow('домен');
    expect(store.list('companies')).toHaveLength(0);
  });
  it('rolls back all facts and new companies after a failure late in apply', () => {
    const { store, research } = setup(),
      data = document();
    const p = research.preview({
      ...data,
      companies: [
        data.companies[0],
        { ...data.companies[0], identity: { name: 'Other', website: 'https://other.test' } },
      ],
    });
    const original = store.saveCompany.bind(store);
    let count = 0;
    vi.spyOn(store, 'saveCompany').mockImplementation((input, id) => {
      if (++count === 2) throw new Error('Injected late failure');
      return original(input, id);
    });
    expect(() => research.apply({ previewId: p.previewId, confirmed: true })).toThrow('Injected');
    expect(store.list('companies')).toHaveLength(0);
    expect(research.history()).toHaveLength(0);
    expect(store.db.prepare('SELECT COUNT(*) n FROM company_research_observations').get()?.n).toBe(
      0,
    );
  });
  it('keeps verified old facts, unknowns and weaker conflicting imports until explicit review', () => {
    const { research } = setup();
    const r = apply(research, document());
    const id = r.companies[0].companyId!;
    research.preferences(id, { priority: 'Target', notes: 'Personal discovery note' });
    let p = research.profile(id);
    const old = p.observations[0];
    research.review(old.id, { verified: true, note: 'Checked primary text' });
    apply(research, document([observation('A04', null)], { name: 'Fixture Co', company_id: id }));
    expect(research.profile(id).scores.A.pass).toBe(1);
    const conflicting = document([observation('A04', false, { confidence: 'medium' })], {
      name: 'Fixture Co',
      company_id: id,
    });
    expect(research.preview(conflicting).entries[0].observations[0].action).toBe('conflict');
    apply(research, conflicting);
    p = research.profile(id);
    expect(p.scores.A.pass).toBe(1);
    expect(p.preferences.notes).toBe('Personal discovery note');
    const candidate = p.observations.find((o) => o.value === false)!;
    research.review(candidate.id, { verified: true });
    expect(research.profile(id).scores.A.conflicting).toBe(1);
    research.review(candidate.id, {
      verified: false,
      rejected: true,
      note: 'Source applies to a different entity',
    });
    p = research.profile(id);
    expect(p.scores.A.pass).toBe(1);
    expect(p.observations).toHaveLength(3);
    expect(p.reviewHistory).toHaveLength(3);
    expect(research.plan(id).gaps.some((g) => ['A02', 'A06'].includes(g.criterionId))).toBe(false);
  });
  it('requires matching job scope before verifying and never turns a review into company fact', () => {
    const { research } = setup();
    const r = apply(
      research,
      document([observation('A04', true, { evidence: [evidence('job')] })]),
    );
    const id = r.companies[0].companyId!;
    expect(() =>
      research.review(research.profile(id).observations[0].id, { verified: true }),
    ).toThrow('scope.job_url');
    research.manual(
      id,
      observation('P01', 'Reported overtime', { evidence: [evidence('employee_report')] }),
    );
    const o = research.profile(id).observations.find((o) => o.criterion_id === 'P01')!;
    research.review(o.id, { verified: true });
    expect(research.profile(id).confirmed.some((o) => o.criterion_id === 'P01')).toBe(false);
  });
  it('does not treat an office, remote work or stale ATS post as current hiring/visa support', () => {
    const { store, research } = setup();
    const c = store.saveCompany({ name: 'Fixture Co', location: 'Barcelona, Spain' });
    store.addJob({
      company: c.name,
      title: 'Senior Product Analyst',
      url: 'https://example.test/old',
      location: 'Barcelona, Spain',
      workMode: 'remote',
    });
    const p = research.profile(c.id);
    expect(p.currentJobs).toHaveLength(0);
    expect(p).not.toHaveProperty('countries');
    expect(p.scores.A.pass).toBe(0);
    expect(p.jobs[0].freshness).toBe('unverified_or_stale');
  });
  it('uses shared ATS monitors/quota adapters, preserves company ID and exposes current suitable jobs', async () => {
    const { store, research } = setup();
    const network = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          jobs: [
            {
              id: '1',
              title: 'Senior Product Analyst',
              jobUrl: 'https://example.test/role',
              location: 'Barcelona, Spain',
              descriptionPlain: 'SQL statistics experiments',
              isListed: true,
              workplaceType: 'Hybrid',
            },
          ],
        }),
      ),
    );
    const tools = new SourceTools(store, network),
      board = tools.addBoard({ provider: 'ashby', name: 'Fixture Co', board: 'fixture' });
    expect((await tools.monitor({ sourceIds: [board.id] })).execute).toBe(false);
    expect(network).not.toHaveBeenCalled();
    await tools.monitor({ sourceIds: [board.id], execute: true, maxRequests: 1 });
    expect(network).toHaveBeenCalledTimes(1);
    const p = research.profile(board.companyId);
    expect(p.currentJobs).toHaveLength(1);
    expect(p.currentJobs[0].countries).toEqual(['ES']);
    expect(p.scores.A.pass).toBe(0);
    await tools.monitor({ sourceIds: [board.id], execute: true, maxRequests: 1 });
    expect(network).toHaveBeenCalledTimes(1);
  });
});
describe('Paid provider gate', () => {
  const operation = (id: string): PaidOperation => ({
    provider: 'apify',
    actor: 'fixture/actor',
    operation: 'reviews',
    companyIds: [id],
    volume: 50,
    parameters: { sort: 'recent' },
    maxCostUsd: 2,
  });
  it('blocks absent confirmation/unconnected Actors and preview never makes calls', async () => {
    const { store } = setup(),
      id = store.saveCompany({ name: 'Fixture' }).id;
    const gate = new ResearchPaidGate(store);
    expect(gate.plan()).toMatchObject({ requests: 0, costUsd: 0, availableActors: [] });
    await expect(gate.authorize({ operation: operation(id) })).rejects.toThrow();
    await expect(gate.authorize({ operation: operation(id), confirmed: true })).rejects.toThrow(
      'не подключён',
    );
    await expect(gate.execute({ operation: operation(id) })).rejects.toThrow();
  });
  it('binds one-use consent to company/Actor/operation/volume/parameters and enforces quote + cap', async () => {
    const { store } = setup(),
      id = store.saveCompany({ name: 'Fixture' }).id;
    const executor = vi.fn().mockResolvedValue({ costUsd: 0.75, data: [] }),
      quote = vi.fn().mockResolvedValue({ upperBoundUsd: 1, pricingAt: at() });
    const gate = new ResearchPaidGate(store, { 'fixture/actor': { quote, execute: executor } }),
      op = operation(id);
    const grant = await gate.authorize({ operation: op, confirmed: true });
    for (const patch of [
      { volume: 51 },
      { parameters: { sort: 'old' } },
      { operation: 'salaries' },
      { companyIds: ['other'] },
      { actor: 'other/actor' },
      { maxCostUsd: 10 },
    ])
      await expect(
        gate.execute({ grantId: grant.grantId, operation: { ...op, ...patch } }),
      ).rejects.toThrow();
    expect(executor).not.toHaveBeenCalled();
    await gate.execute({ grantId: grant.grantId, operation: op });
    expect(executor).toHaveBeenCalledWith({ ...op, hardBudgetUsd: 1 });
    await expect(gate.execute({ grantId: grant.grantId, operation: op })).rejects.toThrow(
      'одноразовое',
    );
    expect(
      JSON.parse(
        store.db.prepare('SELECT data FROM company_research_paid_ledger').get()?.data as string,
      ),
    ).toMatchObject({ status: 'completed', costUsd: 0.75 });
    executor.mockResolvedValueOnce({ costUsd: 1.5, data: [] });
    const next = await gate.authorize({ operation: op, confirmed: true });
    await expect(gate.execute({ grantId: next.grantId, operation: op })).rejects.toThrow(
      'hard budget',
    );
    await expect(gate.execute({ grantId: next.grantId, operation: op })).rejects.toThrow(
      'одноразовое',
    );
  });
  it('rejects unknown/stale/over-budget pricing and consumes consent on an unknown outcome', async () => {
    const { store } = setup(),
      id = store.saveCompany({ name: 'Fixture' }).id;
    const executor = vi.fn().mockRejectedValue(new Error('Unknown network outcome')),
      quote = vi.fn();
    const gate = new ResearchPaidGate(store, { 'fixture/actor': { quote, execute: executor } }),
      op = operation(id);
    for (const q of [
      { upperBoundUsd: NaN, pricingAt: at() },
      { upperBoundUsd: 3, pricingAt: at() },
      { upperBoundUsd: 1, pricingAt: '2020-01-01' },
    ]) {
      quote.mockResolvedValue(q);
      await expect(gate.authorize({ operation: op, confirmed: true })).rejects.toThrow('границы');
    }
    quote.mockResolvedValue({ upperBoundUsd: 1, pricingAt: at() });
    const grant = await gate.authorize({ operation: op, confirmed: true });
    await expect(gate.execute({ operation: op, grantId: grant.grantId })).rejects.toThrow(
      'Unknown network',
    );
    await expect(gate.execute({ operation: op, grantId: grant.grantId })).rejects.toThrow(
      'одноразовое',
    );
    expect(executor).toHaveBeenCalledTimes(1);
  });
});

describe('Comparison filters and scope', () => {
  it('filters work format using current vacancies and confirmed work policies', async () => {
    const { comparisonModeMatches } = await import('../src/company-comparison');
    const { store, research } = setup();
    const c = store.saveCompany({ name: 'Format fixture' });
    const job = store.addJob({
      company: c.name,
      title: 'Senior Product Analyst',
      workMode: 'remote',
      location: 'Barcelona',
    }).job;
    store.writeJob({ ...job, lastSeenAt: at() });
    expect(comparisonModeMatches(research.profile(c.id), 'remote')).toBe(true);
    expect(comparisonModeMatches(research.profile(c.id), 'hybrid')).toBe(false);
    research.manual(c.id, observation('A05', { modes: ['hybrid'], eligible_countries: ['ES'] }));
    research.review(research.profile(c.id).observations[0].id, { verified: true });
    expect(comparisonModeMatches(research.profile(c.id), 'hybrid')).toBe(true);
    expect(comparisonModeMatches(research.profile(c.id), 'all')).toBe(true);
  });
  it('does not use general hiring/remote lists for a different selected country', () => {
    const result = summarize(
      [
        stored('A02_OFFICES', ['DE']),
        stored('A05', { modes: ['remote'], eligible_countries: ['DE'] }),
      ],
      'ES',
    );
    expect(result.scores.A.pass).toBe(0);
    expect(result.criteria.find((c) => c.criterion.id === 'A05')!.known).toHaveLength(0);
  });
});

it('does not create a conflict from list ordering, and marks scope heterogeneity as research conflict', () => {
  expect(
    summarize([stored('T01', ['ClickHouse', 'Spark']), stored('T01', ['Spark', 'ClickHouse'])])
      .scores.T.conflicting,
  ).toBe(0);
  const { store, research } = setup();
  const c = store.saveCompany({ name: 'Scoped fixture' });
  for (const [country, value] of [
    ['ES', true],
    ['DE', false],
  ] as const) {
    research.manual(c.id, observation('A04', value, { scope: { country } }));
    research.review(research.profile(c.id).observations[0].id, { verified: true });
  }
  expect(research.profile(c.id).researchStatus).toBe('conflicting');
  expect(research.profile(c.id, 'ES').scores.A.pass).toBe(1);
});

it('merges partial technology signals without a false contradiction and retains explicit complete-list conflicts', () => {
  expect(
    summarize([stored('T01', ['ClickHouse']), stored('T01', ['Spark'])]).scores.T,
  ).toMatchObject({ pass: 1, conflicting: 0 });
  expect(
    summarize([stored('T01', ['ClickHouse'], { complete: true }), stored('T01', ['Spark'])]).scores
      .T.conflicting,
  ).toBe(1);
});

it('keeps headquarters independent of hiring scope and never infers HQ from an office or a vacancy', async () => {
  const { headquartersProfile } = await import('../shared/company-research');
  const { headquartersBadges } = await import('../src/company-comparison');
  const { store, research } = setup();
  const c = store.saveCompany({ name: 'HQ fixture', location: 'Barcelona, Spain' });
  expect(research.profile(c.id).headquarters).toMatchObject({ countries: [], status: 'unknown' });
  research.manual(c.id, observation('A02_OFFICES', ['ES']));
  research.review(research.profile(c.id).observations[0].id, { verified: true });
  expect(research.profile(c.id).headquarters.countries).toEqual([]);
  research.manual(
    c.id,
    observation('A02_HQ', ['US'], { scope: { country: 'US', context: 'headquarters' } }),
  );
  expect(research.profile(c.id).headquarters.status).toBe('pending');
  research.review(research.profile(c.id).observations[0].id, { verified: true });
  const hq = research.profile(c.id, 'ES').headquarters;
  expect(hq).toMatchObject({ countries: ['US'], status: 'verified' });
  expect(headquartersBadges(hq)[0]).toMatchObject({
    code: 'US',
    label: 'Соединенные Штаты',
    tone: 'hq-purple',
  });
  expect(
    headquartersProfile([stored('A02_HQ', ['ES'], { evidence: [evidence('job')] })]).countries,
  ).toEqual([]);
  expect(headquartersProfile([stored('A02_HQ', ['FR'], { verifiedAt: null })]).status).toBe(
    'pending',
  );
  const distributed = headquartersProfile([
    stored('A02_HQ', null, { scope: { context: 'distributed_headquarters' } }),
  ]);
  expect(distributed).toMatchObject({ countries: [], status: 'distributed' });
  expect(distributed.evidence).toHaveLength(1);
  expect(headquartersBadges(distributed)[0].label).toBe('Распределённая команда');
  expect(
    headquartersProfile([
      stored('A02_HQ', null, { scope: { context: 'distributed_headquarters' }, confidence: 'low' }),
    ]).status,
  ).toBe('unknown');
  expect(
    headquartersProfile([
      stored('A02_HQ', ['ES'], {
        scope: { job_url: 'https://example.test/policy', context: 'company_headquarters' },
        evidence: [evidence('job')],
      }),
    ]).countries,
  ).toEqual(['ES']);
  expect(summarize([stored('A02_HQ', ['US'])]).scores).toEqual(summarize([]).scores);
  expect(
    headquartersProfile([
      stored('A02_HQ', ['US'], { complete: true }),
      stored('A02_HQ', ['ES'], { complete: true }),
    ]).status,
  ).toBe('conflicting');
});
