import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  companyFit,
  fitAssessmentSchema,
  validateFitEvidence,
  type FitAssessment,
} from '../shared/company-fit.js';
import type { Store } from './store.js';
import {
  cultureAssessmentSchema,
  validateCultureEvidence,
  type CultureAssessment,
} from '../shared/company-culture-fit.js';
import type { Company, Job, Profile, Source } from '../shared/model.js';
import { companyTargetVacancies } from './company-target-vacancies.js';
import { companyJobMaterials } from '../shared/company-job-materials.js';
import {
  calculateScoreSnapshot,
  saveScoreSnapshot,
  scoreFingerprint,
  type ResearchScoreSnapshot,
} from './company-research-scores.js';
import { companyColumnSources } from '../shared/company-provenance.js';
import { companySourceChecks } from '../shared/company-source-checks.js';
import type { CollectionSource } from '../shared/company-provenance.js';
import {
  registry,
  headquartersProfile,
  researchImportSchema,
  observationSchema,
  scopeKey,
  observationsDisagree,
  stale,
  type ResearchImport,
  type StoredObservation,
  type Observation,
} from '../shared/company-research.js';
import { acceptsJob, searchSchema } from '../shared/source-tools.js';
import { canonicalUrl } from '../shared/model.js';
import { locateJob } from '../src/analytics.js';
const now = () => new Date().toISOString();
// Stable hash ignores object key ordering, including pasted JSON formatting.
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ':' + stableJson(v))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
export const digest = (value: unknown) =>
  createHash('sha256').update(stableJson(value)).digest('hex');
