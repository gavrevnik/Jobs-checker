import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  availabilityVerificationSchema,
  type Company,
  type JobInput,
  type Profile,
  type Source,
} from '../shared/model.js';
import { hasReviewableTitle } from '../shared/source-tools.js';
import type { Store } from './store.js';

const prefix = 'search-review:';
const lifetime = 24 * 3600000;
const hash = (profile?: Profile) =>
  createHash('sha256')
    .update(JSON.stringify(profile ?? null))
    .digest('hex');
const snippet = (text: string) => text.replace(/\s+/g, ' ').trim();

export const searchReviewSchema = z.object({
  batchId: z.uuid(),
  decisions: z
    .array(
      z.object({
        candidateId: z.uuid(),
        category: z.enum(['reject', 'practice', 'target']),
        roleFamily: z
          .enum(['product_analytics', 'data_analytics', 'decision_science', 'analytics_lead'])
          .optional(),
        language: z.enum(['en', 'ru', 'other', 'unknown']),
        reason: z.string().trim().min(1).max(2000),
        companyId: z.string().max(100).optional(),
        quote: z.string().trim().max(700).default(''),
        // Optional complete text read on the official page, for example after an Adzuna excerpt.
        officialDescription: z
          .object({
            url: z.url().refine((url) => /^https?:\/\//i.test(url)),
            text: z.string().trim().min(1).max(25000),
          })
          .optional(),
        availabilityVerification: availabilityVerificationSchema.optional(),
        uncertainties: z.array(z.string().trim().min(1).max(300)).max(10).default([]),
      }),
    )
    .max(500)
    .default([]),
});

export type ReviewCandidate = {
  id: string;
  job: JobInput;
  requestedMarkets?: string[];
  origins: { sourceId: string; externalId: string; observedAt: string }[];
};
type ReviewBatch = {
  expires: number;
  scenarioId?: string;
  profileHash: string;
  selectionVersion: number;
  candidates: ReviewCandidate[];
};

export class SearchReviews {
  constructor(private store: Store) {}

  stage(
    scenarioId: string | undefined,
    profile: Profile | undefined,
    candidates: ReviewCandidate[],
  ) {
    const batchId = randomUUID();
    const batch: ReviewBatch = {
      expires: Date.now() + lifetime,
      scenarioId,
      profileHash: hash(profile),
      selectionVersion: this.store.selection.read().version,
      candidates,
    };
    this.store.db
      .prepare(
        "DELETE FROM settings WHERE key LIKE 'search-review:%' AND CAST(json_extract(value,'$.expires') AS INTEGER) <= ?",
      )
      .run(Date.now());
    this.store.db
      .prepare('INSERT INTO settings VALUES (?,?)')
      .run(prefix + batchId, JSON.stringify(batch));
    return batchId;
  }

  refreshSource(
    source: Source,
    selected: JobInput[],
    snapshot: JobInput[] | undefined,
    observedAt: string,
    reviewRequired: boolean,
    scenarioId: string,
    profile?: Profile,
  ) {
    const known: JobInput[] = [];
    const candidates: ReviewCandidate[] = [];
    for (const job of selected) {
      if (!reviewRequired || this.store.findDuplicate(job, source.id)) {
        known.push(job);
      } else if (
        hasReviewableTitle(job.title) &&
        job.url &&
        job.company !== 'Компания не указана'
      ) {
        candidates.push({
          id: randomUUID(),
          job,
          origins: [{ sourceId: source.id, externalId: job.externalId, observedAt }],
        });
      }
    }
    const { added } = this.store.ingestJobs(known, source.id, snapshot, observedAt);
    const reviewBatchIds: string[] = [];
    for (let start = 0; start < candidates.length; start += 100)
      reviewBatchIds.push(this.stage(scenarioId, profile, candidates.slice(start, start + 100)));
    return { added, reviewBatchIds, pendingReview: candidates.length };
  }

  review(input: unknown) {
    const { batchId, decisions } = searchReviewSchema.parse(input);
    return this.store.transaction(() => {
      const row = this.store.db
        .prepare('SELECT value FROM settings WHERE key=?')
        .get(prefix + batchId);
      const batch = row && (JSON.parse(String(row.value)) as ReviewBatch);
      if (!batch || batch.expires <= Date.now())
        throw new Error('Пакет проверки истёк или не найден. Запустите поиск заново.');
      const profile = this.store.selection.profile(batch.scenarioId || undefined);
      if (
        hash(profile) !== batch.profileHash ||
        this.store.selection.read().version !== batch.selectionVersion
      )
        throw new Error('Профиль поиска изменился. Запустите поиск заново.');
      const pending = new Map(batch.candidates.map((candidate) => [candidate.id, candidate]));
      const counts = { target: 0, practice: 0, reject: 0, added: 0, newCompanies: 0 };
      const initialCompanies = this.store.list<Company>('companies').length;
      const saved: { candidateId: string; atsId: string }[] = [];
      const reviewedAt = new Date().toISOString();
      for (const decision of decisions) {
        const candidate = pending.get(decision.candidateId);
        if (!candidate) throw new Error('Кандидат не найден в пакете или уже обработан');
        pending.delete(decision.candidateId);
        counts[decision.category]++;
        if (decision.category === 'reject') continue;
        const { job, origins } = candidate;
        if (
          !hasReviewableTitle(job.title) ||
          (decision.language !== 'en' && decision.language !== 'ru')
        )
          throw new Error('Для сохранения нужна роль с названием и рабочим языком EN/RU');
        const families = profile?.selection?.roleFamilies;
        if (!decision.roleFamily || (families?.length && !families.includes(decision.roleFamily)))
          throw new Error('Укажите семейство роли из профессионального профиля');
        if (!job.url || job.company === 'Компания не указана')
          throw new Error('Для сохранения нужны ссылка на вакансию и работодатель');
        if (
          job.sourceRemoved ||
          (job.applicationDeadline && Date.parse(job.applicationDeadline) < Date.now())
        )
          throw new Error('Срок отклика истёк или вакансия удалена');
        const company = decision.companyId
          ? this.store.get<Company>('companies', decision.companyId)
          : undefined;
        if (decision.companyId && !company) throw new Error('Компания из решения не найдена');
        const description = decision.officialDescription?.text ?? job.description;
        if (!decision.quote || !snippet(description).includes(snippet(decision.quote)))
          throw new Error('Цитата должна присутствовать в проверенном описании вакансии');
        const discoveryAssessment = {
          category: decision.category,
          roleFamily: decision.roleFamily,
          language: decision.language,
          reason: decision.reason,
          quote: decision.quote,
          evidenceUrl: decision.officialDescription?.url ?? job.url,
          uncertainties: decision.uncertainties,
          reviewedAt,
          scenarioId: profile?.selection?.scenarioId || '',
          profileVersion: profile?.selection?.version,
        };
        for (const [index, origin] of origins.entries()) {
          const duplicate = company && this.store.findDuplicate(job, origin.sourceId);
          if (company && duplicate && duplicate.companyId !== company.id)
            throw new Error('Эта вакансия уже связана с другой компанией');
          const result = this.store.ingestJobs(
            [
              {
                ...job,
                company: company?.name ?? job.company,
                externalId: origin.externalId,
                discoveryAssessment,
                ...(decision.availabilityVerification
                  ? { availabilityVerification: decision.availabilityVerification }
                  : {}),
              },
            ],
            origin.sourceId,
            undefined,
            origin.observedAt,
          );
          if (index === 0) {
            counts.added += result.added;
            if (!result.added)
              this.store.updateJob(result.ids[0], {
                discoveryAssessment,
                ...(decision.availabilityVerification
                  ? { availabilityVerification: decision.availabilityVerification }
                  : {}),
              });
            saved.push({ candidateId: candidate.id, atsId: result.ids[0] });
          }
        }
      }
      counts.newCompanies = this.store.list<Company>('companies').length - initialCompanies;
      if (decisions.length)
        this.store.db
          .prepare('UPDATE settings SET value=? WHERE key=?')
          .run(JSON.stringify({ ...batch, candidates: [...pending.values()] }), prefix + batchId);
      return {
        batchId,
        ...counts,
        saved,
        pending: pending.size,
        candidates: decisions.length ? undefined : [...pending.values()],
      };
    });
  }
}
