import { z } from 'zod';
import { dimensionIds, dimensions, type SelectionConfig } from './selection-profile.js';
import {
  scopeSchema,
  scopeKey,
  observationsDisagree,
  type StoredObservation,
} from './company-research.js';

const ids = z.array(z.string().min(1).max(100)).max(30);
const summary = z.strictObject({ text: z.string().trim().max(500), evidenceIds: ids });
const dimension = z.strictObject({
  id: z.enum(dimensionIds),
  rating: z.number().int().min(0).max(4).nullable(),
  reason: z.string().trim().min(1).max(400),
  evidenceIds: ids,
  basis: z.enum(['practice', 'historical', 'unknown']),
});
const layer = z.strictObject({
  summary,
  dimensions: z.array(dimension).length(6),
  strengths: z.array(z.string().trim().min(1).max(160)).max(3),
  gaps: z.array(z.string().trim().min(1).max(160)).max(5),
  nextStep: z.string().trim().min(1).max(240),
});
export const cultureAssessmentSchema = z
  .strictObject({
    kind: z.literal('culture_team'),
    methodologyVersion: z.literal(2),
    profileVersion: z.number().int().positive(),
    business: summary,
    company: layer,
    teams: z
      .array(
        layer.extend({
          id: z.string().regex(/^[a-z0-9_-]{1,80}$/),
          name: z.string().trim().min(1).max(200),
          scope: scopeSchema.extend({ context: z.string().trim().min(1).max(500) }),
        }),
      )
      .max(15),
  })
  .superRefine((v, c) => {
    if (
      new Set(v.teams.map((t) => t.id)).size !== v.teams.length ||
      new Set(v.teams.map((t) => scopeKey(t.scope))).size !== v.teams.length
    )
      c.addIssue({ code: 'custom', message: 'Команды и их scope должны быть уникальными' });
    for (const l of [v.company, ...v.teams]) {
      if (new Set(l.dimensions.map((d) => d.id)).size !== 6)
        c.addIssue({ code: 'custom', message: 'Нужны все шесть составляющих' });
      for (const d of l.dimensions) {
        if (
          d.rating === null
            ? d.basis !== 'unknown' || d.evidenceIds.length > 0
            : d.basis === 'unknown' || !d.evidenceIds.length
        )
          c.addIssue({
            code: 'custom',
            message: 'Неизвестное — null без оснований; для балла нужны основания и тип практики',
          });
      }
    }
    for (const s of [v.business, v.company.summary, ...v.teams.map((t) => t.summary)])
      if (s.text && !s.evidenceIds.length)
        c.addIssue({ code: 'custom', message: 'Для сводки нужны факты' });
  });
