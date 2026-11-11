import { randomUUID } from 'node:crypto';
import { jobLocationMatch } from '../shared/job-fit.js';
import { arbeitnowMarkets } from '@personal-radar/connectors/arbeitnow';
import { checkPosting } from '@personal-radar/connectors/himalayas';
import { fetchPosting } from '@personal-radar/connectors/smartrecruiters';
import { z } from 'zod';
import { adzunaSearchParams, hasAdzunaQuery } from '../shared/adzuna.js';
import {
  canonicalUrl,
  sourceSchema,
  type Source,
  type Profile,
  type Job,
  type Company,
  type JobInput,
} from '../shared/model.js';
import {
  acceptsJob,
  adzunaMarkets,
  defaultDiscoveryQueries,
  hasReviewableTitle,
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
import { SearchReviews, type ReviewCandidate } from './search-reviews.js';

export const boardSchema = z.object({
  provider: z.enum(['greenhouse', 'lever', 'ashby', 'smartrecruiters']),
  board: z.string().trim().min(1).max(500),
  name: z.string().trim().min(1).max(200),
  companyId: z.string().max(100).default(''),
  profileId: z.string().max(100).default(''),
  scenarioId: z.string().max(100).default(''),
  region: z.enum(['global', 'eu']).default('global'),
  monitoring: z.boolean().default(true),
  intervalHours: z.number().int().min(6).max(168).default(12),
});
export class SourceTools {
  busy = false;
  readonly reviews: SearchReviews;
  constructor(
    private store: Store,
    private fetcher: typeof fetch = fetch,
  ) {
    this.reviews = new SearchReviews(store);
  }
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
    return this.store.selection.profile(id || undefined);
  }
  webPlan(input: unknown) {
    const args = searchSchema.parse(input);
    const profile = this.profile(args.scenarioId ?? args.profileId);
    return { context: profile.selection, resources: webSearchPlan(args, profile) };
  }
  async search(input: unknown) {
    const args = searchSchema.parse(input);
    const profile = this.profile(args.scenarioId ?? args.profileId);
    const filters = resolveFilters(args, profile);
    if (args.providers.includes('adzuna') && args.adzuna)
      adzunaSearchParams('', args.location, args.adzuna, args.maxAgeDays);
    const all = this.store.list<Source>('sources');
    for (const id of args.sourceIds)
      if (!all.some((s) => s.id === id)) throw new Error('Источник не найден');
    const markets = [...new Set(args.countries.length ? args.countries : [args.country])];
    if (
      args.country &&
      args.countries.length &&
      (markets.length !== 1 || markets[0] !== args.country)
    )
      throw new Error('Укажите либо country, либо countries');
    const providerTargets: Source[][] = [];
    const skipped: { provider: ProviderId; country: string; reason: string }[] = [];
    for (const provider of new Set(args.providers)) {
      if (boardProviders.includes(provider)) {
        providerTargets.push(
          all.filter(
            (s) =>
              s.provider === provider &&
              s.enabled &&
              (!args.sourceIds.length || args.sourceIds.includes(s.id)),
          ),
        );
        continue;
      }
      const marketTargets: Source[] = [];
      const feed = ['arbeitnow', 'remotive', 'jobicy'].includes(provider);
      const nativeAdzuna = provider === 'adzuna' && hasAdzunaQuery(args.adzuna);
      const keywords =
        args.keywords ??
        (args.reviewRequired ? defaultDiscoveryQueries(profile) : filters.keywords);
      const queries =
        feed || nativeAdzuna
          ? ['']
          : [
              ...new Set(
                keywords.flatMap((keyword) =>
                  keyword
                    .split('|')
                    .map((term) => term.trim())
                    .filter(Boolean),
                ),
              ),
            ];
      for (const [index, requested] of markets.entries()) {
        const country =
          requested || (provider === 'jobtech' ? 'se' : provider === 'arbeitnow' ? 'de' : '');
        const reason =
          provider === 'adzuna' && !adzunaMarkets.some((market) => market === country)
            ? 'Adzuna: укажите поддерживаемый рынок'
            : provider === 'arbeitnow' && !Object.hasOwn(arbeitnowMarkets, country)
              ? 'Arbeitnow: доступны DE, GB и FR'
              : provider === 'jobtech' && country !== 'se'
                ? 'JobTech: доступна только Швеция'
                : provider === 'jooble' &&
                    markets.length > 1 &&
                    country !== process.env.JOOBLE_COUNTRY?.toLowerCase()
                  ? 'Jooble: нет ключа для этого рынка'
                  : ['remotive', 'jobicy'].includes(provider) && index > 0
                    ? 'Одна общая лента на запуск'
                    : '';
        if (reason) {
          skipped.push({ provider, country, reason });
          continue;
        }
        const scope = ['adzuna', 'arbeitnow', 'jobtech', 'himalayas', 'jooble', 'serpapi'].includes(
          provider,
        )
          ? country
          : '';
        for (const [queryIndex, query] of (queries.length ? queries : ['']).entries()) {
          const source = sourceSchema.parse({
            provider,
            name: provider === 'arbeitnow' && country === 'gb' ? 'Arbeitnow UK' : provider,
            query,
            country,
            location: args.location,
          });
          // Visit each market before using a second synonym.
          marketTargets[queryIndex * markets.length + index] = {
            ...source,
            id: `discovery:${provider}${scope && !(provider === 'arbeitnow' && scope === 'de') ? ':' + scope : ''}`,
            lastSync: '',
            lastAttempt: '',
            error: '',
            count: 0,
          };
        }
      }
      providerTargets.push(marketTargets.filter(Boolean));
    }
    const targets: Source[] = [];
    for (let i = 0; i < Math.max(0, ...providerTargets.map((list) => list.length)); i++)
      for (const list of providerTargets) if (list[i]) targets.push(list[i]);
    const statuses = this.status().providers;
    const blockedProviders = new Set(
      statuses.filter((p) => !p.enabled || p.missing.length).map((p) => p.id),
    );
    const represented = new Set<string>();
    let executableTargets = 0;
    let omittedTargets = 0;
    const boundedTargets = targets.filter(({ provider }) => {
      if (blockedProviders.has(provider)) {
        if (represented.has(provider)) return false;
        represented.add(provider);
        return true;
      }
      if (executableTargets < args.maxRequests) {
        executableTargets++;
        return true;
      }
      omittedTargets++;
      return false;
    });
    const plannedPages = boundedTargets.reduce((total, { provider }) => {
      if (blockedProviders.has(provider)) return total;
      if (provider === 'lever' || provider === 'smartrecruiters') return total + args.maxRequests;
      return total + args.maxPages;
    }, 0);
    const plan = {
      context: profile?.selection,
      execute: args.execute,
      store: args.store,
      reviewRequired: args.reviewRequired,
      skipped,
      omittedTargets,
      plannedRequestUpperBound: Math.min(args.maxRequests, plannedPages),
      maxRequests: args.maxRequests,
      maxPages: args.maxPages,
      filters,
      targets: boundedTargets.map((s) => ({
        sourceId: s.id,
        provider: s.provider,
        name: s.name,
        board: s.board,
        query: s.query,
        country: s.country,
        ...(s.provider === 'adzuna'
          ? {
              country: s.country,
              page: args.adzuna?.page ?? 1,
              params: Object.fromEntries(
                adzunaSearchParams(
                  s.query,
                  args.location || s.location,
                  args.adzuna,
                  args.maxAgeDays,
                ),
              ),
            }
          : {}),
      })),
      unavailable: args.providers
        .filter((p) => boardProviders.includes(p) && !targets.some((s) => s.provider === p))
        .map((p) => ({ provider: p, reason: 'Добавьте и включите доску компании' })),
      providers: statuses.filter((p) => args.providers.includes(p.id)),
      web: webSearchPlan(args, profile),
    };
    if (!args.execute) return { ...plan, jobs: [], results: [], requests: 0, reviewBatchId: null };
    if (this.busy) throw new Error('Поиск уже выполняется');
    this.busy = true;
    const budget = { used: 0, limit: args.maxRequests, cacheHits: 0, observedAt: '' };
    const jobs: (JobInput & { atsId?: string; candidateId?: string })[] = [];
    const candidates = new Map<string, ReviewCandidate>();
    const stage = args.store && args.reviewRequired;
    const results: {
      provider: string;
      sourceId: string;
      country: string;
      received: number;
      matched: number;
      added: number;
      cached: boolean;
      error: string;
    }[] = [];
    const seen = new Set<string>();
    try {
      for (const source of boundedTargets) {
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
          const raw = await fetchJobs(
            source,
            meteredFetcher(this.store, source.provider, budget, this.fetcher),
            {
              maxPages: args.maxPages,
              location: args.location,
              adzuna: args.adzuna,
              maxAgeDays: args.maxAgeDays,
            },
          );
          received = raw.length;
          const isBoard = boardProviders.includes(source.provider);
          const requested = (
            ['remotive', 'jobicy'].includes(source.provider) ? markets : [source.country]
          )
            .filter(Boolean)
            .map((market) => market.toUpperCase());
          const selected = raw
            .filter(
              (j) =>
                isBoard ||
                (hasReviewableTitle(j.title) &&
                  (!args.reviewRequired || jobLocationMatch(j, requested) !== 'mismatch')),
            )
            .filter((j) => !args.externalIds.length || args.externalIds.includes(j.externalId))
            .filter((j) => acceptsJob(j, args, profile, args.reviewRequired && !isBoard))
            .filter((j) => {
              const key = `${source.id}:${j.externalId || j.url}`;
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            });
          matched = selected.length;
          const room = Math.max(0, args.maxItems - jobs.length);
          if (stage) {
            for (const job of selected) {
              const key = job.url ? canonicalUrl(job.url) : `${source.id}:${job.externalId}`;
              if (!key || (!job.url && !job.externalId)) continue;
              const origin = {
                sourceId: source.id,
                externalId: job.externalId,
                observedAt: budget.observedAt,
              };
              const existing = candidates.get(key);
              if (existing) {
                existing.origins.push(origin);
              } else if (jobs.length < args.maxItems) {
                const candidateId = randomUUID();
                candidates.set(key, {
                  id: candidateId,
                  job,
                  origins: [origin],
                  requestedMarkets: requested,
                });
                jobs.push({ ...job, candidateId });
              }
            }
          } else if (args.store) {
            const saved = this.store.transaction(() =>
              this.store.ingestJobs(
                selected.slice(0, room),
                source.id,
                undefined,
                budget.observedAt,
              ),
            );
            added = saved.added;
            jobs.push(
              ...selected.slice(0, room).map((j, index) => ({ ...j, atsId: saved.ids[index] })),
            );
          } else jobs.push(...selected.slice(0, room));
        } catch (e) {
          error = safeProviderError(e);
        }
        const cached = budget.cacheHits > cachedBefore;
        const result = {
          provider: source.provider,
          sourceId: source.id,
          country: source.country,
          received,
          matched,
          added,
          cached,
          error,
        };
        results.push(result);
        this.store.recordRun({
          ...result,
          companyId: source.companyId || undefined,
          sourceName: source.name,
          selection: profile?.selection,
          kind: args.store && !stage ? 'search+store' : 'search',
          query: source.query || filters.keywords.join(', '),
          requests: budget.used - before,
        });
        if (jobs.length >= args.maxItems) break;
      }
      const reviewBatchId = candidates.size
        ? this.reviews.stage(args.scenarioId ?? args.profileId, profile, [...candidates.values()])
        : null;
      return { ...plan, jobs, results, requests: budget.used, reviewBatchId };
    } finally {
      this.busy = false;
    }
  }
  async monitor(input: unknown) {
    const args = z
      .object({
        sourceIds: z.array(z.string()).max(50).default([]),
        scenarioId: z.string().max(100).optional(),
        execute: z.boolean().default(false),
        maxRequests: z.number().int().min(1).max(100).default(30),
        reviewRequired: z.boolean().default(true),
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
    if (args.scenarioId) this.profile(args.scenarioId);
    if (!args.execute)
      return {
        execute: false,
        due,
        reviewRequired: args.reviewRequired,
        maxRequests: args.maxRequests,
        contexts: due.map((s) => ({
          sourceId: s.id,
          selection: this.profile(args.scenarioId ?? (s.scenarioId || s.profileId || 'all'))
            ?.selection,
        })),
      };
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
        let selection: Profile['selection'];
        let reviewBatchIds: string[] = [];
        let pendingReview = 0;
        this.store.put('sources', { ...source, lastAttempt: new Date().toISOString() });
        try {
          const scenarioId = args.scenarioId ?? (source.scenarioId || source.profileId || 'all');
          const profile = this.profile(scenarioId);
          selection = profile?.selection;
          const raw = await fetchJobs(
            source,
            meteredFetcher(this.store, source.provider, budget, this.fetcher),
          );
          const selected = raw.filter((j) => acceptsJob(j, searchSchema.parse({}), profile));
          received = raw.length;
          matched = selected.length;
          this.store.transaction(() => {
            // A cached response is not new evidence of presence or absence.
            ({ added, reviewBatchIds, pendingReview } = this.reviews.refreshSource(
              source,
              selected,
              budget.cacheHits === cachedBefore ? raw : undefined,
              budget.observedAt,
              args.reviewRequired,
              scenarioId,
              profile,
            ));
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
        results.push({
          ...this.store.recordRun({
            provider: source.provider,
            sourceId: source.id,
            companyId: source.companyId || undefined,
            sourceName: source.name,
            kind: 'monitor',
            selection,
            query: '',
            received,
            matched,
            added,
            requests: budget.used - before,
            cached: budget.cacheHits > cachedBefore,
            error,
          }),
          reviewBatchIds,
          pendingReview,
        });
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
    if (job.source === 'himalayas') {
      if (!args.execute) return { execute: false, jobId: job.id, maxRequests: 1 };
      const budget = { used: 0, limit: 1, cacheHits: 0, observedAt: '' };
      const state = await checkPosting(
        job.externalId,
        meteredFetcher(this.store, 'himalayas', budget, this.fetcher),
      );
      if (state === 'closed')
        this.store.updateJob(job.id, { sourceClosedAt: new Date().toISOString() });
      else if (
        state === 'open' &&
        job.sourceClosedAt &&
        Date.parse(budget.observedAt) >= Date.parse(job.sourceClosedAt)
      )
        this.store.updateJob(job.id, { sourceClosedAt: '' });
      return { jobId: job.id, state, source: 'himalayas', requests: budget.used };
    }
    const source = this.store.get<Source>('sources', job.sourceId);
    if (!source || source.provider !== 'smartrecruiters')
      throw new Error(
        'Детализация нужна только для карточки SmartRecruiters; остальные доски уже возвращают описания',
      );
    if (!args.execute) return { execute: false, jobId: job.id, maxRequests: 1 };
    const budget = { used: 0, limit: 1, cacheHits: 0, observedAt: '' };
    try {
      const data = await fetchPosting(
        source.board,
        job.externalId,
        meteredFetcher(this.store, source.provider, budget, this.fetcher),
      );
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
