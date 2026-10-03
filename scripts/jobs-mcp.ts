import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { searchSchema } from '../shared/source-tools.js';
import { boardSchema } from '../server/source-tools.js';
import { discoveryReviewSchema, discoveryHistorySchema } from '../shared/discovery-review.js';
import { importSchema } from '../server/store.js';
import { stages } from '../shared/model.js';

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
    description: 'Read local search profiles and companies for profileId/companyId selection.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => {
    const result = await call('/state');
    if (result.isError) return result;
    const { profiles, companies } = result.structuredContent;
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ profiles, companies }) }],
      structuredContent: { profiles, companies },
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
await server.connect(new StdioServerTransport());
