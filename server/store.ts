import { catalogSchema, radarIdFor } from '@personal-radar/connectors/catalog-sync';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  canonicalUrl,
  companySchema,
  jobSchema,
  profileSchema,
  sourceSchema,
  type Company,
  type Job,
  type Profile,
  type Source,
  type JobInput,
  type SourceInput,
} from '../shared/model.js';
import { z } from 'zod';
import {
  discoveryReviewSchema,
  discoveryHistorySchema,
  type DiscoveryReview,
} from '../shared/discovery-review.js';
import type { SourceRun } from '../shared/source-tools.js';

const importedJob = jobSchema.safeExtend({
  sourceId: z.string().max(100).optional(),
  createdAt: z.iso.datetime().optional(),
  updatedAt: z.iso.datetime().optional(),
  lastSeenAt: z.union([z.literal(''), z.iso.datetime()]).optional(),
  history: z
    .array(
      z.object({
        stage: z.enum(['new', 'saved', 'applied', 'interview', 'offer', 'archived']),
        at: z.iso.datetime(),
      }),
    )
    .max(10000)
    .optional(),
});
const importedSource = sourceSchema.safeExtend({ id: z.string().max(100).optional() });
export const importSchema = z
  .object({
    companies: z
      .array(companySchema.extend({ id: z.string().optional() }))
      .max(5000)
      .default([]),
    jobs: z.array(importedJob).max(5000).default([]),
    profiles: z
      .array(profileSchema.extend({ id: z.string().optional() }))
      .max(100)
      .default([]),
    sources: z.array(importedSource).max(100).default([]),
  })
  .refine(
    (x) => x.companies.length + x.jobs.length + x.profiles.length + x.sources.length > 0,
    'Файл не содержит записей',
  );
const stamp = () => new Date().toISOString();
const nameKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');

