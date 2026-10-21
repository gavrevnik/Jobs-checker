import { config } from 'dotenv';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { Store } from '../server/store.js';
import { fetchJobs } from '../server/providers.js';
import {
  meteredFetcher,
  providerEnabled,
  quota,
  safeProviderError,
} from '../server/provider-io.js';
import {
  companySchema,
  sourceSchema,
  canonicalUrl,
  type Company,
  type Job,
  type Source,
} from '../shared/model.js';
import { targetLevel } from '../shared/target-vacancies.js';
import { companyJobMaterials } from '../shared/company-job-materials.js';
import { providerDescriptions, type CollectionSource } from '../shared/company-provenance.js';

export const employerKey = (name: string) =>
  name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\b(?:incorporated|inc|llc|ltd|gmbh|limited)\b/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
export const analyticsMaterial = (title: string) =>
  /analyst|analytics|data\s+(?:engineer|scientist)|аналитик/i.test(title);

async function main() {
  config();
  const args = process.argv.slice(2),
    execute = args.includes('--execute'),
    localOnly = args.includes('--local-only');
  if (execute && localOnly) throw new Error('--local-only несовместим с --execute');
  const option = (name: string, fallback: string) =>
    args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
  const maxRequests = Number(option('--max-requests', '100'));
  if (!Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 100)
    throw new Error('max-requests: 1–100');
  const dbPath = resolve(process.env.SCOUT_DB || '../data/jobs-checker/scout.sqlite');
  const output = resolve(
    option('--output', '.runtime/company-discovery/2026-10-16-materials.json'),
  );
  let store: Store;
  if (execute) {
    const radar = resolve('../personal-radar');
    const python = existsSync(resolve(radar, '.venv/bin/python'))
      ? resolve(radar, '.venv/bin/python')
      : 'python3';
    const backup = spawnSync(
      python,
      [
        '-c',
        'import sys; from catalog_sync.core import backup_database; print(backup_database(sys.argv[1],sys.argv[2]))',
        dbPath,
        resolve(dirname(dbPath), 'backups/company-discovery-refresh'),
      ],
      { cwd: radar, encoding: 'utf8', timeout: 60000 },
    );
    if (backup.status !== 0)
      throw new Error('Не удалось создать проверенный локальный backup; live run отменён.');
    console.log('Verified local backup:', backup.stdout.trim());
    store = new Store(dbPath);
  } else {
    store = Object.create(Store.prototype) as Store;
    store.db = new DatabaseSync(dbPath, { readOnly: true });
  }
  try {
    const companies = store.list<Company>('companies').filter((c) => !c.demo);
    const originalIds = companies.map((c) => c.id).sort();
    const retryFile = option('--retry-from', '');
    const retryRuns = retryFile
      ? (JSON.parse(readFileSync(resolve(retryFile), 'utf8')).runs as Array<{
          companyId: string;
          provider: string;
          error: string;
        }>)
      : null;
    const needsRetry = (companyId: string, provider: string) =>
      !retryRuns ||
      retryRuns.some((r) => r.companyId === companyId && r.provider === provider && r.error);
    const sources = store
      .list<Source>('sources')
      .filter(
        (s) =>
          s.enabled &&
          s.companyId &&
          originalIds.includes(s.companyId) &&
          ['greenhouse', 'lever', 'ashby', 'smartrecruiters'].includes(s.provider),
      );
    if (!execute && !localOnly) {
      console.log(
        JSON.stringify({
          execute: false,
          companies: companies.length,
          boards: sources.length,
          adzunaCompanies: companies.length,
          maxRequests,
          output,
        }),
      );
      return;
    }
    const fresh = {
      startedAt: new Date().toISOString(),
      finishedAt: '',
      maxRequests,
      requests: 0,
      companies: companies.map((company) => ({
        company,
        materials: [] as unknown[],
        collection_sources: [] as CollectionSource[],
      })),
      runs: [] as unknown[],
    };
    const result = args.includes('--resume')
      ? (JSON.parse(readFileSync(output, 'utf8')) as typeof fresh)
      : fresh;
    if (result.maxRequests !== maxRequests) throw new Error('Resume budget mismatch');
    const attempted = (companyId: string, provider: string) =>
      result.runs.some(
        (r) =>
          (r as { companyId: string; provider: string }).companyId === companyId &&
          (r as { provider: string }).provider === provider,
      );
    const save = () => {
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
    };
    const savedJobs = store.list<Job>('jobs');
    const presence = store.observations().map((o) => ({
      sourceId: String(o.sourceId),
      jobId: String(o.jobId),
      lastSeenAt: String(o.lastSeenAt),
      missingCount: Number(o.missingCount),
    }));
    for (const dest of result.companies) {
      // Refresh the local inventory on resume without duplicating saved cards.
      dest.materials = [
        ...companyJobMaterials(dest.company.id, savedJobs, presence),
        ...dest.materials.filter((m) => (m as { origin?: string }).origin !== 'saved_ats'),
      ];
    }
    if (localOnly) {
      result.finishedAt = new Date().toISOString();
      save();
      console.log(JSON.stringify({ localOnly: true, companies: companies.length, output }));
      return;
    }
    save(); // Preserve history even when every external source is empty or unavailable.
    const budget = { used: result.requests, limit: maxRequests, cacheHits: 0, observedAt: '' };
    const byId = new Map(result.companies.map((c) => [c.company.id, c]));
    const perform = async (source: Source, company: Company, adzuna = false) => {
      const dest = byId.get(company.id)!;
      const before = budget.used,
        cachedBefore = budget.cacheHits;
      budget.observedAt = '';
      budget.limit = Math.min(maxRequests, before + (adzuna ? 1 : 3));
      const at = new Date().toISOString();
      let received = 0,
        matched = 0,
        added = 0,
        error = '';
      const query = adzuna
        ? `what_phrase=${company.name}; title_only=analyst; country=es; max_days_old=365`
        : source.board;
      let outcome: CollectionSource['outcome'] = 'empty';
      try {
        if (!providerEnabled(store, source.provider)) throw new Error('Адаптер выключен');
        if (adzuna) {
          const minute = quota(store, 'adzuna').windows.find((w) => w.label === 'минута');
          if (minute && minute.remaining === 0 && minute.nextResetAt) {
            const delay = Math.max(0, Date.parse(minute.nextResetAt) - Date.now() + 300);
            console.log(`Adzuna minute quota: waiting ${Math.ceil(delay / 1000)}s`);
            await new Promise((r) => setTimeout(r, Math.min(delay, 60000)));
          }
        }
        const raw = await fetchJobs(
          source,
          meteredFetcher(store, source.provider, budget, (input, init) =>
            fetch(input, { ...init, signal: AbortSignal.timeout(25000) }),
          ),
          {
            maxPages: 1,
            ...(adzuna
              ? { adzuna: { what_phrase: company.name, title_only: 'analyst', max_days_old: 365 } }
              : {}),
          },
        );
        received = raw.length;
        const same = raw.filter((j) => employerKey(j.company) === employerKey(company.name));
        const material = same.filter((j) => analyticsMaterial(j.title));
        dest.materials.push(
          ...material.map((j) => ({
            job: j,
            provider: source.provider,
            sourceId: source.id,
            observedAt: budget.observedAt || at,
          })),
        );
        matched = material.length;
        const existing = store.list<Job>('jobs').filter((j) => j.companyId === company.id);
        const selected = material
          .filter(
            (j) =>
              targetLevel(j) ||
              existing.some((old) => canonicalUrl(old.url) === canonicalUrl(j.url)),
          )
          .filter(
            (j) =>
              !store.findDuplicate(j, source.id) ||
              store.findDuplicate(j, source.id)!.companyId === company.id,
          )
          .map((j) => ({ ...j, company: company.name }));
        const saved = store.transaction(() =>
          store.ingestJobs(selected, source.id, undefined, budget.observedAt || at),
        );
        added = saved.added;
        if (!adzuna)
          store.put('sources', {
            ...source,
            lastAttempt: at,
            lastSync: budget.observedAt || at,
            count: raw.length,
            error: '',
          });
        outcome = raw.length ? (budget.cacheHits > cachedBefore ? 'cached' : 'success') : 'empty';
      } catch (e) {
        error = safeProviderError(e);
        outcome = 'error';
      }
      const entry: CollectionSource = {
        name: `${source.provider} API`,
        kind: 'api',
        description:
          providerDescriptions[source.provider] +
          (adzuna
            ? ' Поиск по работодателю в Испании, одна страница; не полный архив найма.'
            : ' Автоматическая проверка существующей доски; без включения фонового мониторинга.'),
        observed_at: budget.observedAt || at,
        query,
        outcome,
        columns: ['company', 'business', 'target_vacancies', 'analytics_culture', 'infrastructure'],
      };
      dest.collection_sources.push(entry);
      const run = {
        provider: source.provider,
        sourceId: source.id,
        kind: 'company-discovery-collect',
        query,
        received,
        matched,
        added,
        requests: budget.used - before,
        cached: budget.cacheHits > cachedBefore,
        error,
      };
      store.recordRun(run);
      result.runs.push({ ...run, companyId: company.id });
      result.requests = budget.used;
      save();
      console.log(JSON.stringify({ company: company.name, ...run }));
    };
    for (const source of sources) {
      if (budget.used >= maxRequests) break;
      if (!needsRetry(source.companyId, source.provider)) continue;
      if (attempted(source.companyId, source.provider)) continue;
      await perform(source, byId.get(source.companyId)!.company);
    }
    if (process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY)
      for (const company of companies) {
        if (budget.used >= maxRequests) break;
        if (!needsRetry(company.id, 'adzuna')) continue;
        if (attempted(company.id, 'adzuna')) continue;
        await perform(
          {
            ...sourceSchema.parse({ provider: 'adzuna', name: company.name, country: 'es' }),
            id: 'discovery:adzuna',
            lastSync: '',
            lastAttempt: '',
            error: '',
            count: 0,
          },
          company,
          true,
        );
      }
    if (args.includes('--include-feeds'))
      for (const provider of ['arbeitnow', 'remotive', 'jobicy'] as const)
        for (const company of companies) {
          if (budget.used >= maxRequests) break;
          if (attempted(company.id, provider)) continue;
          await perform(
            {
              ...sourceSchema.parse({ provider, name: `${provider} · общий поиск`, country: '' }),
              id: `discovery:${provider}`,
              lastSync: '',
              lastAttempt: '',
              error: '',
              count: 0,
            },
            company,
          );
        }
    const finalIds = store
      .list<Company>('companies')
      .filter((c) => !c.demo)
      .map((c) => c.id)
      .sort();
    if (JSON.stringify(originalIds) !== JSON.stringify(finalIds))
      throw new Error('Company identities changed unexpectedly');
    result.finishedAt = new Date().toISOString();
    save();
    console.log(
      JSON.stringify({
        finished: true,
        companies: companies.length,
        requests: budget.used,
        output,
      }),
    );
  } finally {
    store.db.close();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch((e) => {
    console.error(safeProviderError(e));
    process.exitCode = 1;
  });
