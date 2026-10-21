import { companyResearchTags, factScope } from '../shared/company-signals';
import { stale, scopeKey, type StoredObservation } from '../shared/company-research';

export function companyInfrastructure(observations: StoredObservation[], now = Date.now()) {
  const tags = companyResearchTags(observations, now).infrastructure;
  const taggedIds = new Set(tags.flatMap((t) => t.observationIds));
  const facts = observations.filter(
    (o) =>
      !o.rejected &&
      o.value !== null &&
      (o.criterion_id === 'T08_INFRA' ||
        ['T02', 'T06'].includes(o.criterion_id) ||
        (o.criterion_id === 'AN09_CULTURE' && taggedIds.has(o.id))),
  );
  // Prefer dedicated summaries; older mixed summaries remain a fallback for the existing catalogue.
  const dedicated = new Set(
    facts
      .filter(
        (o) =>
          o.criterion_id === 'T08_INFRA' &&
          o.verifiedAt &&
          o.confidence !== 'low' &&
          !stale(o, now),
      )
      .map((o) => scopeKey(o.scope)),
  );
  const seen = new Set<string>();
  return {
    tags,
    summaries: facts
      .filter((o) => o.criterion_id !== 'AN09_CULTURE' || !dedicated.has(scopeKey(o.scope)))
      .sort(
        (a, b) => Number(b.criterion_id === 'T08_INFRA') - Number(a.criterion_id === 'T08_INFRA'),
      )
      .flatMap((o) => {
        const text =
          typeof o.value === 'object' && o.value && 'summary' in o.value
            ? o.value.summary
            : o.reasoning;
        const scope = factScope(o),
          key = text + '|' + scope;
        if (!text || seen.has(key)) return [];
        seen.add(key);
        return [
          {
            id: o.id,
            text,
            scope,
            notice: [
              !o.verifiedAt ? 'Не проверено' : '',
              o.confidence === 'low' ? 'Низкая уверенность' : '',
              o.verifiedAt && stale(o, now) ? 'Устаревшие сведения' : '',
            ]
              .filter(Boolean)
              .join(' · '),
            sources: o.evidence,
          },
        ];
      }),
  };
}
