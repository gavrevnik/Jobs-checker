import { z } from 'zod';
import { cultureFit, type CultureAssessment } from './company-culture-fit.js';
import { dimensionIds, dimensions, type SelectionConfig } from './selection-profile.js';
import {
  effectiveVerdict,
  criterionState,
  scopeKey,
  scopeSchema,
  stale,
  type StoredObservation,
} from './company-research.js';

const ids = z.array(z.string().min(1).max(100)).max(30);
const summary = z.strictObject({ text: z.string().trim().max(500), evidenceIds: ids });
export const fitAssessmentSchema = z
  .strictObject({
    profileVersion: z.number().int().positive(),
    scope: scopeSchema,
    business: summary,
    analytics: summary,
    dimensions: z
      .array(
        z.strictObject({
          id: z.enum(dimensionIds),
          rating: z.number().int().min(0).max(4).nullable(),
          reason: z.string().trim().min(1).max(400),
          evidenceIds: ids,
          basis: z.enum(['practice', 'role_requirement', 'unknown']),
        }),
      )
      .length(6),
    strengths: z.array(z.string().trim().min(1).max(160)).max(3),
    gaps: z.array(z.string().trim().min(1).max(160)).max(3),
    nextStep: z.string().trim().min(1).max(240),
  })
  .superRefine((v, c) => {
    if (new Set(v.dimensions.map((d) => d.id)).size !== 6)
      c.addIssue({ code: 'custom', message: 'Оцените каждую из шести составляющих один раз' });
    for (const d of v.dimensions) {
      if (d.rating !== null && (!d.evidenceIds.length || d.basis === 'unknown'))
        c.addIssue({ code: 'custom', message: 'Для балла нужны основания и тип доказательства' });
      if (d.basis === 'role_requirement' && d.rating !== null && d.rating > 2)
        c.addIssue({
          code: 'custom',
          message: 'Обязанности в вакансии подтверждают максимум базовый уровень (2/4)',
        });
    }
    for (const s of [v.business, v.analytics])
      if (s.text && !s.evidenceIds.length)
        c.addIssue({ code: 'custom', message: 'Для сводки нужны ссылки на факты' });
  });
export type FitAssessment = z.infer<typeof fitAssessmentSchema> & {
  id: string;
  createdAt: string;
  weights?: SelectionConfig['core']['weights'];
};
export type FitDimension = {
  id: (typeof dimensionIds)[number];
  label: string;
  weight: number;
  rating: number | null;
  points: number | null;
  reason: string;
  evidenceIds: string[];
  basis: 'practice' | 'role_requirement' | 'unknown';
};
const usable = (o: StoredObservation, now: number) =>
  !!o.verifiedAt && !o.rejected && o.confidence !== 'low' && !stale(o, now);
const conflicted = (o: StoredObservation, observations: StoredObservation[], now: number) =>
  criterionState(
    o.criterion_id,
    observations.filter(
      (other) =>
        other.criterion_id === o.criterion_id && scopeKey(other.scope) === scopeKey(o.scope),
    ),
    '',
    now,
  ).verdict === 'conflicting';
