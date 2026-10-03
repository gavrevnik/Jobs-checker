import { z } from 'zod';
import {
  sourceSchema,
  type Source,
  type Profile,
  type Job,
  type Company,
  type JobInput,
} from '../shared/model.js';
import {
  acceptsJob,
  boardProviders,
  providerCatalog,
  providerIds,
  resolveFilters,
  searchSchema,
  webSearchPlan,
  type ProviderId,
  type ProviderView,
} from '../shared/source-tools.js';
import { fetchJobs, normalize } from './providers.js';
import { meteredFetcher, providerEnabled, quota, safeProviderError } from './provider-io.js';
import type { Store } from './store.js';

export const boardSchema = z.object({
  provider: z.enum(['greenhouse', 'lever', 'ashby', 'smartrecruiters']),
  board: z.string().trim().min(1).max(500),
  name: z.string().trim().min(1).max(200),
  companyId: z.string().max(100).default(''),
  profileId: z.string().max(100).default(''),
  region: z.enum(['global', 'eu']).default('global'),
  monitoring: z.boolean().default(true),
  intervalHours: z.number().int().min(6).max(168).default(12),
});
export class SourceTools {
  busy = false;
  constructor(
    private store: Store,
    private fetcher: typeof fetch = fetch,
  ) {}
  status() {
    const sources = this.store.list<Source>('sources');
    const runs = this.store.runs();
    const providers: ProviderView[] = providerCatalog.map((p) => {
      const enabled = providerEnabled(this.store, p.id);
      const missing = p.credentials.filter((key) => !process.env[key]);
      if (p.id === 'jooble' && !process.env.JOOBLE_COUNTRY) missing.push('JOOBLE_COUNTRY');
      const run = runs.find((r) => r.provider === p.id);
      return {
        ...p,
        enabled,
        missing,
        status: !enabled
          ? 'disabled'
          : missing.length
            ? 'not_configured'
            : run?.error
              ? 'error'
              : run
                ? 'connected'
                : 'ready',
        connections: sources.filter((s) => s.provider === p.id && s.enabled).length,
        lastRun: run?.at || '',
        error: run?.error || '',
        quota: quota(this.store, p.id),
      };
    });
    return { providers, sources, runs, observations: this.store.observations(), busy: this.busy };
  }
  configure(provider: string, input: unknown) {
    z.enum(providerIds).parse(provider);
    const { enabled } = z.object({ enabled: z.boolean() }).parse(input);
    this.store.db
      .prepare(
        'INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      )
      .run(`provider:${provider}`, String(enabled));
    return this.status();
  }
  addBoard(input: unknown) {
    const data = boardSchema.parse(input);
    if (/^https?:/i.test(data.board)) {
      const url = new URL(data.board);
      const hosts = {
        greenhouse: [
          'boards.greenhouse.io',
          'job-boards.greenhouse.io',
          'job-boards.eu.greenhouse.io',
        ],
        lever: ['jobs.lever.co', 'jobs.eu.lever.co'],
        ashby: ['jobs.ashbyhq.com'],
        smartrecruiters: ['jobs.smartrecruiters.com', 'careers.smartrecruiters.com'],
      };
      if (!hosts[data.provider].includes(url.hostname))
        throw new Error('Ссылка не соответствует выбранной платформе');
      data.board = url.pathname.split('/').filter(Boolean)[0] || '';
      if (url.hostname === 'jobs.eu.lever.co') data.region = 'eu';
    }
    return this.store.transaction(() => {
      const company = data.companyId
        ? this.store.get<Company>('companies', data.companyId)
        : this.store.saveCompany({ name: data.name });
      if (!company) throw new Error('Компания не найдена');
      return this.store.saveSource({ ...data, name: company.name, companyId: company.id });
    });
  }
  private profile(id?: string) {
    const profile = id ? this.store.get<Profile>('profiles', id) : undefined;
    if (id && !profile) throw new Error('Профиль не найден');
    return profile;
  }
  webPlan(input: unknown) {
    const args = searchSchema.parse(input);
    return { resources: webSearchPlan(args, this.profile(args.profileId)) };
  }
  async search(input: unknown) {
    const args = searchSchema.parse(input);
    const profile = this.profile(args.profileId);
    const filters = resolveFilters(args, profile);
    const all = this.store.list<Source>('sources');
    for (const id of args.sourceIds)
      if (!all.some((s) => s.id === id)) throw new Error('Источник не найден');
    const targets: Source[] = [];
    for (const provider of new Set(args.providers)) {
      if (boardProviders.includes(provider))
        targets.push(
          ...all.filter(
            (s) =>
              s.provider === provider &&
              s.enabled &&
              (!args.sourceIds.length || args.sourceIds.includes(s.id)),
          ),
        );
      else {
        // Separate provider queries keep keyword synonyms portable across APIs.
        const queries = ['arbeitnow', 'remotive'].includes(provider)
          ? ['']
          : [
              ...new Set(
                filters.keywords.flatMap((k) =>
                  k
                    .split('|')
                    .map((s) => s.trim())
                    .filter(Boolean),
                ),
              ),
            ];
        for (const query of queries.length ? queries : [''])
          targets.push({
            ...sourceSchema.parse({
              provider,
              name: provider,
              query,
              country: args.country,
              location: args.location,
            }),
            id: `discovery:${provider}`,
            lastSync: '',
            lastAttempt: '',
            error: '',
            count: 0,
          });
      }
    }
    const statuses = this.status().providers;
    const plan = {
      execute: args.execute,
      store: args.store,
      maxRequests: args.maxRequests,
      maxPages: args.maxPages,
      filters,
      targets: targets.map((s) => ({
        sourceId: s.id,
        provider: s.provider,
        name: s.name,
        board: s.board,
        query: s.query,
      })),
      unavailable: args.providers
        .filter((p) => !targets.some((s) => s.provider === p))
        .map((p) => ({ provider: p, reason: 'Добавьте и включите доску компании' })),
      providers: statuses.filter((p) => args.providers.includes(p.id)),
      web: webSearchPlan(args, profile),
    };
    if (!args.execute) return { ...plan, jobs: [], results: [], requests: 0 };
    if (this.busy) throw new Error('Поиск уже выполняется');
    this.busy = true;
    const budget = { used: 0, limit: args.maxRequests, cacheHits: 0, observedAt: '' };
    const jobs: (JobInput & { atsId?: string })[] = [];
    const results: {
      provider: string;
      sourceId: string;
      received: number;
      matched: number;
      added: number;
      cached: boolean;
      error: string;
    }[] = [];
    const seen = new Set<string>();
    try {
      for (const source of targets) {
        const before = budget.used,
          cachedBefore = budget.cacheHits;
        budget.observedAt = '';
        let received = 0,
          matched = 0,
          added = 0,
          error = '';
        try {
          const status = statuses.find((p) => p.id === source.provider)!;
          if (!status.enabled) throw new Error('Адаптер выключен');
          if (status.missing.length)
            throw new Error(`Нужно настроить: ${status.missing.join(', ')}`);
          if (source.provider === 'adzuna' && !args.country)
            throw new Error('Укажите country для Adzuna');
          const raw = await fetchJobs(
            source,
            meteredFetcher(this.store, source.provider, budget, this.fetcher),
            { maxPages: args.maxPages, location: args.location },
          );
          received = raw.length;
          const selected = raw
            .filter((j) => !args.externalIds.length || args.externalIds.includes(j.externalId))
            .filter((j) => acceptsJob(j, args, profile))
            .filter((j) => {
              const key = `${source.id}:${j.externalId || j.url}`;
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            })
            .slice(0, Math.max(0, args.maxItems - jobs.length));
          matched = selected.length;
          if (args.store) {
            const saved = this.store.transaction(() =>
              this.store.ingestJobs(selected, source.id, undefined, budget.observedAt),
            );
            added = saved.added;
            jobs.push(...selected.map((j, index) => ({ ...j, atsId: saved.ids[index] })));
          } else jobs.push(...selected);
        } catch (e) {
          error = safeProviderError(e);
        }
        const cached = budget.cacheHits > cachedBefore;
        const result = {
          provider: source.provider,
          sourceId: source.id,
          received,
          matched,
          added,
          cached,
          error,
        };
        results.push(result);
        this.store.recordRun({
          ...result,
          kind: args.store ? 'search+store' : 'search',
          query: source.query || filters.keywords.join(', '),
          requests: budget.used - before,
        });
        if (jobs.length >= args.maxItems) break;
      }
      return { ...plan, jobs, results, requests: budget.used };
    } finally {
      this.busy = false;
    }
  }
  async monitor(input: unknown) {
    const args = z
      .object({
        sourceIds: z.array(z.string()).max(50).default([]),
        execute: z.boolean().default(false),
        maxRequests: z.number().int().min(1).max(100).default(30),
      })
      .parse(input);
    const sources = this.store
      .list<Source>('sources')
      .filter(
        (s) =>
          s.enabled &&
          s.monitoring &&
          boardProviders.includes(s.provider) &&
          providerEnabled(this.store, s.provider) &&
          (!args.sourceIds.length || args.sourceIds.includes(s.id)),
      );
    for (const id of args.sourceIds)
      if (!sources.some((s) => s.id === id))
        throw new Error('Доска не найдена или мониторинг выключен');
    const due = sources.filter(
      (s) =>
        (!s.lastSync || Date.now() - Date.parse(s.lastSync) >= s.intervalHours * 3600000) &&
        (!s.lastAttempt || Date.now() - Date.parse(s.lastAttempt) >= 60000),
    );
    if (!args.execute) return { execute: false, due, maxRequests: args.maxRequests };
    if (this.busy) throw new Error('Поиск уже выполняется');
    this.busy = true;
    const budget = { used: 0, limit: args.maxRequests, cacheHits: 0, observedAt: '' };
    const results = [];
    try {
      for (const source of due) {
        const before = budget.used,
          cachedBefore = budget.cacheHits;
        budget.observedAt = '';
        let received = 0,
          matched = 0,
          added = 0,
          error = '';
        this.store.put('sources', { ...source, lastAttempt: new Date().toISOString() });
        try {
          const profile = this.profile(source.profileId);
          const raw = await fetchJobs(
            source,
            meteredFetcher(this.store, source.provider, budget, this.fetcher),
          );
          const selected = raw.filter((j) => acceptsJob(j, searchSchema.parse({}), profile));
          received = raw.length;
          matched = selected.length;
          this.store.transaction(() => {
            // A cached response is not new evidence of presence or absence.
            added = this.store.ingestJobs(
              selected,
              source.id,
              budget.cacheHits === cachedBefore ? raw : undefined,
              budget.observedAt,
            ).added;
            this.store.put('sources', {
              ...source,
              lastAttempt: new Date().toISOString(),
              lastSync: new Date().toISOString(),
              count: raw.length,
              error: '',
            });
          });
        } catch (e) {
          error = safeProviderError(e);
          this.store.put('sources', { ...source, lastAttempt: new Date().toISOString(), error });
        }
        results.push(
          this.store.recordRun({
            provider: source.provider,
            sourceId: source.id,
            kind: 'monitor',
            query: '',
            received,
            matched,
            added,
            requests: budget.used - before,
            cached: budget.cacheHits > cachedBefore,
            error,
          }),
        );
      }
      return { execute: true, results, requests: budget.used };
    } finally {
      this.busy = false;
    }
  }
  async enrich(input: unknown) {
    const args = z
      .object({ jobId: z.string().min(1), execute: z.boolean().default(false) })
      .parse(input);
    const job = this.store.get<Job>('jobs', args.jobId);
    if (!job) throw new Error('Вакансия не найдена');
    const source = this.store.get<Source>('sources', job.sourceId);
    if (!source || source.provider !== 'smartrecruiters')
      throw new Error(
        'Детализация нужна только для карточки SmartRecruiters; остальные доски уже возвращают описания',
      );
    if (!args.execute) return { execute: false, jobId: job.id, maxRequests: 1 };
    const budget = { used: 0, limit: 1, cacheHits: 0, observedAt: '' };
    try {
      const response = await meteredFetcher(
        this.store,
        source.provider,
        budget,
        this.fetcher,
      )(
        `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(source.board)}/postings/${encodeURIComponent(job.externalId)}`,
        {
          redirect: 'error',
          signal: AbortSignal.timeout(25000),
          headers: { Accept: 'application/json' },
        },
      );
      if (!response.ok) throw new Error(`Источник вернул HTTP ${response.status}`);
      const data = await response.json();
      if (String(data.id) !== job.externalId) throw new Error('ID ответа не совпадает с вакансией');
      const normalized = normalize('smartrecruiters', data, source);
      return this.store.transaction(() => this.store.addJob(normalized, source.id, true));
    } catch (e) {
      throw new Error(safeProviderError(e));
    }
  }
  ats(input: unknown) {
    const args = z
      .object({
        query: z.string().max(200).default(''),
        stage: z.string().optional(),
        limit: z.number().int().min(1).max(200).default(50),
      })
      .parse(input);
    return {
      jobs: this.store
        .list<Job>('jobs')
        .filter(
          (j) =>
            (!args.stage || j.stage === args.stage) &&
            `${j.title} ${j.company} ${j.location}`
              .toLowerCase()
              .includes(args.query.toLowerCase()),
        )
        .slice(0, args.limit),
      observations: this.store.observations(),
    };
  }
}
