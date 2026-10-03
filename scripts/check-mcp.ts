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
  env: { ...process.env, PORT: '4338', SCOUT_DB: join(dir, 'test.sqlite') },
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
  assert.equal(listed.tools.length, 12);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    assert.ok(!result.isError, JSON.stringify(result));
    return result.structuredContent as any;
  };
  const status = await call('jobs_sources_status');
  assert.equal(status.providers.length, 9);
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
  assert.equal((await call('jobs_web_search_plan', { keywords: ['SQL'] })).resources.length, 6);
  console.log(
    'MCP check passed: stdio initialization, 12 tools, dry-run, board registration, web plan, ATS preview/import/dedup/update. No external provider calls.',
  );
} finally {
  await client.close();
  if (child.exitCode === null) {
    child.kill('SIGTERM');
    await once(child, 'exit');
  }
  rmSync(dir, { recursive: true, force: true });
}