export class Store {
  db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS companies (id TEXT PRIMARY KEY, name_key TEXT UNIQUE NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, url TEXT NOT NULL, origin TEXT NOT NULL, fingerprint TEXT NOT NULL, data TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS jobs_url ON jobs(url) WHERE url <> '';
      CREATE UNIQUE INDEX IF NOT EXISTS jobs_origin ON jobs(origin) WHERE origin <> '';
      CREATE INDEX IF NOT EXISTS jobs_fingerprint ON jobs(fingerprint);
      CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sources (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS provider_requests (provider TEXT NOT NULL, at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS provider_requests_time ON provider_requests(provider,at);
      CREATE TABLE IF NOT EXISTS provider_cache (key TEXT PRIMARY KEY, body TEXT NOT NULL, at TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS discovery_reviews (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS source_runs (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS job_observations (source_id TEXT NOT NULL, external_id TEXT NOT NULL, job_id TEXT NOT NULL, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, missing_count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(source_id,external_id));
      `);
    this.db.exec(catalogSchema());
    const requestColumns = this.db.prepare('PRAGMA table_info(provider_requests)').all();
    for (const [name, definition] of [
      ['scope', "TEXT NOT NULL DEFAULT ''"],
      ['outcome', "TEXT NOT NULL DEFAULT 'unknown'"],
      ['external_id', "TEXT NOT NULL DEFAULT ''"],
    ]) {
      if (!requestColumns.some((column) => column.name === name))
        this.db.exec(`ALTER TABLE provider_requests ADD COLUMN ${name} ${definition}`);
    }
    this.db.exec('PRAGMA user_version=3');
    if (!this.list<Profile>('profiles').length) this.saveProfile({ name: 'Мой поиск' });
    // Only on first database creation; a removed source is not resurrected.
    this.db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)');
    if (!this.db.prepare("SELECT 1 FROM settings WHERE key='initialized'").get()) {
      this.saveSource({ provider: 'remotive', name: 'Remotive · удалённая работа' });
      this.db.prepare("INSERT INTO settings VALUES ('initialized','1')").run();
    }
  }
  list<T>(table: 'jobs' | 'companies' | 'profiles' | 'sources'): T[] {
    return this.db
      .prepare(`SELECT data FROM ${table} ORDER BY rowid DESC`)
      .all()
      .map((row) => this.decode<T>(table, row.data as string));
  }
  decode<T>(table: string, json: string): T {
    const data = JSON.parse(json);
    if (table === 'companies' || table === 'sources') {
      const radarId = radarIdFor(this.db, table, String(data.id));
      if (radarId) data.radarId = radarId;
    }
    return (
      table === 'companies'
        ? { ...data, ...companySchema.parse(data) }
        : table === 'sources'
          ? { ...data, ...sourceSchema.parse(data) }
          : table === 'jobs'
            ? { ...data, ...jobSchema.parse(data) }
            : data
    ) as T;
  }
  get<T>(table: 'jobs' | 'companies' | 'profiles' | 'sources', id: string): T | undefined {
    const row = this.db.prepare(`SELECT data FROM ${table} WHERE id=?`).get(id);
    return row ? this.decode<T>(table, row.data as string) : undefined;
  }
  put<T extends { id: string }>(table: 'profiles' | 'sources', data: T) {
    this.db
      .prepare(
        `INSERT INTO ${table} (id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`,
      )
      .run(data.id, JSON.stringify(data));
  }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }
  saveCompany(input: unknown, id?: string): Company {
    const data = companySchema.parse(input);
    const old = id ? this.get<Company>('companies', id) : undefined;
    if (id && !old) throw new Error('Компания не найдена');
    const row = this.db
      .prepare('SELECT id FROM companies WHERE name_key=?')
      .get(nameKey(data.name));
    if (row && row.id !== id) {
      if (!id) return this.get<Company>('companies', row.id as string)!;
      throw new Error('Компания с таким названием уже есть');
    }
    const company = {
      ...data,
      id: id || randomUUID(),
      createdAt: old?.createdAt || stamp(),
      updatedAt: stamp(),
    };
    this.db
      .prepare(
        'INSERT INTO companies VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET name_key=excluded.name_key,data=excluded.data',
      )
      .run(company.id, nameKey(data.name), JSON.stringify(company));
    if (old && old.name !== company.name)
      for (const job of this.list<Job>('jobs').filter((j) => j.companyId === id))
        this.writeJob({ ...job, company: company.name });
    return company;
  }
  findDuplicate(data: JobInput, sourceId = ''): Job | undefined {
    const url = canonicalUrl(data.url);
    const origin = sourceId && data.externalId ? `${sourceId}:${data.externalId}` : '';
    const fingerprint = [data.company, data.title, data.location].map(nameKey).join('|');
    const row = this.db
      .prepare(
        "SELECT data FROM jobs WHERE (url=? AND url<>'') OR (origin=? AND origin<>'') OR (?='' AND url='' AND fingerprint=?) LIMIT 1",
      )
      .get(url, origin, url, fingerprint);
    return row
      ? this.decode<Job>('jobs', row.data as string)
      : url
        ? this.list<Job>('jobs').find((j) => j.url && canonicalUrl(j.url) === url)
        : undefined;
  }
  writeJob(job: Job) {
    this.db
      .prepare(
        'INSERT INTO jobs VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET url=excluded.url,origin=excluded.origin,fingerprint=excluded.fingerprint,data=excluded.data',
      )
      .run(
        job.id,
        canonicalUrl(job.url),
        job.sourceId && job.externalId ? `${job.sourceId}:${job.externalId}` : '',
        [job.company, job.title, job.location].map(nameKey).join('|'),
        JSON.stringify(job),
      );
  }
  addJob(input: unknown, sourceId = '', sync = false) {
    const data = jobSchema.parse(input);
    const old = this.findDuplicate(data, sourceId);
    if (old) {
      if (
        sync &&
        (old.sourceId === sourceId || (!old.sourceId && old.source === 'import' && sourceId))
      ) {
        // Source updates never erase the user's workflow, notes, favorites or follow-up date.
        this.writeJob({
          ...old,
          ...data,
          company: this.get<Company>('companies', old.companyId)?.name || data.company,
          // SmartRecruiters list payloads omit the detail fetched by jobs_enrich.
          description:
            data.source === 'smartrecruiters' && !data.description
              ? old.description
              : data.description,
          id: old.id,
          companyId: old.companyId,
          sourceId,
          stage: old.stage,
          notes: old.notes,
          aiScore: old.aiScore,
          aiSummary: old.aiSummary,
          aiReason: old.aiReason,
          aiProfileId: old.aiProfileId,
          aiReviewedAt: old.aiReviewedAt,
          aiEvidenceUrls: old.aiEvidenceUrls,
          favorite: old.favorite,
          followUp: old.followUp,
          history: old.history,
          createdAt: old.createdAt,
          updatedAt: stamp(),
          lastSeenAt: stamp(),
        });
      }
      return { job: this.get<Job>('jobs', old.id)!, created: false };
    }
    const company = this.saveCompany({ name: data.company, demo: data.demo });
    const now = stamp();
    const job: Job = {
      ...data,
      id: randomUUID(),
      companyId: company.id,
      sourceId,
      createdAt: now,
      updatedAt: now,
      lastSeenAt: sourceId ? now : '',
      history: [{ stage: data.stage, at: now }],
    };
    this.writeJob(job);
    return { job, created: true };
  }
  updateJob(id: string, input: unknown) {
    const old = this.get<Job>('jobs', id);
    if (!old) throw new Error('Вакансия не найдена');
    const data = jobSchema.parse({ ...old, ...(input as object) });
    const company = this.saveCompany({ name: data.company, demo: data.demo });
    const job = {
      ...old,
      ...data,
      companyId: company.id,
      updatedAt: stamp(),
      history:
        data.stage === old.stage
          ? old.history
          : [...old.history, { stage: data.stage, at: stamp() }],
    };
    this.writeJob(job);
    return job;
  }
  saveProfile(input: unknown, id?: string) {
    if (id && !this.get('profiles', id)) throw new Error('Профиль не найден');
    const profile = { ...profileSchema.parse(input), id: id || randomUUID() };
    this.put('profiles', profile);
    return profile;
  }
  saveSource(input: unknown, id?: string) {
    const data = sourceSchema.parse(input);
    const old = id ? this.get<Source>('sources', id) : undefined;
    if (id && !old) throw new Error('Источник не найден');
    const key = (s: SourceInput) =>
      [s.provider, s.board, s.region, s.query, s.country, s.location || ''].join('|');
    if (this.list<Source>('sources').some((s) => s.id !== id && key(s) === key(data)))
      throw new Error('Такой источник уже подключён');
    if (data.companyId && !this.get('companies', data.companyId))
      throw new Error('Компания не найдена');
    if (data.profileId && !this.get('profiles', data.profileId))
      throw new Error('Профиль не найден');
    if (old && key(old) !== key(data))
      throw new Error('Для другой доски или запроса добавьте новый источник');
    const source: Source = {
      ...data,
      id: id || randomUUID(),
      lastSync: old?.lastSync || '',
      lastAttempt: old?.lastAttempt || '',
      error: old?.error || '',
      count: old?.count || 0,
    };
    this.put('sources', source);
    return source;
  }
  importData(input: unknown, preview = false) {
    const data = importSchema.parse(input);
    const seen = new Set<string>();
    const jobs = data.jobs.map((job) => {
      const key = job.url
        ? canonicalUrl(job.url)
        : [job.company, job.title, job.location].map(nameKey).join('|');
      const duplicate = !!this.findDuplicate(job) || seen.has(key);
      seen.add(key);
      return { ...job, duplicate };
    });
    if (preview)
      return {
        jobs,
        companies: data.companies,
        profiles: data.profiles.length,
        sources: data.sources.length,
        duplicates: jobs.filter((j) => j.duplicate).length,
      };
    return this.transaction(() => {
      let added = 0;
      let skipped = 0;
      let companies = 0;
      const companyMap = new Map<string, string>();
      const profileMap = new Map<string, string>();
      for (const company of data.companies) {
        const before = this.list<Company>('companies').length;
        const saved = this.saveCompany(company);
        if (company.id) companyMap.set(company.id, saved.id);
        if (this.list<Company>('companies').length > before) companies++;
      }
      for (const profile of data.profiles) {
        const saved =
          this.list<Profile>('profiles').find((p) => p.name === profile.name) ||
          this.saveProfile(profile);
        if (profile.id) profileMap.set(profile.id, saved.id);
      }
      const sourceMap = new Map<string, string>();
      for (const source of data.sources) {
        const existing = this.list<Source>('sources').find(
          (s) =>
            s.provider === source.provider &&
            s.board === source.board &&
            s.region === source.region &&
            s.query === source.query &&
            s.country === source.country &&
            s.location === source.location,
        );
        const saved =
          existing ||
          this.saveSource({
            ...source,
            companyId:
              companyMap.get(source.companyId) ||
              (this.get('companies', source.companyId) ? source.companyId : ''),
            profileId:
              profileMap.get(source.profileId) ||
              (this.get('profiles', source.profileId) ? source.profileId : ''),
          });
        if (source.id) sourceMap.set(source.id, saved.id);
      }
      for (const job of data.jobs) {
        const sourceId = job.sourceId
          ? sourceMap.get(job.sourceId) || (this.get('sources', job.sourceId) ? job.sourceId : '')
          : '';
        const result = this.addJob(job, sourceId);
        if (result.created) {
          added++;
          this.writeJob({
            ...result.job,
            createdAt: job.createdAt || result.job.createdAt,
            updatedAt: job.updatedAt || result.job.updatedAt,
            lastSeenAt: job.lastSeenAt || result.job.lastSeenAt,
            history: job.history?.length ? job.history : result.job.history,
          });
        } else skipped++;
      }
      return { added, skipped, companies };
    });
  }
  saveDiscoveryReview(input: unknown) {
    const data = discoveryReviewSchema.parse(input);
    const row = this.db.prepare('SELECT data FROM discovery_reviews WHERE id=?').get(data.id);
    const old = row ? (JSON.parse(row.data as string) as DiscoveryReview) : undefined;
    const now = stamp();
    const review: DiscoveryReview = { ...data, createdAt: old?.createdAt || now, updatedAt: now };
    this.db
      .prepare(
        'INSERT INTO discovery_reviews (id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
      )
      .run(data.id, JSON.stringify(review));
    return review;
  }
  discoveryHistory(input: unknown = {}) {
    const args = discoveryHistorySchema.parse(input);
    return this.db
      .prepare(
        "SELECT data FROM discovery_reviews WHERE (? IS NULL OR json_extract(data, '$.profileId')=?) ORDER BY json_extract(data, '$.updatedAt') DESC, rowid DESC LIMIT ?",
      )
      .all(args.profileId ?? null, args.profileId ?? null, args.limit)
      .map((row) => JSON.parse(row.data as string) as DiscoveryReview);
  }
  recordRun(run: Omit<SourceRun, 'id' | 'at'>) {
    const saved: SourceRun = { ...run, id: randomUUID(), at: stamp() };
    this.db.prepare('INSERT INTO source_runs VALUES (?,?)').run(saved.id, JSON.stringify(saved));
    this.db.exec(
      'DELETE FROM source_runs WHERE rowid NOT IN (SELECT rowid FROM source_runs ORDER BY rowid DESC LIMIT 500)',
    );
    return saved;
  }
  runs(): SourceRun[] {
    return this.db
      .prepare('SELECT data FROM source_runs ORDER BY rowid DESC LIMIT 100')
      .all()
      .map((r) => JSON.parse(String(r.data)));
  }
  // Must be called within the caller's transaction. Full snapshots only for company boards.
  ingestJobs(jobs: JobInput[], sourceId: string, snapshot?: JobInput[], observedAt = stamp()) {
    let added = 0;
    const ids: string[] = [];
    const seen = observedAt || stamp();
    for (const job of jobs) {
      const previous = this.findDuplicate(job, sourceId);
      const result = this.addJob(job, sourceId, true);
      if (result.created) added++;
      ids.push(result.job.id);
      if (result.job.sourceId === sourceId)
        this.writeJob({
          ...result.job,
          lastSeenAt: previous && previous.lastSeenAt > seen ? previous.lastSeenAt : seen,
        });
      const externalId = job.externalId || canonicalUrl(job.url);
      if (externalId)
        this.db
          .prepare(
            `INSERT INTO job_observations(source_id,external_id,job_id,first_seen,last_seen,missing_count)
        VALUES (?,?,?,?,?,0) ON CONFLICT(source_id,external_id) DO UPDATE SET job_id=excluded.job_id,missing_count=CASE WHEN excluded.last_seen>job_observations.last_seen THEN 0 ELSE job_observations.missing_count END,last_seen=MAX(job_observations.last_seen,excluded.last_seen)`,
          )
          .run(sourceId, externalId, result.job.id, seen, seen);
    }
    if (snapshot) {
      const available = new Set(snapshot.map((j) => j.externalId || canonicalUrl(j.url)));
      for (const row of this.db
        .prepare('SELECT external_id FROM job_observations WHERE source_id=?')
        .all(sourceId)) {
        if (available.has(String(row.external_id)))
          this.db
            .prepare(
              'UPDATE job_observations SET missing_count=0,last_seen=? WHERE source_id=? AND external_id=?',
            )
            .run(seen, sourceId, row.external_id);
        else
          this.db
            .prepare(
              'UPDATE job_observations SET missing_count=missing_count+1 WHERE source_id=? AND external_id=?',
            )
            .run(sourceId, row.external_id);
      }
    }
    return { added, existing: jobs.length - added, ids };
  }
  observations(jobId?: string) {
    return this.db
      .prepare(
        `SELECT source_id AS sourceId,external_id AS externalId,job_id AS jobId,first_seen AS firstSeenAt,last_seen AS lastSeenAt,missing_count AS missingCount FROM job_observations${jobId ? ' WHERE job_id=?' : ''}`,
      )
      .all(...(jobId ? [jobId] : []));
  }
  state() {
    return {
      jobs: this.list<Job>('jobs'),
      companies: this.list<Company>('companies'),
      profiles: this.list<Profile>('profiles'),
      sources: this.list<Source>('sources'),
      adzunaConfigured: !!(process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY),
    };
  }
  delete(table: 'jobs' | 'profiles' | 'sources', id: string) {
    this.db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id);
    if (table === 'jobs') this.db.prepare('DELETE FROM job_observations WHERE job_id=?').run(id);
    if (table === 'profiles')
      for (const source of this.list<Source>('sources'))
        if (source.profileId === id)
          this.put('sources', { ...source, profileId: '', monitoring: false });
  }
  clearDemo() {
    this.transaction(() => {
      for (const job of this.list<Job>('jobs')) if (job.demo) this.delete('jobs', job.id);
      for (const company of this.list<Company>('companies'))
        if (company.demo && !this.list<Job>('jobs').some((j) => j.companyId === company.id))
          this.db.prepare('DELETE FROM companies WHERE id=?').run(company.id);
    });
  }
}
