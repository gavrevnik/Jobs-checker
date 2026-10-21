import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { searchSchema } from '../shared/source-tools.js';
import { boardSchema } from '../server/source-tools.js';
import { discoveryReviewSchema, discoveryHistorySchema } from '../shared/discovery-review.js';
import { importSchema } from '../server/store.js';
import { researchImportSchema, observationSchema } from '../shared/company-research.js';
import { stages } from '../shared/model.js';
import { cultureAssessmentSchema } from '../shared/company-culture-fit.js';
import { fitAssessmentSchema } from '../shared/company-fit.js';
import { selectionInputSchema } from '../shared/selection-profile.js';
import { paidOperationSchema } from '../shared/research-paid.js';

const root = fileURLToPath(new URL('../', import.meta.url));
config({ path: `${root}.env`, quiet: true });
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
  throw new Error('SCOUT_API_URL должен указывать на локальный jobs-checker');
const server = new McpServer(
  { name: 'jobs-checker', version: '0.2.0' },
  {
    instructions:
      'Use jobs_sources_status and jobs_discovery_history first. Search and monitoring default to execute=false (no provider calls). Set execute=true only for an intended live run; maxRequests is a hard network request budget. store=true writes matching vacancies to the local ATS and preserves user workflow. Remote does not imply worldwide eligibility. Web-plan returns queries, not verified vacancies. Import only verified real job URLs; do not invent dates, salary or location. Never submit applications.',
  },
);
async function call(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
  try {
    const response = await fetch(new URL(`/api${path}`, base), {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'error',
      signal: AbortSignal.timeout(300000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Ошибка jobs-checker');
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      structuredContent: result,
    };
  } catch (error) {
    const message =
      error instanceof Error && !/fetch|https?:|ECONN/i.test(error.message)
        ? error.message.slice(0, 1000)
        : 'Нет соединения с jobs-checker. Запустите сервис (npm start) и проверьте SCOUT_API_URL.';
    return { isError: true, content: [{ type: 'text' as const, text: message }] };
  }
}
server.registerTool(
  'jobs_sources_status',
  {
    description:
      'List adapters, missing credential names, local request quotas, company boards and recent runs. No external API calls.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  () => call('/source-tools'),
);
server.registerTool(
  'jobs_discovery_history',
  {
    description:
      'Read previous search strategies, exact queries, yield and recommendations before new discovery. No external calls.',
    inputSchema: discoveryHistorySchema.shape,
    annotations: { readOnlyHint: true },
  },
  (args) => call('/source-tools/discovery-history', args),
);
server.registerTool(
  'jobs_discovery_save',
  {
    description:
      'Save a discovery review with strategy, per-query results, next searches and imported ATS IDs. Reuse the same id to update a review without duplicates. No external calls.',
    inputSchema: discoveryReviewSchema.shape,
  },
  (args) => call('/source-tools/discovery-review', args),
);
server.registerTool(
  'jobs_profiles',
  {
    description:
      'Read the single professional core, availability scenarios, effective profile and companies. Use scenarioId for search/monitoring/research; all means no geographic constraint. Legacy profiles are retained for history.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => {
    const result = await call('/state');
    if (result.isError) return result;
    const { profiles, companies, selection, effectiveProfile } = result.structuredContent;
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ profiles, companies, selection, effectiveProfile }),
        },
      ],
      structuredContent: { profiles, companies, selection, effectiveProfile },
    };
  },
);
server.registerTool(
  'jobs_search',
  {
    description:
      'Plan or execute provider search with profile filters. execute=false by default. store=true upserts results to ATS. Budget includes all pages and queries; keywords are OR alternatives. Use adzuna for native salary, age, keyword, company, geographic and contract filters (see schema); explicit native keyword fields produce one Adzuna query, local/profile filters still apply. Country is explicit for Adzuna/Jooble; locations are strict text filters.',
    inputSchema: searchSchema.shape,
  },
  (args) => call('/source-tools/search', args),
);
server.registerTool(
  'jobs_add_company_board',
  {
    description:
      'Register a public ATS board for a company; no external request. Monitoring is run explicitly via jobs_monitor_companies.',
    inputSchema: boardSchema.shape,
  },
  (args) => call('/source-tools/boards', args),
);
server.registerTool(
  'jobs_monitor_companies',
  {
    description:
      'Plan or run due company boards, with full snapshots, saved profile filters and safe missing detection. execute=false by default. No scheduler is installed.',
    inputSchema: {
      sourceIds: z.array(z.string()).max(50).default([]),
      scenarioId: z.string().max(100).optional(),
      execute: z.boolean().default(false),
      maxRequests: z.number().int().min(1).max(100).default(30),
    },
  },
  (args) => call('/source-tools/monitor', args),
);
server.registerTool(
  'jobs_enrich',
  {
    description:
      'Retrieve SmartRecruiters job details into an existing ATS card; 1 request maximum. execute=false by default.',
    inputSchema: { jobId: z.string().min(1), execute: z.boolean().default(false) },
  },
  (args) => call('/source-tools/enrich', args),
);
server.registerTool(
  'jobs_web_search_plan',
  {
    description:
      'Build LinkedIn, Indeed, EURES, startup and ATS web-search queries from profile/keywords. Does not run web search.',
    inputSchema: searchSchema.shape,
    annotations: { readOnlyHint: true },
  },
  (args) => call('/source-tools/web-plan', args),
);
server.registerTool(
  'jobs_ats_list',
  {
    description: 'Read ATS vacancies and observation history.',
    inputSchema: {
      query: z.string().max(200).default(''),
      stage: z.enum(stages).optional(),
      limit: z.number().int().min(1).max(200).default(50),
    },
    annotations: { readOnlyHint: true },
  },
  (args) => call('/source-tools/ats', args),
);
server.registerTool(
  'jobs_ats_import',
  {
    description:
      'Validate/import researched vacancies from web tools or other MCPs. Preview by default; set store=true to persist. All records are validated before writing.',
    inputSchema: { data: importSchema, store: z.boolean().default(false) },
  },
  (args) => call(args.store ? '/import' : '/import/preview', args.data),
);
server.registerTool(
  'jobs_ats_update',
  {
    description:
      'Update a local vacancy workflow, notes or evidence-based AI assessment (0–10). Provide aiReason, aiSummary, aiProfileId, aiReviewedAt and source URLs with a score. Scores are human/LLM judgments, not automatic keyword matches. Never sends an application.',
    inputSchema: {
      jobId: z.string().min(1),
      stage: z.enum(stages).optional(),
      notes: z.string().max(30000).optional(),
      favorite: z.boolean().optional(),
      followUp: z.union([z.literal(''), z.iso.date()]).optional(),
      aiScore: z.number().min(0).max(10).nullable().optional(),
      aiSummary: z.string().max(600).optional(),
      aiReason: z.string().max(10000).optional(),
      aiProfileId: z.string().max(100).optional(),
      aiReviewedAt: z.iso.datetime().optional(),
      aiEvidenceUrls: z
        .array(z.url().refine((url) => /^https?:/.test(url)))
        .max(20)
        .optional(),
    },
  },
  ({ jobId, ...patch }) => call(`/jobs/${encodeURIComponent(jobId)}`, patch, 'PATCH'),
);
const researchContext = {
  country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional(),
  profileId: z.string().max(100).optional(),
  scenarioId: z.string().max(100).optional(),
};
const query = (args: { country?: string; profileId?: string; scenarioId?: string }) => {
  const params = new URLSearchParams();
  if (args.country) params.set('country', args.country);
  if (args.profileId) params.set('profileId', args.profileId);
  if (args.scenarioId) params.set('scenarioId', args.scenarioId);
  return params.size ? `?${params}` : '';
};
server.registerTool(
  'jobs_company_research_criteria',
  {
    description:
      'Read versioned company discovery criteria, types and deterministic scoring rules. No provider calls.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  () => call('/company-research/criteria'),
);
server.registerTool(
  'jobs_company_research_list',
  {
    description:
      'Compare existing company IDs, scoped observations, deterministic section scores/coverage and fresh suitable ATS jobs. Unknown is not fail. No provider calls.',
    inputSchema: researchContext,
    annotations: { readOnlyHint: true },
  },
  (args) => call('/company-research' + query(args)),
);
server.registerTool(
  'jobs_company_research_recalculate',
  {
    description:
      'Recalculate and persist company section scores/coverage from existing reviewed evidence at the end of an authorized discovery or monitoring run. Refreshes evidence age without changing facts, verification, job aiScore or dataDrivenScore. No provider calls. Omit companyIds only for a requested full refresh.',
    inputSchema: { companyIds: z.array(z.string().min(1)).min(1).max(5000).optional() },
  },
  (args) => call('/company-research/recalculate', args),
);
server.registerTool(
  'jobs_company_research_profile',
  {
    description:
      'Read detailed company evidence, proposed vs verified facts, scope, red flags and research history.',
    inputSchema: { companyId: z.string().min(1), ...researchContext },
    annotations: { readOnlyHint: true },
  },
  ({ companyId, ...args }) =>
    call(`/company-research/${encodeURIComponent(companyId)}` + query(args)),
);
server.registerTool(
  'jobs_company_research_preview',
  {
    description:
      'Strictly validate research JSON 1.0 and return identity matches, conflicts, skips, new facts and an expiring previewId. No import/provider calls.',
    inputSchema: { data: researchImportSchema },
    annotations: { readOnlyHint: true },
  },
  (args) => call('/company-research/preview', args.data),
);
server.registerTool(
  'jobs_company_research_import',
  {
    description:
      'Apply a concrete preview atomically only after the user confirms it. Does not verify LLM facts, alter ATS/CRM or run providers. Repeat is idempotent.',
    inputSchema: { previewId: z.string().uuid(), confirmed: z.literal(true) },
  },
  (args) => call('/company-research/import', args),
);
server.registerTool(
  'jobs_company_research_observe',
  {
    description:
      'Append a manual observation for an existing company; old facts remain. Evidence requires a separate review.',
    inputSchema: { companyId: z.string().min(1), observation: observationSchema },
  },
  (args) =>
    call(`/company-research/${encodeURIComponent(args.companyId)}/observations`, args.observation),
);
server.registerTool(
  'jobs_company_research_review',
  {
    description:
      'Record evidence review after inspecting the linked source content and scope. Reject conflicting observations explicitly; preserve history. Never verify a source solely from an LLM verdict.',
    inputSchema: {
      observationId: z.string().min(1),
      verified: z.boolean(),
      rejected: z.boolean().default(false),
      note: z.string().max(4000).default(''),
    },
  },
  ({ observationId, ...decision }) =>
    call(`/company-research/observations/${encodeURIComponent(observationId)}`, decision, 'PATCH'),
);
server.registerTool(
  'jobs_company_research_priority',
  {
    description:
      'Set user research category independently of CRM status, and preserve personal discovery notes.',
    inputSchema: {
      companyId: z.string().min(1),
      priority: z.enum(['Target', 'Secondary', 'Practice', 'Unassigned']),
      notes: z.string().max(30000),
      practiceGoal: z.string().max(300).optional(),
      practiceReflection: z.string().max(2000).optional(),
      practiceHours: z.number().min(0).max(100).nullable().optional(),
    },
  },
  ({ companyId, ...args }) =>
    call(`/company-research/${encodeURIComponent(companyId)}/preferences`, args, 'PATCH'),
);
server.registerTool(
  'jobs_company_research_plan',
  {
    description:
      'Read coverage/gaps, saved jobMaterials (including closed/stale descriptions with original dates and role scope), prioritised public-source queries, interview follow-ups and paid suggestions. Historical job materials are not current company conditions. Does not call providers. Glassdoor reviews/interviews use jobs_company_paid_* with configured credentials, a hard budget and explicit one-use consent. Other paid Actors remain unavailable.',
    inputSchema: {
      companyId: z.string().min(1),
      scenarioId: z.string().max(100).optional(),
      country: z
        .string()
        .regex(/^[A-Z]{2}$/)
        .optional(),
    },
    annotations: { readOnlyHint: true },
  },
  ({ companyId, ...args }) =>
    call(`/company-research/${encodeURIComponent(companyId)}/plan` + query(args)),
);
server.registerTool(
  'jobs_company_research_history',
  {
    description:
      'Read append-only research imports and provenance. Optional existing company ID filter.',
    inputSchema: { companyId: z.string().max(100).optional() },
    annotations: { readOnlyHint: true },
  },
  (args) =>
    call(
      '/company-research/history' +
        (args.companyId ? '?companyId=' + encodeURIComponent(args.companyId) : ''),
    ),
);
server.registerTool(
  'jobs_company_research_flag_review',
  {
    description:
      'Record a red-flag source review; a verified employee report still remains a report, not a universal company fact.',
    inputSchema: {
      flagId: z.string().min(1),
      verified: z.boolean(),
      note: z.string().max(4000).default(''),
    },
  },
  ({ flagId, ...decision }) =>
    call(`/company-research/flags/${encodeURIComponent(flagId)}`, decision, 'PATCH'),
);

server.registerTool(
  'jobs_selection_update',
  {
    description:
      'Update the professional core and availability scenarios after a user request. expectedVersion prevents overwriting concurrent edits. Previous versions and legacy profiles remain. Changing geography does not change company quality scores.',
    inputSchema: selectionInputSchema.shape,
  },
  (args) => call('/selection', args, 'PATCH'),
);
server.registerTool(
  'jobs_company_assess',
  {
    description:
      'Save a concise business/analytics synthesis and six evidence-backed ratings for an existing company in an authorized research task. Read jobs_profiles and company research first. Use reviewed observation IDs from this company, a compatible scope and current coreVersion as profileVersion. Unknown is null; job requirements alone are capped at 2/4. Never infer maturity from tools or publications. Appends history; does not verify facts or choose a personal queue.',
    inputSchema: { companyId: z.string().min(1), assessment: fitAssessmentSchema },
  },
  ({ companyId, assessment }) =>
    call(`/company-research/${encodeURIComponent(companyId)}/assessment`, assessment),
);
server.registerTool(
  'jobs_company_culture_plan',
  {
    description:
      'Plan independent Culture and Team research: read saved evidence, separate company expertise and specific teams, and identify gaps. No provider calls or writes.',
    inputSchema: { companyId: z.string().min(1) },
    annotations: { readOnlyHint: true },
  },
  ({ companyId }) => call(`/company-research/${encodeURIComponent(companyId)}/culture-plan`),
);
server.registerTool(
  'jobs_company_culture_assess',
  {
    description:
      'Append evidence-backed Culture and Team assessment in authorized research. Use current coreVersion and reviewed non-job observations. Preserve publication dates for historical expertise; rate company and each explicitly scoped team separately. No automatic personal queue changes.',
    inputSchema: { companyId: z.string().min(1), assessment: cultureAssessmentSchema },
  },
  ({ companyId, assessment }) =>
    call(`/company-research/${encodeURIComponent(companyId)}/culture-assessment`, assessment),
);
server.registerTool(
  'jobs_company_assessment_history',
  {
    description: 'Read previous company suitability assessments without changing them.',
    inputSchema: { companyId: z.string().min(1) },
    annotations: { readOnlyHint: true },
  },
  ({ companyId }) => call(`/company-research/${encodeURIComponent(companyId)}/assessments`),
);

server.registerTool(
  'jobs_company_paid_status',
  {
    description:
      'Read configured paid company-research adapters, credential names and per-run limits. No provider calls. Glassdoor reviews/interviews are explicit-request only; never automatic discovery/monitoring fallback.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  () => call('/company-research/paid'),
);
server.registerTool(
  'jobs_company_paid_quote',
  {
    description:
      'Read current public Apify pricing for an exact operation; no Actor run or grant. Glassdoor: actor=memo23/glassdoor-scraper-ppr, operation=reviews|interviews, exactly one companyId, volume 1..200, parameters={companyUrl,startDate?}, maxCostUsd required. Cap covers the run; dataset downloads disabled. Verify employer identity and warn about shared account credits before requesting a run.',
    inputSchema: { operation: paidOperationSchema },
    annotations: { readOnlyHint: true },
  },
  (args) => call('/company-research/paid/quote', args),
);
server.registerTool(
  'jobs_company_paid_authorize',
  {
    description:
      'Create one-use consent ONLY after the user explicitly requests this paid run with the exact company, Actor, operation, URL, volume, date filter and maximum USD cost. Installation/general company research is not consent. Rechecks current pricing; does not run the Actor.',
    inputSchema: { operation: paidOperationSchema, confirmed: z.literal(true) },
  },
  (args) => call('/company-research/paid/authorize', args),
);
server.registerTool(
  'jobs_company_paid_execute',
  {
    description:
      'Start one explicitly authorized paid run using the same exact operation and unused grantId. Apify hard cap, fixed 1GB/120s, no retries or paid extras. Returns ledgerId and run/dataset Console links, never downloads dataset. Timeout/unknown outcome consumes consent: inspect history and Console, never repeat automatically.',
    inputSchema: { operation: paidOperationSchema, grantId: z.string().uuid() },
    annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true },
  },
  (args) => call('/company-research/paid/execute', args),
);
server.registerTool(
  'jobs_company_paid_runs',
  {
    description:
      'Read the last 20 local paid-run records, or one ledgerId. No provider calls. Unknown costs stay null; reported run costs are provisional.',
    inputSchema: { ledgerId: z.string().uuid().optional() },
    annotations: { readOnlyHint: true },
  },
  ({ ledgerId }) => call(`/company-research/paid/runs${ledgerId ? `/${ledgerId}` : ''}`),
);
server.registerTool(
  'jobs_company_paid_refresh',
  {
    description:
      'Explicitly check metadata/cost of a saved Apify run with one GET. Never starts/retries an Actor or downloads a dataset. Updates local ledger; billing snapshots remain provisional. Requires a saved runId.',
    inputSchema: { ledgerId: z.string().uuid() },
  },
  ({ ledgerId }) => call(`/company-research/paid/runs/${ledgerId}/refresh`, {}),
);
server.registerTool(
  'jobs_company_paid_normalize',
  {
    description:
      'Offline processing of user-exported Glassdoor dataset JSON for a saved ledgerId. Pass flat rows (at most the authorized volume). No provider calls, imports or verification. Returns P01/P07_INTERVIEW research materials with provenance, dates, role and rejected rows. Read and review before saving observations via existing research workflow; candidate reports are not official company policy.',
    inputSchema: {
      ledgerId: z.string().uuid(),
      rows: z.array(z.record(z.string(), z.json())).max(200),
    },
    annotations: { readOnlyHint: true },
  },
  ({ ledgerId, rows }) => call(`/company-research/paid/runs/${ledgerId}/normalize`, { rows }),
);

await server.connect(new StdioServerTransport());
