import { z } from 'zod';
import { keywordTerms, type JobInput, type Profile } from './model.js';

export const providerIds = [
  'greenhouse',
  'lever',
  'ashby',
  'smartrecruiters',
  'arbeitnow',
  'remotive',
  'adzuna',
  'serpapi',
  'jooble',
] as const;
export type ProviderId = (typeof providerIds)[number];
export const boardProviders: readonly string[] = [
  'greenhouse',
  'lever',
  'ashby',
  'smartrecruiters',
];
export const providerCatalog: {
  id: ProviderId;
  name: string;
  group: 'discovery' | 'boards';
  description: string;
  docs: string;
  credentials: string[];
  cost: string;
  ttlHours: number;
}[] = [
  {
    id: 'adzuna',
    name: 'Adzuna',
    group: 'discovery',
    description: 'Поиск по ключевым словам и рынку',
    docs: 'https://developer.adzuna.com/overview',
    credentials: ['ADZUNA_APP_ID', 'ADZUNA_APP_KEY'],
    cost: '2 500 запросов / месяц · personal research',
    ttlHours: 1,
  },
  {
    id: 'serpapi',
    name: 'Google Jobs · SerpAPI',
    group: 'discovery',
    description: 'Мета-поиск по площадкам и карьерным сайтам',
    docs: 'https://serpapi.com/google-jobs-api',
    credentials: ['SERPAPI_API_KEY'],
    cost: '250 запросов / месяц · бесплатный план',
    ttlHours: 1,
  },
  {
    id: 'jooble',
    name: 'Jooble',
    group: 'discovery',
    description: 'Дополнительный поиск · ключ для выбранного рынка',
    docs: 'https://jooble.org/api/about',
    credentials: ['JOOBLE_API_KEY'],
    cost: 'Доступ и квота зависят от выданного ключа',
    ttlHours: 1,
  },
  {
    id: 'arbeitnow',
    name: 'Arbeitnow',
    group: 'discovery',
    description: 'Tech-вакансии · преимущественно Германия',
    docs: 'https://www.arbeitnow.com/blog/job-board-api',
    credentials: [],
    cost: 'Бесплатно · без ключа',
    ttlHours: 1,
  },
  {
    id: 'remotive',
    name: 'Remotive',
    group: 'discovery',
    description: 'Удалённая работа · публикации с задержкой 24 ч',
    docs: 'https://github.com/remotive-com/remote-jobs-api',
    credentials: [],
    cost: 'Бесплатно · не чаще 4 раз в сутки',
    ttlHours: 6,
  },
  {
    id: 'greenhouse',
    name: 'Greenhouse',
    group: 'boards',
    description: 'Вакансии, описания и отделы компании',
    docs: 'https://docs.greenhouse.io/job-board.html',
    credentials: [],
    cost: 'Публичный API · без ключа',
    ttlHours: 0.25,
  },
  {
    id: 'lever',
    name: 'Lever',
    group: 'boards',
    description: 'Доски Global / EU · описание и зарплата',
    docs: 'https://github.com/lever/postings-api',
    credentials: [],
    cost: 'Публичный API · без ключа',
    ttlHours: 0.25,
  },
  {
    id: 'ashby',
    name: 'Ashby',
    group: 'boards',
    description: 'Открытые позиции · локации и компенсация',
    docs: 'https://developers.ashbyhq.com/docs/public-job-posting-api',
    credentials: [],
    cost: 'Публичный API · без ключа',
    ttlHours: 0.25,
  },
  {
    id: 'smartrecruiters',
    name: 'SmartRecruiters',
    group: 'boards',
    description: 'Публикации компании и подробности вакансий',
    docs: 'https://developers.smartrecruiters.com/docs/endpoints',
    credentials: [],
    cost: 'Публичный API · без ключа',
    ttlHours: 0.25,
  },
];
export const webSources = [
  {
    id: 'linkedin',
    name: 'LinkedIn',
    domain: 'linkedin.com/jobs/view',
    description: 'Широкий поиск и проверка компании',
  },
  {
    id: 'indeed',
    name: 'Indeed',
    domain: 'indeed.com/viewjob',
    description: 'Дополнительный охват локальных рынков',
  },
  {
    id: 'welcome',
    name: 'Welcome to the Jungle',
    domain: 'welcometothejungle.com',
    description: 'Продуктовые команды и культура компании',
  },
  {
    id: 'wellfound',
    name: 'Wellfound',
    domain: 'wellfound.com/jobs',
    description: 'Стартапы и растущие команды',
  },
  {
    id: 'eures',
    name: 'EURES',
    domain: 'eures.europa.eu',
    description: 'Европейская сеть вакансий',
  },
  {
    id: 'careers',
    name: 'Карьерные страницы',
    domain: '',
    description: 'Первоисточники · найти доску для мониторинга',
  },
];
const terms = z.array(z.string().trim().min(1).max(200)).max(30);
export const searchSchema = z.object({
  providers: z.array(z.enum(providerIds)).min(1).max(9).default(['arbeitnow', 'remotive']),
  sourceIds: z.array(z.string().min(1).max(100)).max(50).default([]),
  externalIds: z.array(z.string().min(1).max(2000)).max(500).default([]),
  profileId: z.string().max(100).optional(),
  keywords: terms.optional(),
  exclude: terms.optional(),
  locations: terms.optional(),
  workMode: z.enum(['any', 'remote', 'hybrid', 'onsite']).optional(),
  seniority: z
    .enum(['any', 'intern', 'junior', 'middle', 'middle_plus', 'senior', 'lead'])
    .optional(),
  minSalary: z.number().min(0).max(1e9).nullable().optional(),
  currency: z.string().length(3).optional(),
  salaryPeriod: z.enum(['year', 'month', 'hour']).optional(),
  country: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z]{2}$|^$/)
    .default(''),
  location: z.string().trim().max(200).default(''),
  maxAgeDays: z.number().int().min(1).max(365).optional(),
  includeUnknownDate: z.boolean().default(true),
  maxPages: z.number().int().min(1).max(10).default(1),
  maxRequests: z.number().int().min(1).max(100).default(10),
  maxItems: z.number().int().min(1).max(500).default(100),
  execute: z.boolean().default(false),
  store: z.boolean().default(false),
});
export type SearchInput = z.infer<typeof searchSchema>;
export function resolveFilters(input: SearchInput, profile?: Profile) {
  return {
    keywords: input.keywords ?? profile?.keywords ?? [],
    exclude: input.exclude ?? profile?.exclude ?? [],
    locations: input.locations ?? profile?.locations ?? [],
    workMode: input.workMode ?? profile?.workMode ?? 'any',
    seniority: input.seniority ?? profile?.seniority ?? 'any',
    minSalary: input.minSalary === undefined ? (profile?.minSalary ?? null) : input.minSalary,
    currency: input.currency ?? profile?.currency ?? 'EUR',
    salaryPeriod: input.salaryPeriod ?? profile?.salaryPeriod ?? 'year',
  };
}
export function acceptsJob(job: JobInput, input: SearchInput, profile?: Profile) {
  const f = resolveFilters(input, profile);
  const haystack = [job.title, job.company, job.description, ...job.tags].join(' ').toLowerCase();
  // Keyword groups are discovery alternatives; | separates synonyms within a group.
  if (
    f.keywords.length &&
    !f.keywords.some((k) => keywordTerms(k).some((t) => haystack.includes(t.toLowerCase())))
  )
    return false;
  if (f.exclude.some((k) => keywordTerms(k).some((t) => haystack.includes(t.toLowerCase()))))
    return false;
  if (
    f.locations.length &&
    !f.locations.some((l) => job.location.toLowerCase().includes(l.toLowerCase()))
  )
    return false;
  if (f.workMode !== 'any' && job.workMode !== f.workMode) return false;
  if (
    f.seniority !== 'any' &&
    (f.seniority === 'middle_plus'
      ? !['middle', 'senior', 'lead'].includes(job.seniority)
      : job.seniority !== f.seniority)
  )
    return false;
  if (
    f.minSalary !== null &&
    (job.salaryMin === null ||
      job.currency.toUpperCase() !== f.currency.toUpperCase() ||
      job.salaryPeriod !== f.salaryPeriod ||
      job.salaryMin < f.minSalary)
  )
    return false;
  if (input.maxAgeDays) {
    if (!job.publishedAt) return input.includeUnknownDate;
    if (Date.parse(job.publishedAt) < Date.now() - input.maxAgeDays * 86400000) return false;
  }
  return true;
}
export function webSearchPlan(input: SearchInput, profile?: Profile) {
  const f = resolveFilters(input, profile);
  const words = f.keywords
    .flatMap(keywordTerms)
    .map((s) => `"${s.replaceAll('"', '')}"`)
    .join(' OR ');
  const geo = [input.location, ...f.locations].filter(Boolean).join(' OR ');
  return webSources.map((source) => {
    const scope = source.domain
      ? `site:${source.domain}`
      : '(site:jobs.ashbyhq.com OR site:jobs.lever.co OR site:job-boards.greenhouse.io OR site:jobs.smartrecruiters.com)';
    const query = [
      scope,
      words ? `(${words})` : 'jobs',
      geo ? `(${geo})` : '',
      f.workMode === 'remote' ? 'remote' : '',
      ...f.exclude.map((s) => `-"${s.replaceAll('"', '')}"`),
    ]
      .filter(Boolean)
      .join(' ');
    return {
      ...source,
      query,
      url: `https://www.google.com/search?${new URLSearchParams({ q: query, ...(input.maxAgeDays ? { tbs: `qdr:d${input.maxAgeDays}` } : {}) })}`,
    };
  });
}
export type ProviderView = (typeof providerCatalog)[number] & {
  enabled: boolean;
  status: 'disabled' | 'not_configured' | 'ready' | 'connected' | 'error';
  credentials: string[];
  missing: string[];
  connections: number;
  lastRun: string;
  error: string;
  quota: { used: number; limit: number | null; remaining: number | null };
};
export type SourceRun = {
  id: string;
  provider: string;
  sourceId: string;
  at: string;
  kind: string;
  query: string;
  received: number;
  matched: number;
  added: number;
  requests: number;
  cached: boolean;
  error: string;
};