const nameKey = (s: string) => s.toLowerCase().trim().replace(/\s+/g, ' ');
const domain = (s?: string) => (s ? new URL(s).hostname.toLowerCase().replace(/^www\./, '') : '');
export class CompanyResearch {
  constructor(private store: Store) {}
  private company(id: string) {
    const c = this.store.get<Company>('companies', id);
    if (!c) throw new Error('Компания не найдена');
    return c;
  }
  private stateDigest() {
    return digest({
      companies: this.store.list('companies'),
      observations: this.store.db.prepare('SELECT * FROM company_research_observations').all(),
      reviews: this.store.db.prepare('SELECT * FROM company_research_reviews').all(),
      identity: this.store.db.prepare('SELECT * FROM company_research_identity').all(),
      flags: this.store.db.prepare('SELECT * FROM company_research_flags').all(),
    });
  }
  private identity(id: string): { aliases: string[]; domains: string[] } {
    const row = this.store.db
      .prepare('SELECT data FROM company_research_identity WHERE company_id=?')
      .get(id);
    return row ? JSON.parse(row.data as string) : { aliases: [], domains: [] };
  }
  match(identity: ResearchImport['companies'][number]['identity']) {
    const companies = this.store.list<Company>('companies');
    const d = domain(identity.website);
    if (identity.company_id) {
      const c = companies.find((c) => c.id === identity.company_id);
      if (!c) return { kind: 'skip' as const, reason: 'Неизвестный company_id' };
      if (d && c.website && d !== domain(c.website) && !this.identity(c.id).domains.includes(d))
        return { kind: 'skip' as const, reason: 'company_id и домен противоречат друг другу' };
      return { kind: 'existing' as const, companyId: c.id, reason: 'Явный company_id' };
    }
    const domainMatches = d
      ? companies.filter((c) => domain(c.website) === d || this.identity(c.id).domains.includes(d))
      : [];
    if (domainMatches.length === 1)
      return {
        kind: 'existing' as const,
        companyId: domainMatches[0].id,
        reason: 'Уникальный домен',
      };
    if (domainMatches.length > 1) return { kind: 'skip' as const, reason: 'Неоднозначный домен' };
    const names = [identity.name, ...(identity.aliases || [])].map(nameKey);
    const matches = companies.filter(
      (c) =>
        names.includes(nameKey(c.name)) ||
        this.identity(c.id).aliases.some((a) => names.includes(nameKey(a))),
    );
    // A name/alias collision without corroborating domain needs explicit company_id in a revised import.
    if (matches.length)
      return {
        kind: 'skip' as const,
        reason: 'Имя/alias требует проверки: укажите company_id после review',
      };
    if (!d)
      return { kind: 'skip' as const, reason: 'Для новой компании нужен проверяемый website' };
    return { kind: 'new' as const, reason: 'Новый домен и имя' };
  }
  observations(companyId: string): StoredObservation[] {
    const rows = this.store.db
      .prepare('SELECT * FROM company_research_observations WHERE company_id=? ORDER BY rowid DESC')
      .all(companyId);
    return rows.map((row) => {
      const review = this.store.db
        .prepare(
          'SELECT data,at FROM company_research_reviews WHERE observation_id=? ORDER BY rowid DESC LIMIT 1',
        )
        .get(row.id as string);
      const decision = review ? JSON.parse(review.data as string) : {};
      return {
        ...JSON.parse(row.data as string),
        id: row.id,
        companyId,
        runId: row.run_id,
        importedAt: row.at,
        manual: String(row.run_id).startsWith('manual:'),
        verifiedAt: decision.verified ? review!.at : null,
        rejected: !!decision.rejected,
        reviewNote: decision.note || '',
      };
    });
  }
  preview(input: unknown) {
    const data = researchImportSchema.parse(input);
    const hash = digest(data);
    const previous = this.store.db
      .prepare('SELECT id FROM company_research_runs WHERE digest=?')
      .get(hash);
    const entries = data.companies.map((c) => {
      const match = this.match(c.identity);
      const old = match.kind === 'existing' ? this.observations(match.companyId) : [];
      const observations = c.observations.map((o) => {
        const same = old.filter(
          (x) => x.criterion_id === o.criterion_id && scopeKey(x.scope) === scopeKey(o.scope),
        );
        const duplicate = old.some((x) => digest(this.original(x)) === digest(o));
        return {
          criterionId: o.criterion_id,
          scope: o.scope,
          value: o.value,
          action: duplicate
            ? 'skip'
            : o.value === null && same.some((x) => x.value !== null)
              ? 'unknown_preserved'
              : same.some((x) => x.value !== null && o.value !== null && observationsDisagree(x, o))
                ? 'conflict'
                : same.length
                  ? 'update'
                  : 'new',
          proposedVerdict: o.verdict || 'unknown',
          verification: 'unverified',
        };
      });
      return {
        name: c.identity.name,
        ...match,
        observations,
        redFlags: c.red_flags.length,
        jobUrls: c.job_urls.length,
      };
    });
    // Avoid two entries which would silently collapse through Store name deduplication.
    const seen = new Set<string>();
    for (const entry of entries) {
      const key = entry.kind === 'existing' ? entry.companyId! : nameKey(entry.name);
      if (entry.kind !== 'skip' && seen.has(key))
        throw new Error(
          'Одна компания встречается несколько раз; объедините observations в одну запись',
        );
      seen.add(key);
      const incomingDomain = domain(data.companies[entries.indexOf(entry)].identity.website);
      if (entry.kind === 'new' && incomingDomain) {
        const dk = 'domain:' + incomingDomain;
        if (seen.has(dk))
          throw new Error('Новый домен встречается несколько раз; объедините записи');
        seen.add(dk);
      }
    }
    const previewId = randomUUID();
    const summary = {
      newCompanies: entries.filter((e) => e.kind === 'new').length,
      existingCompanies: entries.filter((e) => e.kind === 'existing').length,
      skippedCompanies: entries.filter((e) => e.kind === 'skip').length,
      newFacts: entries
        .filter((e) => e.kind !== 'skip')
        .flatMap((e) => e.observations)
        .filter((o) => o.action === 'new').length,
      updates: entries.flatMap((e) => e.observations).filter((o) => o.action === 'update').length,
      conflicts: entries.flatMap((e) => e.observations).filter((o) => o.action === 'conflict')
        .length,
      skippedFacts: entries.flatMap((e) => e.observations).filter((o) => o.action === 'skip')
        .length,
    };
    this.store.db
      .prepare('INSERT INTO company_research_previews VALUES (?,?,?,?,?)')
      .run(previewId, hash, this.stateDigest(), JSON.stringify(data), Date.now() + 3600000);
    return {
      previewId,
      digest: hash,
      alreadyImported: !!previous,
      entries,
      summary,
      expiresInMinutes: 60,
    };
  }
  private original(o: StoredObservation): Observation {
    const {
      id,
      companyId,
      runId,
      importedAt,
      verifiedAt,
      rejected,
      reviewNote,
      manual,
      ...original
    } = o;
    return original;
  }
  apply(input: unknown) {
    const { previewId, confirmed } = z
      .strictObject({ previewId: z.string().uuid(), confirmed: z.literal(true) })
      .parse(input);
    void confirmed;
    return this.store.transaction(() => {
      const row = this.store.db
        .prepare('SELECT * FROM company_research_previews WHERE id=?')
        .get(previewId);
      if (!row || Number(row.expires_at) < Date.now())
        throw new Error('Preview отсутствует или истёк; выполните preview повторно');
      const previous = this.store.db
        .prepare('SELECT data FROM company_research_runs WHERE digest=?')
        .get(row.digest as string);
      if (previous) return { ...JSON.parse(previous.data as string), alreadyImported: true };
      if (row.state_digest !== this.stateDigest())
        throw new Error('Данные изменились после preview; повторите preview');
      const data = researchImportSchema.parse(JSON.parse(row.data as string));
      const runId = randomUUID(),
        at = now();
      let addedFacts = 0,
        addedFlags = 0;
      const companies: { companyId?: string; name: string; status: string; reason: string }[] = [];
      for (const c of data.companies) {
        const match = this.match(c.identity);
        if (match.kind === 'skip') {
          companies.push({ name: c.identity.name, status: 'skipped', reason: match.reason });
          continue;
        }
        const companyId =
          match.kind === 'existing'
            ? match.companyId
            : this.store.saveCompany({ name: c.identity.name, website: c.identity.website }).id;
        companies.push({
          companyId,
          name: c.identity.name,
          status: match.kind,
          reason: match.reason,
        });
        const old = this.identity(companyId);
        // Imported aliases remain local research identity and never touch canonical Catalog/Knowledge.
        this.store.db
          .prepare(
            'INSERT INTO company_research_identity VALUES (?,?) ON CONFLICT(company_id) DO UPDATE SET data=excluded.data',
          )
          .run(
            companyId,
            JSON.stringify({
              aliases: [...new Set([...old.aliases, ...(c.identity.aliases || [])])],
              domains: [
                ...new Set([
                  ...old.domains,
                  ...(c.identity.website ? [domain(c.identity.website)] : []),
                ]),
              ],
            }),
          );
        for (const observation of c.observations)
          addedFacts += Number(
            this.store.db
              .prepare('INSERT OR IGNORE INTO company_research_observations VALUES (?,?,?,?,?,?)')
              .run(
                randomUUID(),
                companyId,
                runId,
                digest(observation),
                JSON.stringify(observation),
                at,
              ).changes,
          );
        for (const flag of c.red_flags)
          addedFlags += Number(
            this.store.db
              .prepare('INSERT OR IGNORE INTO company_research_flags VALUES (?,?,?,?,?)')
              .run(randomUUID(), companyId, runId, digest(flag), JSON.stringify(flag)).changes,
          );
      }
      const result = {
        runId,
        at,
        generatedAt: data.generated_at,
        mode: data.research_mode,
        companies,
        addedFacts,
        addedFlags,
        document: data,
      };
      this.store.db
        .prepare('INSERT INTO company_research_runs VALUES (?,?,?,?)')
        .run(runId, row.digest as string, JSON.stringify(result), at);
      return { ...result, alreadyImported: false };
    });
  }
  review(id: string, input: unknown) {
    const decision = z
      .strictObject({
        verified: z.boolean(),
        rejected: z.boolean().default(false),
        note: z.string().max(4000).default(''),
      })
      .parse(input);
    const row = this.store.db
      .prepare('SELECT * FROM company_research_observations WHERE id=?')
      .get(id);
    if (!row) throw new Error('Observation не найдена');
    const observation = observationSchema.parse(JSON.parse(row.data as string));
    if (decision.verified && decision.rejected)
      throw new Error('Нельзя подтвердить отклонённую запись');
    if (
      decision.verified &&
      observation.value !== null &&
      !observation.evidence.length &&
      observation.criterion_id !== 'B03'
    )
      throw new Error('Для подтверждения требуется evidence');
    if (
      decision.verified &&
      observation.evidence.some(
        (e) =>
          e.source_type === 'job' &&
          (!observation.scope.job_url ||
            canonicalUrl(e.url) !== canonicalUrl(observation.scope.job_url)),
      )
    )
      throw new Error('Условия вакансии требуют соответствующего scope.job_url');
    if (
      decision.verified &&
      observation.evidence.some(
        (e) =>
          Date.parse(e.observed_at) > Date.now() + 60000 ||
          Date.parse(e.published_at || e.observed_at) > Date.now() + 60000,
      )
    )
      throw new Error('Evidence содержит будущую дату');
    this.store.db
      .prepare('INSERT INTO company_research_reviews VALUES (?,?,?,?)')
      .run(randomUUID(), id, JSON.stringify(decision), now());
    return this.profile(row.company_id as string);
  }
  manual(companyId: string, input: unknown) {
    this.company(companyId);
    const observation = observationSchema.parse(input);
    const id = randomUUID(),
      runId = 'manual:' + randomUUID(),
      at = now();
    this.store.db
      .prepare('INSERT OR IGNORE INTO company_research_observations VALUES (?,?,?,?,?,?)')
      .run(
        id,
        companyId,
        runId,
        digest({ ...observation, manual_at: at }),
        JSON.stringify(observation),
        at,
      );
    return this.profile(companyId);
  }
  preferences(companyId: string, input: unknown) {
    this.company(companyId);
    const value = z
      .strictObject({
        priority: z.enum(['Target', 'Secondary', 'Practice', 'Unassigned']),
        notes: z.string().max(30000),
        practiceGoal: z.string().max(300).optional(),
        practiceReflection: z.string().max(2000).optional(),
        practiceHours: z.number().min(0).max(100).nullable().optional(),
      })
      .parse(input);
    const old = this.store.db
      .prepare('SELECT data FROM company_research_preferences WHERE company_id=?')
      .get(companyId);
    const merged = { ...(old ? JSON.parse(String(old.data)) : {}), ...value };
    this.store.transaction(() => {
      this.store.db
        .prepare('INSERT INTO company_queue_history (company_id,data,at) VALUES (?,?,?)')
        .run(
          companyId,
          JSON.stringify({ before: old ? JSON.parse(String(old.data)) : null, after: merged }),
          now(),
        );
      this.store.db
        .prepare(
          'INSERT INTO company_research_preferences VALUES (?,?) ON CONFLICT(company_id) DO UPDATE SET data=excluded.data',
        )
        .run(companyId, JSON.stringify(merged));
    });
    return this.profile(companyId);
  }
  history(companyId = '') {
    return this.store.db
      .prepare('SELECT data FROM company_research_runs ORDER BY rowid DESC')
      .all()
      .map((r) => JSON.parse(r.data as string))
      .filter(
        (r) =>
          !companyId || r.companies.some((c: { companyId: string }) => c.companyId === companyId),
      );
  }
  assess(companyId: string, input: unknown) {
    this.company(companyId);
    const data = fitAssessmentSchema.parse(input);
    const selection = this.store.selection.read();
    if (data.profileVersion !== selection.coreVersion)
      throw new Error('Профессиональное ядро изменилось. Прочитайте актуальный профиль.');
    validateFitEvidence(data, this.observations(companyId));
    const assessment = {
      ...data,
      weights: selection.core.weights,
      id: randomUUID(),
      createdAt: now(),
    };
    this.store.db
      .prepare('INSERT INTO company_fit_assessments VALUES (?,?,?,?)')
      .run(assessment.id, companyId, JSON.stringify(assessment), assessment.createdAt);
    return this.profile(companyId);
  }
  assessmentHistory(companyId: string) {
    this.company(companyId);
    return this.store.db
      .prepare('SELECT data FROM company_fit_assessments WHERE company_id=? ORDER BY rowid DESC')
      .all(companyId)
      .map((r) => JSON.parse(String(r.data)) as FitAssessment | CultureAssessment);
  }
  assessCulture(companyId: string, input: unknown) {
    this.company(companyId);
    const data = cultureAssessmentSchema.parse(input);
    const selection = this.store.selection.read();
    if (data.profileVersion !== selection.coreVersion)
      throw Error('Профессиональное ядро изменилось. Прочитайте актуальный профиль.');
    validateCultureEvidence(data, this.observations(companyId));
    const assessment = {
      ...data,
      weights: selection.core.weights,
      id: randomUUID(),
      createdAt: now(),
    };
    this.store.db
      .prepare('INSERT INTO company_fit_assessments VALUES (?,?,?,?)')
      .run(assessment.id, companyId, JSON.stringify(assessment), assessment.createdAt);
    return this.profile(companyId);
  }
  culturePlan(companyId: string) {
    const p = this.profile(companyId, '', 'all');
    return {
      mode: 'culture_team',
      company: p.company,
      selection: this.store.selection.read(),
      fit: p.fit,
      observations: p.observations.filter((o) =>
        /^(AN|T|B04|B05|B06|P03_PUBLIC|P06)/.test(o.criterion_id),
      ),
      assessments: this.assessmentHistory(companyId),
      questions: [
        'Какое продуктовое решение изменилось после исследования?',
        'Кто проверяет дизайн эксперимента и выводы аналитика?',
        'Какие практики описаны исторически, а какие подтверждены сейчас?',
        'К какой команде относится каждый факт и кто будет ближайшим коллегой?',
      ],
      sourceQueries: [
        'product analytics experimentation case study',
        'data team methodology review mentoring',
        'engineering blog conference experiment decision',
        'analytics platform postmortem',
      ].map((q) => `${p.company.name} ${q}`),
      workflow: [
        'Прочитать прежние факты и историю, включая датированные материалы вне вакансий',
        'Найти и прочитать источники о практике и людях; сохранить границы подразделений',
        'Импортировать observations с датами и выполнить review',
        'Сохранить company и отдельные teams через jobs_company_culture_assess',
      ],
      note: 'План не запускает сеть, мониторинг вакансий или LLM. Ресерч выполняется независимо от наличия открытых ролей; очереди не меняются.',
    };
  }
  reviewFlag(id: string, input: unknown) {
    const decision = z
      .strictObject({ verified: z.boolean(), note: z.string().max(4000).default('') })
      .parse(input);
    const row = this.store.db
      .prepare('SELECT company_id FROM company_research_flags WHERE id=?')
      .get(id);
    if (!row) throw new Error('Red flag не найден');
    this.store.db
      .prepare('INSERT INTO company_research_reviews VALUES (?,?,?,?)')
      .run(randomUUID(), id, JSON.stringify(decision), now());
    return this.profile(row.company_id as string);
  }
  private readContext(profileId = '') {
    const companies = this.store.list<Company>('companies');
    const jobs = this.store.list<Job>('jobs');
    const monitor = this.store.observations();
    const reviews = this.store.db
      .prepare(
        'SELECT observation_id AS observationId,data,at FROM company_research_reviews ORDER BY rowid DESC',
      )
      .all()
      .map((r) => ({
        observationId: String(r.observationId),
        data: JSON.parse(String(r.data)),
        at: String(r.at),
      }));
    const latestReviews = new Map<string, (typeof reviews)[number]>();
    for (const review of reviews)
      if (!latestReviews.has(review.observationId)) latestReviews.set(review.observationId, review);
    const observations = this.store.db
      .prepare('SELECT * FROM company_research_observations ORDER BY rowid DESC')
      .all()
      .map((row): StoredObservation => {
        const review = latestReviews.get(String(row.id));
        const decision = review?.data || {};
        return {
          ...JSON.parse(String(row.data)),
          id: String(row.id),
          companyId: String(row.company_id),
          runId: String(row.run_id),
          importedAt: String(row.at),
          manual: String(row.run_id).startsWith('manual:'),
          verifiedAt: decision.verified ? review!.at : null,
          rejected: !!decision.rejected,
          reviewNote: decision.note || '',
        };
      });
    const group = <T>(items: T[], key: (item: T) => string) => {
      const result = new Map<string, T[]>();
      for (const item of items) {
        const id = key(item);
        const values = result.get(id) || [];
        values.push(item);
        result.set(id, values);
      }
      return result;
    };
    const observationsByCompany = group(observations, (o) => o.companyId);
    const companyByObservation = new Map(observations.map((o) => [o.id, o.companyId]));
    const companyByJob = new Map(jobs.map((j) => [j.id, j.companyId]));
    const profile = this.store.selection.profile(profileId || undefined);
    const historyByCompany = new Map<string, ReturnType<CompanyResearch['history']>>();
    for (const run of this.history())
      for (const id of new Set<string>(
        run.companies.map((c: { companyId?: string }) => c.companyId).filter(Boolean),
      )) {
        const history = historyByCompany.get(id) || [];
        history.push(run);
        historyByCompany.set(id, history);
      }
    const profileVersions = new Map(
      this.store.selection.history().map((v) => [v.coreVersion, v.core.weights]),
    );
    return {
      selection: this.store.selection.read(),
      assessments: new Map(
        this.store.db
          .prepare('SELECT company_id,data FROM company_fit_assessments ORDER BY rowid ASC')
          .all()
          .map((r): [string, FitAssessment | CultureAssessment] => {
            const value = JSON.parse(String(r.data)) as FitAssessment | CultureAssessment;
            return [
              String(r.company_id),
              'kind' in value
                ? value
                : { ...value, weights: value.weights || profileVersions.get(value.profileVersion) },
            ];
          }),
      ),
      companies,
      companyById: new Map(companies.map((c) => [c.id, c])),
      jobsByCompany: group(jobs, (j) => j.companyId),
      observationsByCompany,
      monitorByCompany: group(monitor, (o) => companyByJob.get(String(o.jobId)) || ''),
      reviewsByCompany: group(reviews, (r) => companyByObservation.get(r.observationId) || ''),
      latestReviews,
      profile,
      historyByCompany,
      sources: this.store.list<Source>('sources'),
      sourceRuns: this.store.latestSourceRuns(),
      preferences: new Map(
        this.store.db
          .prepare('SELECT * FROM company_research_preferences')
          .all()
          .map((r) => [String(r.company_id), JSON.parse(String(r.data))]),
      ),
      flagsByCompany: group(
        this.store.db.prepare('SELECT * FROM company_research_flags').all(),
        (r) => String(r.company_id),
      ),
      snapshots: new Map(
        this.store.db
          .prepare('SELECT * FROM company_research_scores')
          .all()
          .map((r) => [String(r.company_id), JSON.parse(String(r.data)) as ResearchScoreSnapshot]),
      ),
    };
  }
  recalculateScores(companyIds?: string[]) {
    const context = this.readContext();
    const ids = [...new Set(companyIds ?? context.companies.map((c) => c.id))];
    for (const id of ids) if (!context.companyById.has(id)) throw new Error('Компания не найдена');
    const calculatedAt = Date.now();
    return this.store.transaction(() => ({
      companies: ids.map((companyId) => {
        const snapshot = calculateScoreSnapshot(
          context.observationsByCompany.get(companyId) || [],
          calculatedAt,
        );
        saveScoreSnapshot(this.store.db, companyId, snapshot);
        return { companyId, scoresCalculatedAt: snapshot.calculatedAt };
      }),
    }));
  }
  profile(companyId: string, country = '', profileId = '', context = this.readContext(profileId)) {
    const company = context.companyById.get(companyId);
    if (!company) throw new Error('Компания не найдена');
    const observations = context.observationsByCompany.get(companyId) || [];
    let snapshot = context.snapshots.get(companyId);
    // Existing databases are initialized once; unchanged evidence never triggers scoring on GET.
    if (!snapshot || snapshot.fingerprint !== scoreFingerprint(observations)) {
      snapshot = calculateScoreSnapshot(observations);
      saveScoreSnapshot(this.store.db, companyId, snapshot);
      context.snapshots.set(companyId, snapshot);
    }
    const summary = snapshot.summaries[country] || snapshot.summaries['*'];
    const preference = context.preferences.get(companyId);
    const flags = (context.flagsByCompany.get(companyId) || []).map((r) => {
      const review = context.latestReviews.get(String(r.id));
      const d = review?.data || {};
      return {
        ...JSON.parse(r.data as string),
        id: r.id,
        verification: d.verified ? 'verified_source' : 'unverified',
        verifiedAt: d.verified ? review!.at : '',
        reviewNote: d.note || '',
      };
    });
    const profile = context.profile;
    const monitor = context.monitorByCompany.get(companyId) || [];
    const presenceByJob = new Map<string, typeof monitor>();
    for (const presence of monitor) {
      const id = String(presence.jobId);
      const values = presenceByJob.get(id) || [];
      values.push(presence);
      presenceByJob.set(id, values);
    }
    const history = context.historyByCompany.get(companyId) || [];
    const jobs = (context.jobsByCompany.get(companyId) || []).map((j) => {
      const obs = presenceByJob.get(j.id) || [];
      const checkedAt =
        obs
          .map((o) => String(o.lastSeenAt))
          .sort()
          .at(-1) || j.lastSeenAt;
      const missing = obs.some((o) => Number(o.missingCount) >= 2);
      const fresh = !!checkedAt && Date.parse(checkedAt) >= Date.now() - 30 * 86400000;
      const suitable = profile?.keywords.length
        ? acceptsJob(j, searchSchema.parse({}), profile)
        : /(?:product|data|business|продукт|данных).*analyst|analyst.*(?:product|data|business)|аналитик/i.test(
            j.title,
          ) &&
          !['intern', 'junior'].includes(j.seniority) &&
          (!profile || acceptsJob(j, searchSchema.parse({}), profile));
      return {
        ...j,
        checkedAt,
        current: fresh && !missing && j.stage !== 'archived',
        freshness: missing ? 'missing' : fresh ? 'recently_checked' : 'unverified_or_stale',
        suitable,
        countries: [...new Set(locateJob(j.location).map((p) => p.code))],
      };
    });
    const currentJobs = jobs.filter(
      (j) => j.current && j.suitable && (!country || j.countries.includes(country)),
    );
    const confirmed = summary.criteria
      .filter((c) => !c.conflicting)
      .flatMap((c) => c.known)
      .filter(
        (o) =>
          !o.rejected &&
          !stale(o) &&
          o.confidence !== 'low' &&
          o.evidence.some((e) =>
            ['official', 'job', 'engineering', 'report', 'conference'].includes(e.source_type),
          ),
      );
    const jobsCheckedAt =
      jobs
        .map((j) => j.checkedAt)
        .filter(Boolean)
        .sort()
        .at(-1) || '';
    const lastResearchAt =
      [...observations.map((o) => o.verifiedAt || o.importedAt), ...history.map((r) => r.at)]
        .sort()
        .at(-1) || '';
    const targetVacancies = companyTargetVacancies(
      companyId,
      jobs,
      context.sources,
      monitor.map((o) => ({
        sourceId: String(o.sourceId),
        jobId: String(o.jobId),
        lastSeenAt: String(o.lastSeenAt),
        missingCount: Number(o.missingCount),
      })),
      Date.now(),
      profile,
      context.selection.scenarios.find((s) => s.id === profile.selection?.scenarioId),
      observations,
    );
    const columnSources = companyColumnSources(
      company,
      observations,
      jobs,
      targetVacancies,
      history,
    );
    return {
      fit: companyFit(observations, context.selection, context.assessments.get(companyId)),
      searchContext: profile?.selection,
      company,
      headquarters: headquartersProfile(observations),
      observations,
      ...summary,
      scoresCalculatedAt: snapshot.calculatedAt,
      preferences: preference || { priority: 'Unassigned', notes: '' },
      flags,
      jobs,
      currentJobs,
      targetVacancies: {
        ...targetVacancies,
        checkedSources: companySourceChecks(
          companyId,
          context.sources,
          context.sourceRuns,
          history.flatMap((run) =>
            (run.document?.companies || [])
              .filter((c: ResearchImport['companies'][number]) =>
                c.identity.company_id
                  ? c.identity.company_id === companyId
                  : c.identity.name === company.name,
              )
              .flatMap(
                (c: ResearchImport['companies'][number]): CollectionSource[] =>
                  c.collection_sources || [],
              ),
          ),
        ),
      },
      columnSources,
      confirmed,
      lastResearchAt,
      jobsCheckedAt,
      reviewHistory: (context.reviewsByCompany.get(companyId) || []).map((r) => ({
        ...r,
        data: JSON.stringify(r.data),
      })),
      researchStatus: !observations.length
        ? 'not_researched'
        : summary.criteria.some(
              (c) => c.verdict === 'conflicting' || c.conflicting || c.pendingConflict,
            )
          ? 'conflicting'
          : observations.some((o) => o.verifiedAt && stale(o))
            ? 'stale'
            : observations.some((o) => !o.verifiedAt && !o.rejected)
              ? 'needs_review'
              : 'reviewed',
      history,
    };
  }
  list(country = '', profileId = '') {
    const context = this.readContext(profileId);
    return {
      companies: context.companies.map((c) => {
        const { history, ...profile } = this.profile(c.id, country, profileId, context);
        return profile;
      }),
      registryVersion: registry.version,
    };
  }
  plan(companyId: string, country = '', profileId = '') {
    const p = this.profile(companyId, country, profileId);
    const jobMaterials = companyJobMaterials(
      companyId,
      p.jobs,
      this.store.observations().map((o) => ({
        sourceId: String(o.sourceId),
        jobId: String(o.jobId),
        lastSeenAt: String(o.lastSeenAt),
        missingCount: Number(o.missingCount),
      })),
    );
    const gaps = p.criteria
      .filter(
        (c) =>
          (c.criterion.kind === 'scored' && c.verdict === 'unknown') ||
          c.verdict === 'conflicting' ||
          (c.criterion.kind !== 'scored' && !c.known.length),
      )
      .map((c) => ({
        criterionId: c.criterion.id,
        question: c.criterion.question,
        reason: c.conflicting
          ? 'conflict'
          : c.observations.some((o) => o.verifiedAt && stale(o))
            ? 'stale'
            : c.observations.length
              ? 'unverified'
              : 'missing',
        priority: ['AN01', 'AN02', 'AN03', 'AN04'].includes(c.criterion.id)
          ? 5
          : c.criterion.section === 'A'
            ? 3
            : c.criterion.kind === 'scored'
              ? 2
              : 1,
        publicAnswerLikelihood: c.criterion.public_answer_likelihood,
        sources: c.criterion.allowed_sources,
        interviewIds: c.criterion.interview_ids,
        queries: [
          `${p.company.name} ${c.criterion.question}`,
          ...(p.company.website ? [`site:${domain(p.company.website)} ${c.criterion.name}`] : []),
        ],
      }))
      .sort((a, b) => b.priority - a.priority);
    return {
      companyId,
      selection: this.store.selection.read(),
      fit: p.fit,
      searchContext: p.searchContext,
      priority: p.preferences.priority,
      country,
      jobMaterials,
      gaps,
      sourcesWorkflow: [
        'jobs_sources_status',
        'jobs_profiles',
        'jobs_discovery_history',
        'jobs_search (execute=false first)',
        'jobs_add_company_board',
        'jobs_monitor_companies',
      ],
      paidRecommendations: gaps
        .filter((g) => ['P01', 'P07_INTERVIEW', 'B06'].includes(g.criterionId))
        .map((g) => ({
          companyId,
          criterionId: g.criterionId,
          provider: 'apify',
          actor: g.criterionId === 'B06' ? null : 'memo23/glassdoor-scraper-ppr',
          operation:
            g.criterionId === 'P01'
              ? 'reviews'
              : g.criterionId === 'P07_INTERVIEW'
                ? 'interviews'
                : 'traffic',
          reason: 'Закрывает существенный пробел; сначала бесплатные первичные источники',
          importance: p.preferences.priority === 'Target' ? 3 : 1,
          estimatedCost: null,
          executionAvailable: g.criterionId !== 'B06' && Boolean(process.env.APIFY_TOKEN?.trim()),
          adapterAvailable: g.criterionId !== 'B06',
          quoteTool: g.criterionId === 'B06' ? null : 'jobs_company_paid_quote',
          datasetRead: 'disabled',
          requires:
            'Актуальный pricing и отдельное согласие: Actor, параметры, компании, объём и максимальная стоимость',
        })),
    };
  }
}
