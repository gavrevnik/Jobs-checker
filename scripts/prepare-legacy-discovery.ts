import { writeFileSync } from 'node:fs';
import { config } from 'dotenv';
import { legacyCompanyResearch } from '../shared/legacy-company-research.js';
import type { State } from '../shared/model.js';

const output = process.argv[2];
if (!output)
  throw new Error('Usage: node --import tsx scripts/prepare-legacy-discovery.ts <new-output.json>');
config({ path: new URL('../.env', import.meta.url), quiet: true });
const base = new URL(process.env.SCOUT_API_URL || `http://127.0.0.1:${process.env.PORT || 4317}`);
if (
  base.protocol !== 'http:' ||
  !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) ||
  base.username ||
  base.password ||
  base.pathname !== '/' ||
  base.search ||
  base.hash
)
  throw new Error('SCOUT_API_URL должен указывать на локальный Jobs Checker');
const stateUrl = new URL('/api/state', base).href;
// Read-only loopback; importing remains the normal preview/confirmation API workflow.
const response = await fetch(stateUrl, {
  redirect: 'error',
  signal: AbortSignal.timeout(15000),
});
if (!response.ok) throw new Error(`Jobs Checker HTTP ${response.status}`);
const state = (await response.json()) as State;
const document = legacyCompanyResearch(
  state.companies,
  state.jobs,
  new Date().toISOString(),
  stateUrl,
);
writeFileSync(output, JSON.stringify(document, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(
  `Prepared ${document.companies.length} existing companies for discovery preview: ${output}`,
);