export type CultureInput = z.infer<typeof cultureAssessmentSchema>;
export type CultureAssessment = CultureInput & {
  id: string;
  createdAt: string;
  weights: SelectionConfig['core']['weights'];
};
export type CultureLayerInput = CultureInput['company'];
const cultural = /^(AN\d|T02$|T03$|T08_INFRA$|B04$|B05$|B06$|P03_PUBLIC$|P06$)/;
const primary = new Set(['official', 'engineering', 'report', 'conference']);
function usable(o: StoredObservation, now: number) {
  return (
    !!o.verifiedAt &&
    !o.rejected &&
    o.confidence !== 'low' &&
    cultural.test(o.criterion_id) &&
    o.evidence.length > 0 &&
    !o.scope.job_url &&
    o.evidence.every(
      (e) =>
        e.source_type !== 'job' &&
        [e.observed_at, e.published_at]
          .filter(Boolean)
          .every((d) => Number.isFinite(Date.parse(d!)) && Date.parse(d!) <= now + 86400000),
    )
  );
}
function conflict(o: StoredObservation, all: StoredObservation[], now: number) {
  // Compare historical evidence as well. Differing time/team contexts are kept separate.
  return all.some(
    (other) =>
      other.id !== o.id &&
      usable(other, now) &&
      other.criterion_id === o.criterion_id &&
      scopeKey(other.scope) === scopeKey(o.scope) &&
      observationsDisagree(o, other),
  );
}
function teamCompatible(o: StoredObservation, scope: z.infer<typeof scopeSchema>) {
  return Object.entries(o.scope).every(
    ([key, value]) => !value || scope[key as keyof typeof scope] === value,
  );
}
export function validateCultureEvidence(
  input: CultureInput,
  observations: StoredObservation[],
  now = Date.now(),
) {
  const known = new Map(observations.filter((o) => usable(o, now)).map((o) => [o.id, o]));
  const layers = [
    { layer: input.company, scope: null },
    ...input.teams.map((team) => ({ layer: team, scope: team.scope })),
  ];
  for (const { layer: l, scope } of layers) {
    for (const item of [l.summary, ...l.dimensions])
      for (const id of item.evidenceIds) {
        const o = known.get(id);
        if (!o || conflict(o, observations, now))
          throw Error('Нужен проверенный непротиворечивый источник вне вакансий: ' + id);
        if (scope && !teamCompatible(o, scope))
          throw Error('Основание относится к другой команде: ' + id);
      }
    for (const d of l.dimensions) {
      if (d.rating === null) continue;
      const evidence = d.evidenceIds.map((id) => known.get(id)!);
      const allowed = [
        ...dimensions[d.id].criteria,
        ...(d.id === 'data' ? [] : ['AN09_CULTURE']),
        ...(d.id === 'peers' ? ['AN08'] : []),
      ];
      if (!evidence.every((o) => allowed.includes(o.criterion_id)))
        throw Error('Основания не относятся к составляющей: ' + d.id);
      if (scope && !evidence.some((o) => o.scope.context === scope.context))
        throw Error('Балл команды требует прямого свидетельства этой команды');
      if (
        d.rating > 2 &&
        (!evidence.some((o) => o.evidence.some((e) => primary.has(e.source_type))) ||
          (d.id === 'peers' && evidence.every((o) => o.criterion_id === 'AN08')))
      )
        throw Error('Высокий балл требует описания практики, публикаций автора недостаточно');
      if (
        d.basis === 'historical' &&
        evidence.some((o) => o.evidence.every((e) => !e.published_at))
      )
        throw Error('Исторической практике нужна исходная дата');
    }
  }
  for (const id of input.business.evidenceIds)
    if (!known.has(id) || conflict(known.get(id)!, observations, now))
      throw Error('Нет основания для бизнес-сводки: ' + id);
}
// Recency affects confidence, never erases demonstrated expertise or changes its rating.
// This is a transparent evidence heuristic, not a probability that a company is good.
export function cultureEvidenceAge(o: StoredObservation, team: boolean, now: number) {
  const items = o.evidence.map((e) => {
    const published = e.published_at ? Date.parse(e.published_at) : null;
    const age = Math.max(0, (now - (published ?? Date.parse(e.observed_at))) / 86400000);
    const readAge = Math.max(0, (now - Date.parse(e.observed_at)) / 86400000);
    const weight = primary.has(e.source_type) ? 90 : 55;
    return {
      date: e.published_at || '',
      observedAt: e.observed_at,
      status:
        published === null
          ? ('undated' as const)
          : age > 365
            ? ('historical' as const)
            : ('recent' as const),
      confidence: Math.round(
        Math.min(
          published === null ? 55 : 100,
          weight * Math.pow(0.5, age / (team ? 365 : 1095)) * Math.pow(0.5, readAge / 1095),
        ),
      ),
    };
  });
  return items.sort((a, b) => b.confidence - a.confidence)[0];
}
export function scoreCultureLayer(
  input: CultureLayerInput,
  observations: StoredObservation[],
  weights: SelectionConfig['core']['weights'],
  now: number,
  team = false,
) {
  const known = new Map(observations.filter((o) => usable(o, now)).map((o) => [o.id, o]));
  const components = input.dimensions.map((d) => {
    const evidence = d.evidenceIds
      .map((id) => known.get(id))
      .filter((o): o is StoredObservation => !!o);
    const needsReview =
      d.rating !== null &&
      (evidence.length !== d.evidenceIds.length ||
        evidence.some((o) => conflict(o, observations, now)));
    const rating = needsReview ? null : d.rating;
    const ages = evidence.map((o) => cultureEvidenceAge(o, team, now));
    const confidence = rating === null ? 0 : Math.max(0, ...ages.map((a) => a.confidence));
    const temporal = [...ages].sort((a, b) => b.confidence - a.confidence)[0]?.status ?? 'unknown';
    return {
      ...d,
      rating,
      label: dimensions[d.id].label,
      weight: weights[d.id],
      points: rating === null ? null : (weights[d.id] * rating) / 4,
      confidence,
      temporal,
      needsReview,
      evidenceDates: ages,
      reason: needsReview
        ? 'Основания изменились; пересмотреть эту составляющую. ' + d.reason
        : d.reason,
    };
  });
  const coverage = components.filter((d) => d.rating !== null).reduce((s, d) => s + d.weight, 0);
  const earned = components.reduce((s, d) => s + (d.points ?? 0), 0);
  const confidence = coverage
    ? Math.round(
        components.reduce((s, d) => s + d.confidence * (d.rating === null ? 0 : d.weight), 0) /
          coverage,
      )
    : 0;
  const summaryValid = input.summary.evidenceIds.every(
    (id) => known.has(id) && !conflict(known.get(id)!, observations, now),
  );
  return {
    score: coverage ? Math.round((100 * earned) / coverage) : null,
    coverage,
    confidence,
    confidenceLabel: confidence >= 70 ? 'Высокая' : confidence >= 40 ? 'Умеренная' : 'Низкая',
    range: [Math.round(earned), Math.round(earned + 100 - coverage)],
    components,
    summary: summaryValid
      ? input.summary.text ||
        'Недостаточно проверенных данных о культуре и команде. Следующий шаг указан в разборе.'
      : 'Сводку нужно пересмотреть после изменения оснований.',
    strengths: input.strengths,
    gaps: input.gaps,
    nextStep: input.nextStep,
    needsReview: !summaryValid || components.some((d) => d.needsReview),
  };
}
export function cultureFit(
  observations: StoredObservation[],
  config: SelectionConfig,
  assessment: CultureAssessment,
  now = Date.now(),
) {
  const company = scoreCultureLayer(assessment.company, observations, config.core.weights, now);
  const teams = assessment.teams.map((t) => ({
    ...scoreCultureLayer(t, observations, config.core.weights, now, true),
    id: t.id,
    name: t.name,
    scope: t.scope,
  }));
  const outdated = assessment.profileVersion !== config.coreVersion;
  const mature = ['experimentation', 'peers'].every((id) =>
    company.components.some((d) => d.id === id && (d.rating ?? -1) >= 3 && d.confidence >= 60),
  );
  const ready =
    !outdated &&
    !company.needsReview &&
    company.coverage >= 60 &&
    company.confidence >= 60 &&
    (!config.core.preferMatureTeam || mature);
  const target = ready && company.score !== null && company.score >= 80;
  const businessValid = assessment.business.evidenceIds.every((id) =>
    observations.some((o) => o.id === id && usable(o, now) && !conflict(o, observations, now)),
  );
  const oldKnown = assessment.company.dimensions.filter((d) => d.rating !== null);
  const oldCoverage = oldKnown.reduce((s, d) => s + assessment.weights[d.id], 0);
  const scope: z.infer<typeof scopeSchema> = { context: 'Компания · подтверждённая экспертиза' };
  return {
    score: outdated ? null : company.score,
    previousScore:
      outdated && oldCoverage
        ? Math.round(
            (100 * oldKnown.reduce((s, d) => s + (assessment.weights[d.id] * d.rating!) / 4, 0)) /
              oldCoverage,
          )
        : null,
    coverage: company.coverage,
    range: company.range,
    components: company.components,
    profileVersion: config.coreVersion,
    assessedProfileVersion: assessment.profileVersion,
    scope,
    provisional: !ready,
    outdated,
    suggestedQueue: target ? 'Target' : ready ? 'Secondary' : 'Research',
    suggestionReason: outdated
      ? 'Обновить разбор по текущему профилю'
      : company.needsReview
        ? 'Пересмотреть изменившиеся основания'
        : target
          ? 'Сильная компания; пригодность конкретной команды проверяется отдельно'
          : 'Есть потенциал; актуальность практик и команда требуют проверки',
    business: businessValid ? assessment.business.text : '',
    analytics: company.summary,
    strengths: company.strengths,
    gaps: company.gaps,
    nextStep: company.nextStep,
    assessmentId: assessment.id,
    assessedAt: assessment.createdAt,
    culture: { methodologyVersion: 2 as const, company, teams },
  };
}
