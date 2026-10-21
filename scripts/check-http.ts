import { registry } from '../shared/company-research.js';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { get } from 'node:http';

// Uses an isolated temporary database. Build the frontend first.
const dir = mkdtempSync(join(tmpdir(), 'jobs-checker-http-'));
const port = 4328;
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts', '--production'], {
  env: {
    ...process.env,
    PORT: String(port),
    SCOUT_DB: join(dir, 'test.sqlite'),
    APIFY_TOKEN: '',
    JOBS_GLASSDOOR_MAX_RUN_USD: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
child.stderr.on('data', (b) => {
  logs += b.toString();
});
try {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Server startup timed out: ${logs}`)), 10000);
    child.stdout.on('data', (b) => {
      if (String(b).includes('Jobs checker доступен')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Server exited ${code}: ${logs}`));
    });
  });
  const call = async (path: string, method = 'GET', body?: unknown) => {
    const response = await fetch(`${base}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });
    return { status: response.status, body: await response.json() };
  };
  assert.equal((await fetch(base)).status, 200);
  const health = (await call('/health')).body;
  assert.equal(health.ok, true);
  assert.equal(health.application, 'jobs-checker');
  assert.equal(health.workspace, process.cwd());
  const selection = (await call('/selection')).body;
  assert.equal(selection.version, 1);
  const updated = await call('/selection', 'PATCH', {
    expectedVersion: selection.version,
    core: selection.core,
    scenarios: [{ id: 'http-es', name: 'Испания', locations: ['Spain'] }],
    activeScenarioId: 'http-es',
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.coreVersion, selection.coreVersion);
  assert.equal((await call('/selection/history')).body.versions.length, 2);
  assert.equal(
    (
      await call('/selection', 'PATCH', {
        expectedVersion: selection.version,
        core: selection.core,
        scenarios: [],
        activeScenarioId: '',
      })
    ).status,
    400,
  );
  assert.equal((await call('/state')).body.effectiveProfile.selection.scenarioId, 'http-es');
  assert.equal(
    (
      await fetch(`${base}/api/jobs`, {
        method: 'POST',
        headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
        body: '{}',
      })
    ).status,
    403,
  );
  assert.equal((await fetch(`${base}/api/jobs`, { method: 'POST', body: '{}' })).status, 415);
  // Fetch may normalize/ignore Host; use the HTTP client to send an actual hostile Host.
  const hostileHostStatus = await new Promise<number | undefined>((resolve, reject) => {
    get(`${base}/api/state`, { headers: { Host: 'evil.example' } }, (response) => {
      response.resume();
      resolve(response.statusCode);
    }).on('error', reject);
  });
  assert.equal(hostileHostStatus, 403);
  const fixture = {
    title: 'HTTP test role',
    company: 'Test Company',
    url: 'https://example.com/http-check',
  };
  const created = await call('/jobs', 'POST', fixture);
  assert.equal(created.body.created, true);
  const id = created.body.job.id;
  await call(`/jobs/${id}`, 'PATCH', { stage: 'applied', notes: 'Persist me' });
  assert.equal((await call('/jobs', 'POST', fixture)).body.created, false);
  const state = (await call('/state')).body;
  assert.equal(state.jobs[0].notes, 'Persist me');
  assert.equal(state.jobs[0].history.length, 2);
  const bad = await call('/import', 'POST', {
    companies: [{ name: 'Should not exist' }],
    jobs: [{ title: '', company: 'Invalid' }],
  });
  assert.equal(bad.status, 400);
  assert.equal((await call('/state')).body.companies.length, 1);
  const sourceEvidence = {
    checkedAt: new Date().toISOString(),
    evidenceUrls: ['https://example.com/'],
    evidence: 'Official website links to this company Careers.',
    verificationMethod: 'official_site',
  };
  const hiringSources = {
    checkedAt: sourceEvidence.checkedAt,
    careers: { ...sourceEvidence, url: 'https://example.com/careers', status: 'confirmed' },
  };
  assert.equal(
    (await call(`/companies/${created.body.job.companyId}`, 'PATCH', { hiringSources })).status,
    200,
  );
  await call(`/companies/${created.body.job.companyId}`, 'PATCH', { industry: 'Fixture industry' });
  const cultureId = created.body.job.companyId;
  assert.equal(
    (await call(`/company-research/${cultureId}/culture-plan`)).body.mode,
    'culture_team',
  );
  const culture = await call(`/company-research/${cultureId}/culture-assessment`, 'POST', {
    kind: 'culture_team',
    methodologyVersion: 2,
    profileVersion: selection.coreVersion,
    business: { text: '', evidenceIds: [] },
    teams: [],
    company: {
      summary: { text: '', evidenceIds: [] },
      strengths: [],
      gaps: [],
      nextStep: 'Read source',
      dimensions: ['influence', 'experimentation', 'peers', 'data', 'product', 'automation'].map(
        (id) => ({ id, rating: null, reason: 'Unknown', basis: 'unknown', evidenceIds: [] }),
      ),
    },
  });
  assert.equal(culture.status, 200);
  assert.equal(culture.body.fit.culture.company.score, null);
  assert.equal(
    (await call(`/company-research/${cultureId}/assessments`)).body.assessments.length,
    1,
  );
  const hiringProfile = (await call(`/company-research/${created.body.job.companyId}`)).body;
  assert.equal(hiringProfile.company.hiringSources.careers.url, hiringSources.careers.url);
  const exported = (await call('/export')).body;
  assert.equal(exported.companies[0].hiringSources.careers.url, hiringSources.careers.url);
  assert.equal(exported.jobs.length, 1);
  assert.equal(exported.jobs[0].notes, 'Persist me');
  assert.equal((await call('/import', 'POST', exported)).body.skipped, 1);
  assert.equal((await call('/unknown')).status, 404);
  const researchDoc = {
    schema_version: '1.0',
    generated_at: new Date().toISOString(),
    research_mode: 'external_research',
    companies: [
      {
        identity: { name: fixture.company, company_id: created.body.job.companyId },
        observations: [
          {
            criterion_id: 'A04',
            value: null,
            confidence: 'low',
            scope: { country: 'ES' },
            reasoning: 'Unknown fixture',
            evidence: [],
          },
        ],
        job_urls: [],
        red_flags: [],
        notes: 'Fixture',
      },
    ],
  };
  const researchPreview = await call('/company-research/preview', 'POST', researchDoc);
  assert.equal(researchPreview.status, 200);
  assert.equal(
    (await call('/company-research/import', 'POST', { previewId: researchPreview.body.previewId }))
      .status,
    400,
  );
  assert.equal(
    (
      await call('/company-research/import', 'POST', {
        previewId: researchPreview.body.previewId,
        confirmed: true,
      })
    ).body.addedFacts,
    1,
  );
  assert.equal(
    (
      await call('/company-research/import', 'POST', {
        previewId: researchPreview.body.previewId,
        confirmed: true,
      })
    ).body.alreadyImported,
    true,
  );
  const companyResearch = (await call('/company-research/' + created.body.job.companyId)).body;
  assert.equal(companyResearch.observations.length, 1);
  assert.equal(companyResearch.scores.A.pass, 0);
  const scoresCalculatedAt = companyResearch.scoresCalculatedAt;
  assert.ok(scoresCalculatedAt);
  assert.equal(
    (await call('/company-research?country=DE')).body.companies[0].scoresCalculatedAt,
    scoresCalculatedAt,
  );
  const recalculated = await call('/company-research/recalculate', 'POST', {
    companyIds: [created.body.job.companyId],
  });
  assert.equal(recalculated.status, 200);
  assert.equal(recalculated.body.companies[0].companyId, created.body.job.companyId);
  assert.equal(
    (await call('/company-research/recalculate', 'POST', { companyIds: [] })).status,
    400,
  );
  assert.equal(
    (await call('/company-research/recalculate', 'POST', { companyIds: ['missing'] })).status,
    400,
  );
  assert.equal(companyResearch.targetVacancies.contract.version, '1.0');
  assert.equal(companyResearch.targetVacancies.companyId, created.body.job.companyId);
  assert.equal(companyResearch.targetVacancies.total, 0); // HTTP fixture is not a target role
  assert.deepEqual(companyResearch.targetVacancies.jobIds, []);
  assert.equal((await call('/company-research/criteria')).body.version, registry.version);
  assert.ok(
    (await call('/company-research/' + created.body.job.companyId + '/plan')).body.gaps.length,
  );
  const paidStatus = (await call('/company-research/paid')).body;
  assert.deepEqual(paidStatus.availableActors, ['memo23/glassdoor-scraper-ppr']);
  assert.equal(paidStatus.adapters['memo23/glassdoor-scraper-ppr'].configured, false);
  assert.equal(paidStatus.adapters['memo23/glassdoor-scraper-ppr'].datasetRead, 'disabled');
  assert.deepEqual((await call('/company-research/paid/runs')).body.runs, []);
  assert.equal((await call('/company-research/paid/authorize', 'POST', {})).status, 400);
  assert.equal((await call('/company-research/paid/execute', 'POST', {})).status, 400);
  assert.equal((await call('/state')).body.jobs[0].notes, 'Persist me');
  if (process.argv.includes('--live')) {
    const result = await call('/sync', 'POST', {});
    assert.equal(result.status, 200);
    assert.equal(result.body.results[0].error, undefined, result.body.results[0].error);
    const cached = await call('/sync', 'POST', {});
    assert.equal(cached.body.results[0].cached, true);
    console.log(`Live sync: ${result.body.results[0].total} Remotive jobs; repeat used cache.`);
  }
  console.log(
    'HTTP check passed: production UI, CRUD, validation, import/export, loopback protections.',
  );
} finally {
  if (child.exitCode === null) {
    child.kill('SIGTERM');
    await once(child, 'exit');
  }
  rmSync(dir, { recursive: true, force: true });
}