export function validateFitEvidence(
  input: z.infer<typeof fitAssessmentSchema>,
  observations: StoredObservation[],
  now = Date.now(),
) {
  const known = new Map(observations.filter((o) => usable(o, now)).map((o) => [o.id, o]));
  for (const item of [...input.dimensions, ...[input.business, input.analytics]])
    for (const id of item.evidenceIds) {
      const o = known.get(id);
      if (!o) throw new Error('Основание отсутствует, устарело или не прошло проверку: ' + id);
      if (conflicted(o, observations, now))
        throw new Error('В основаниях есть неразрешённое противоречие: ' + id);
      for (const key of ['country', 'city', 'role', 'job_url', 'level', 'context'] as const) {
        if (o.scope[key] && input.scope[key] !== o.scope[key])
          throw new Error(
            'Сводка и основания относятся к разным командам/ролям. Укажите общий scope или разделите исследование.',
          );
      }
    }
  for (const d of input.dimensions) {
    if (d.rating === null) continue;
    const evidence = d.evidenceIds.map((id) => known.get(id)!);
    const allowed = new Set<string>([
      ...dimensions[d.id].criteria,
      ...(d.id === 'data' ? [] : ['AN09_CULTURE']),
      ...(['influence', 'experimentation'].includes(d.id) ? ['B04'] : []),
      ...(d.id === 'peers' ? ['AN08'] : []),
    ]);
    if (!evidence.some((o) => allowed.has(o.criterion_id)))
      throw new Error('Основания не относятся к составляющей: ' + d.id);
    if (d.id === 'peers' && d.rating > 2 && evidence.every((o) => o.criterion_id === 'AN08'))
      throw new Error('Публикации не подтверждают качество совместной работы');
    if (d.rating > 2 && evidence.every((o) => o.evidence.every((e) => e.source_type === 'job')))
      throw new Error('Одни вакансии не подтверждают зрелую действующую практику');
  }
}
export function companyFit(
  observations: StoredObservation[],
  config: SelectionConfig,
  assessment?: FitAssessment | CultureAssessment,
  now = Date.now(),
) {
  if (assessment && 'kind' in assessment && assessment.kind === 'culture_team')
    return cultureFit(observations, config, assessment, now);
  const legacy = assessment as FitAssessment | undefined;
  return legacyCompanyFit(observations, config, legacy, now);
}
function legacyCompanyFit(
  observations: StoredObservation[],
  config: SelectionConfig,
  assessment: FitAssessment | undefined,
  now: number,
) {
  const current = observations.filter((o) => usable(o, now));
  const knownIds = new Set(current.map((o) => o.id));
  const referenced = assessment
    ? [
        ...assessment.dimensions.flatMap((d) => d.evidenceIds),
        ...assessment.business.evidenceIds,
        ...assessment.analytics.evidenceIds,
      ]
    : [];
  const outdated =
    !!assessment &&
    (assessment.profileVersion !== config.coreVersion ||
      referenced.some(
        (id) =>
          !knownIds.has(id) ||
          conflicted(
            current.find((o) => o.id === id)!,
            observations,
            now,
          ),
      ));
  // Legacy boolean signals are a conservative starting point, not a claim of maturity.
  // Keep one role/country scope; never assemble a perfect team from unrelated vacancies.
  const scopes = [
    ...new Set(
      current.filter((o) => /^(AN|T|B05|P06)/.test(o.criterion_id)).map((o) => scopeKey(o.scope)),
    ),
  ];
  const unscoped = scopeKey({});
  const selectedScope =
    scopes
      .filter((s) => s !== unscoped)
      .sort(
        (a, b) =>
          current.filter((o) => scopeKey(o.scope) === b).length -
          current.filter((o) => scopeKey(o.scope) === a).length,
      )[0] || unscoped;
  const scoped = current.filter((o) => [unscoped, selectedScope].includes(scopeKey(o.scope)));
  const components: FitDimension[] = dimensionIds.map((id) => {
    const spec = dimensions[id],
      weight = config.core.weights[id];
    const explicit = assessment?.dimensions.find((d) => d.id === id);
    if (explicit)
      return {
        ...explicit,
        label: spec.label,
        weight,
        points: explicit.rating === null ? null : (weight * explicit.rating) / 4,
      };
    const candidates = scoped
      .filter((o) => (spec.criteria as readonly string[]).includes(o.criterion_id))
      .filter((o) => ['pass', 'fail'].includes(effectiveVerdict(o, now)));
    const positive = candidates.filter((o) => effectiveVerdict(o, now) === 'pass');
    const negative = candidates.filter((o) => effectiveVerdict(o, now) === 'fail');
    const rating =
      positive.length && !negative.length ? 2 : negative.length && !positive.length ? 0 : null;
    const evidence = rating === null ? [] : rating === 0 ? negative : positive;
    const duty =
      evidence.length > 0 &&
      evidence.every((o) => o.evidence.every((e) => e.source_type === 'job'));
    return {
      id,
      label: spec.label,
      weight,
      rating,
      points: rating === null ? null : (weight * rating) / 4,
      evidenceIds: evidence.map((o) => o.id),
      basis: rating === null ? 'unknown' : duty ? 'role_requirement' : 'practice',
      reason:
        rating === null
          ? 'Нужен содержательный разбор'
          : rating === 0
            ? 'Есть прямое отрицательное свидетельство'
            : duty
              ? 'Заявлено в обязанностях; практика требует проверки'
              : 'Есть проверенный сигнал; глубина практики требует оценки',
    };
  });
  const coverage = components.filter((d) => d.rating !== null).reduce((s, d) => s + d.weight, 0);
  const earned = components.reduce((s, d) => s + (d.points ?? 0), 0);
  const score = coverage ? Math.round((100 * earned) / coverage) : null;
  const originalWeights = assessment?.weights || config.core.weights;
  const originalKnown = assessment?.dimensions.filter((d) => d.rating !== null) || [];
  const originalCoverage = originalKnown.reduce((s, d) => s + originalWeights[d.id], 0);
  const originalScore = originalCoverage
    ? Math.round(
        (100 * originalKnown.reduce((s, d) => s + (originalWeights[d.id] * d.rating!) / 4, 0)) /
          originalCoverage,
      )
    : null;
  const mature = ['experimentation', 'peers'].every(
    (id) => (components.find((d) => d.id === id)?.rating ?? -1) >= 3,
  );
  const ready =
    !!assessment && !outdated && coverage >= 60 && (!config.core.preferMatureTeam || mature);
  const target = ready && score !== null && score >= 80;
  const scope =
    assessment?.scope || scoped.find((o) => scopeKey(o.scope) === selectedScope)?.scope || {};
  const supported = components.filter((d) => d.rating !== null && d.rating >= 2);
  const missing = components.filter((d) => d.rating === null).sort((a, b) => b.weight - a.weight);
  return {
    culture: null,
    score: outdated ? null : score,
    previousScore: outdated ? originalScore : null,
    coverage,
    range: [Math.round(earned), Math.round(earned + 100 - coverage)],
    components,
    profileVersion: config.coreVersion,
    assessedProfileVersion: assessment?.profileVersion ?? null,
    scope,
    provisional: !assessment || outdated || !ready,
    outdated,
    suggestedQueue: target ? 'Target' : ready ? 'Secondary' : 'Research',
    suggestionReason: outdated
      ? 'Пересмотреть оценку после изменения профиля или оснований'
      : target
        ? 'Сильная среда и коллеги подтверждены'
        : !mature && config.core.preferMatureTeam
          ? 'Уточнить зрелость среды и силу команды'
          : coverage < 60
            ? 'Недостаточно данных для уверенного выбора'
            : 'Проверить пригодность конкретной роли',
    business: assessment && !outdated ? assessment.business.text : '',
    analytics:
      assessment && !outdated
        ? assessment.analytics.text
        : supported.length
          ? `Есть сигналы: ${supported
              .slice(0, 2)
              .map((d) => d.label.toLowerCase())
              .join(', ')}. ${
              missing.length
                ? 'Уточнить: ' +
                  missing
                    .slice(0, 2)
                    .map((d) => d.label.toLowerCase())
                    .join(', ') +
                  '.'
                : 'Глубина практики пока не оценена.'
            }`
          : 'Аналитическая среда пока не оценена. В первую очередь нужны примеры работы команды и взаимодействия с сильными коллегами.',
    strengths: assessment?.strengths || supported.slice(0, 3).map((d) => d.label),
    gaps: assessment?.gaps || missing.slice(0, 3).map((d) => d.label),
    nextStep: outdated
      ? 'Обновить разбор по текущему профилю'
      : assessment?.nextStep ||
        'Уточнить, кто проверяет дизайн экспериментов и с кем аналитик обсуждает методологию.',
    assessmentId: assessment?.id || '',
    assessedAt: assessment?.createdAt || '',
  };
}
export type CompanyFit = ReturnType<typeof companyFit>;
