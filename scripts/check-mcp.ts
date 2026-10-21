import { registry } from '../shared/company-research.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import assert from 'node:assert/strict';

const dir = mkdtempSync(join(tmpdir(), 'jobs-mcp-'));
const base = 'http://127.0.0.1:4338';
const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts', '--production'], {
  env: {
    ...process.env,
    PORT: '4338',
    SCOUT_DB: join(dir, 'test.sqlite'),
    APIFY_TOKEN: '',
    JOBS_GLASSDOOR_MAX_RUN_USD: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
child.stderr.on('data', (chunk) => {
  logs += String(chunk);
});
const client = new Client({ name: 'jobs-checker-test', version: '1.0.0' });
try {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Server timeout: ${logs}`)), 10000);
    child.stdout.on('data', (chunk) => {
      if (String(chunk).includes('Jobs checker доступен')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Server exited ${code}: ${logs}`));
    });
  });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ['--import', 'tsx', 'scripts/jobs-mcp.ts'],
      cwd: process.cwd(),
      env: { ...(process.env as Record<string, string>), SCOUT_API_URL: base },
      stderr: 'pipe',
    }),
  );
  const listed = await client.listTools();
  assert.equal(listed.tools.length, 36);
  for (const suffix of ['status', 'quote', 'authorize', 'execute', 'runs', 'refresh', 'normalize'])
    assert.ok(listed.tools.some((t) => t.name === `jobs_company_paid_${suffix}`));
  assert.ok(listed.tools.some((t) => t.name === 'jobs_company_research_recalculate'));
  assert.ok(listed.tools.some((t) => t.name === 'jobs_company_research_import'));
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    assert.ok(!result.isError, JSON.stringify(result));
    return result.structuredContent as any;
  };
  const status = await call('jobs_sources_status');
  const paidStatus = await call('jobs_company_paid_status');
  assert.equal(paidStatus.adapters['memo23/glassdoor-scraper-ppr'].configured, false);
  assert.deepEqual((await call('jobs_company_paid_runs')).runs, []);
  const denied = await client.callTool({ name: 'jobs_company_paid_execute', arguments: {} });
  assert.ok(denied.isError);
  assert.equal(status.providers.length, 10);
  assert.ok(status.providers.some((p: any) => p.id === 'jobicy' && !p.missing.length));
  assert.equal(status.providers.find((p: any) => p.id === 'adzuna').quota.limit, 2500);
  assert.equal(status.providers.find((p: any) => p.id === 'jooble').quota.limit, 500);
  assert.equal(
    status.providers.find((p: any) => p.id === 'jooble').quota.windows[0].nextResetAt,
    null,
  );
  assert.ok(status.providers.find((p: any) => p.id === 'serpapi').quota.updatedAt);
  const plan = await call('jobs_search', {
    providers: ['adzuna'],
    keywords: ['Analyst'],
    store: true,
  });
  assert.equal(plan.execute, false);
  assert.equal(plan.requests, 0);
  const nativePlan = await call('jobs_search', {
    providers: ['adzuna'],
    country: 'es',
    keywords: [],
    adzuna: {
      what_phrase: 'product analyst',
      salary_min: 60000,
      salary_include_unknown: true,
      full_time: true,
      max_days_old: 14,
    },
  });
  assert.equal(nativePlan.targets.length, 1);
  assert.equal(nativePlan.targets[0].params.salary_min, '60000');
  assert.equal(nativePlan.targets[0].params.salary_include_unknown, '1');
  assert.equal(nativePlan.targets[0].params.what_phrase, 'product analyst');
  assert.equal(nativePlan.requests, 0);
  const invalidNative = await client.callTool({
    name: 'jobs_search',
    arguments: { providers: ['adzuna'], adzuna: { salary_min: 90000, salary_max: 60000 } },
  });
  assert.equal(invalidNative.isError, true);

  assert.equal((await call('jobs_discovery_history')).reviews.length, 0);
  const review = {
    id: 'test-discovery',
    title: 'Test strategy',
    summary: 'Prefer new domains',
    stats: { requests: 0, returned: 0, unique: 0, added: 0 },
  };
  await call('jobs_discovery_save', review);
  await call('jobs_discovery_save', { ...review, summary: 'Prefer verified employers' });
  const history = await call('jobs_discovery_history');
  assert.equal(history.reviews.length, 1);
  assert.equal(history.reviews[0].summary, 'Prefer verified employers');
  const data = {
    jobs: [
      {
        title: 'MCP fixture',
        company: 'Test company',
        url: 'https://example.com/mcp-fixture',
        source: 'import',
      },
    ],
  };
  await call('jobs_ats_import', { data });
  assert.equal((await call('jobs_ats_list')).jobs.length, 0);
  assert.equal((await call('jobs_ats_import', { data, store: true })).added, 1);
  assert.equal((await call('jobs_ats_import', { data, store: true })).skipped, 1);
  const job = (await call('jobs_ats_list')).jobs[0];
  await call('jobs_ats_update', { jobId: job.id, stage: 'saved', notes: 'Keep this' });
  await call('jobs_ats_update', {
    jobId: job.id,
    aiScore: 8.5,
    aiSummary: 'Relevant',
    aiReason: 'Evidence',
    aiProfileId: 'test',
    aiReviewedAt: new Date().toISOString(),
    aiEvidenceUrls: [job.url],
  });
  assert.equal((await call('jobs_ats_list', { stage: 'saved' })).jobs[0].notes, 'Keep this');
  assert.equal((await call('jobs_ats_list')).jobs[0].aiScore, 8.5);
  await call('jobs_ats_update', { jobId: job.id, favorite: true });
  assert.equal((await call('jobs_ats_list')).jobs[0].aiScore, 8.5);
  const board = await call('jobs_add_company_board', {
    provider: 'lever',
    board: 'https://jobs.eu.lever.co/test',
    name: 'Test company',
  });
  assert.equal(board.region, 'eu');
  assert.equal((await call('jobs_monitor_companies')).due.length, 1);
  const web = (await call('jobs_web_search_plan', { keywords: ['SQL'] })).resources;
  assert.equal(web.length, 7);
  assert.ok(web.some((r: any) => r.id === 'workday' && r.query.includes('myworkdayjobs.com')));
  const jobicyPlan = await call('jobs_search', {
    providers: ['jobicy'],
    keywords: ['Data Analyst'],
  });
  assert.equal(jobicyPlan.execute, false);
  assert.equal(jobicyPlan.requests, 0);
  assert.equal(jobicyPlan.providers[0].status, 'ready');
  const criteria = await call('jobs_company_research_criteria');
  assert.equal(criteria.version, registry.version);
  const companyId = job.companyId;
  const profileContext = await call('jobs_profiles');
  assert.ok(profileContext.selection.core);
  const configured = await call('jobs_selection_update', {
    expectedVersion: profileContext.selection.version,
    core: profileContext.selection.core,
    scenarios: [{ id: 'mcp-es', name: 'Испания', locations: ['Spain'] }],
    activeScenarioId: 'mcp-es',
  });
  assert.equal(configured.coreVersion, profileContext.selection.coreVersion);
  const scopedPlan = await call('jobs_search', { providers: ['jobicy'], scenarioId: 'mcp-es' });
  assert.deepEqual(scopedPlan.filters.locations, ['Spain']);
  assert.equal(scopedPlan.context.scenarioId, 'mcp-es');
  assert.equal(scopedPlan.requests, 0);
  const noGeo = await call('jobs_search', { providers: ['jobicy'], scenarioId: 'all' });
  assert.deepEqual(noGeo.filters.locations, []);
  await call('jobs_company_assess', {
    companyId,
    assessment: {
      profileVersion: configured.coreVersion,
      scope: {},
      business: { text: '', evidenceIds: [] },
      analytics: { text: '', evidenceIds: [] },
      dimensions: ['influence', 'experimentation', 'peers', 'data', 'product', 'automation'].map(
        (id) => ({
          id,
          rating: null,
          reason: 'Fixture unknown',
          evidenceIds: [],
          basis: 'unknown',
        }),
      ),
      strengths: [],
      gaps: ['No evidence'],
      nextStep: 'Read company source',
    },
  });
  assert.equal(
    (await call('jobs_company_assessment_history', { companyId })).assessments.length,
    1,
  );
  assert.equal(
    (await call('jobs_company_research_profile', { companyId, scenarioId: 'all' })).fit.score,
    null,
  );
  const culturePlan = await call('jobs_company_culture_plan', { companyId });
  assert.equal(culturePlan.mode, 'culture_team');
  assert.ok(culturePlan.sourceQueries.length);
  const unknownCultureLayer = {
    summary: { text: '', evidenceIds: [] },
    dimensions: ['influence', 'experimentation', 'peers', 'data', 'product', 'automation'].map(
      (id) => ({ id, rating: null, reason: 'Not researched', evidenceIds: [], basis: 'unknown' }),
    ),
    strengths: [],
    gaps: ['No team evidence'],
    nextStep: 'Research independently',
  };
  const cultureResult = await call('jobs_company_culture_assess', {
    companyId,
    assessment: {
      kind: 'culture_team',
      methodologyVersion: 2,
      profileVersion: configured.coreVersion,
      business: { text: '', evidenceIds: [] },
      company: unknownCultureLayer,
      teams: [],
    },
  });
  assert.equal(cultureResult.fit.culture.methodologyVersion, 2);
  assert.equal(
    (await call('jobs_company_assessment_history', { companyId })).assessments.length,
    2,
  );
  const researchDoc = {
    schema_version: '1.0',
    generated_at: new Date().toISOString(),
    research_mode: 'external_research',
    companies: [
      {
        identity: { name: job.company, company_id: companyId },
        observations: [
          {
            criterion_id: 'A04',
            value: true,
            confidence: 'high',
            scope: { country: 'ES' },
            reasoning: 'Fixture policy',
            evidence: [
              {
                url: 'https://example.com/policy',
                title: 'Fixture policy',
                source_type: 'official',
                observed_at: new Date().toISOString(),
                excerpt: 'Sponsorship explicitly offered in fixture',
              },
            ],
          },
        ],
        job_urls: [],
        red_flags: [],
        notes: 'Fixture research',
      },
    ],
  };
  const preview = await call('jobs_company_research_preview', { data: researchDoc });
  assert.equal(preview.entries[0].companyId, companyId);
  assert.equal((await call('jobs_company_research_profile', { companyId })).observations.length, 0);
  const imported = await call('jobs_company_research_import', {
    previewId: preview.previewId,
    confirmed: true,
  });
  assert.equal(imported.addedFacts, 1);
  assert.equal(
    (await call('jobs_company_research_import', { previewId: preview.previewId, confirmed: true }))
      .alreadyImported,
    true,
  );
  const researched = await call('jobs_company_research_profile', { companyId, country: 'ES' });
  assert.equal(researched.scores.A.pass, 0);
  await call('jobs_company_research_review', {
    observationId: researched.observations[0].id,
    verified: true,
    note: 'Read fixture source',
  });
  assert.equal(
    (await call('jobs_company_research_profile', { companyId, country: 'ES' })).scores.A.pass,
    1,
  );
  await call('jobs_company_research_priority', {
    companyId,
    priority: 'Target',
    notes: 'Keep discovery note',
  });
  assert.equal((await call('jobs_company_research_plan', { companyId })).priority, 'Target');
  assert.equal((await call('jobs_company_research_history', { companyId })).runs.length, 1);
  const recalculated = await call('jobs_company_research_recalculate', { companyIds: [companyId] });
  assert.equal(recalculated.companies.length, 1);
  const calculatedAt = recalculated.companies[0].scoresCalculatedAt;
  const refreshed = await call('jobs_company_research_list', { country: 'ES' });
  assert.equal(
    refreshed.companies.find((c: any) => c.company.id === companyId).scoresCalculatedAt,
    calculatedAt,
  );
  assert.equal(
    (await call('jobs_company_research_profile', { companyId, country: 'FR' })).scoresCalculatedAt,
    calculatedAt,
  );
  assert.equal((await call('jobs_ats_list')).jobs[0].notes, 'Keep this');
  console.log(
    'MCP check passed: stdio initialization, 36 tools including manual paid research status/guards, professional core/scenarios/assessment history, research preview/import/review/history/recalculate, dry-run, board registration, web plan, ATS preview/import/dedup/update. No external provider calls.',
  );
} finally {
  await client.close();
  if (child.exitCode === null) {
    child.kill('SIGTERM');
    await once(child, 'exit');
  }
  rmSync(dir, { recursive: true, force: true });
}
