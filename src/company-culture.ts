import { stale, scopeKey, valueKey, type StoredObservation } from '../shared/company-research';
import { shortSentences } from './company-presentation';
import { companyResearchTags } from '../shared/company-signals';

export function companyCulture(observations: StoredObservation[], now = Date.now()) {
  const known = observations.filter(
    (o) => !o.rejected && o.verifiedAt && o.confidence !== 'low' && !stale(o, now),
  );
  const signals = known.filter(
    (o) =>
      o.criterion_id === 'AN09_CULTURE' &&
      o.value &&
      typeof o.value === 'object' &&
      !Array.isArray(o.value) &&
      'summary' in o.value,
  );
  const summaries: string[] = [];
  for (const o of signals.sort((a, b) => b.importedAt.localeCompare(a.importedAt))) {
    const v = o.value as { summary: string; tags: string[] };
    summaries.push(v.summary);
  }
  const blogs = new Map<string, { url: string; title: string }>(),
    github = new Map<string, { url: string; title: string }>();
  for (const o of observations.filter(
    (o) => !o.rejected && o.verifiedAt && o.confidence !== 'low' && /^(AN|T)/.test(o.criterion_id),
  ))
    for (const e of o.evidence) {
      const url = new URL(e.url);
      if (url.hostname === 'github.com' && url.pathname.split('/').filter(Boolean).length)
        github.set(e.url, { url: e.url, title: e.title });
      else if (e.source_type === 'engineering') blogs.set(e.url, { url: e.url, title: e.title });
    }
  const trafficKeys = new Set<string>();
  const traffic = observations
    .filter((o) => !o.rejected && o.verifiedAt && o.confidence !== 'low')
    .filter((o) => o.criterion_id === 'B06' && typeof o.value === 'string')
    .filter((o) => {
      const key = valueKey(o.value) + '|' + scopeKey(o.scope) + '|' + JSON.stringify(o.evidence);
      if (trafficKeys.has(key)) return false;
      trafficKeys.add(key);
      return true;
    })
    .map((o) => ({
      text: o.value as string,
      date:
        o.evidence
          .map((e) => e.published_at || e.observed_at)
          .sort()
          .at(-1) || '',
      id: o.id,
    }));
  return {
    tags: companyResearchTags(observations, now).culture,
    summary: [...new Set(summaries)].join(' '),
    preview: shortSentences(summaries.join(' '), 2, 350),
    blogs: [...blogs.values()],
    github: [...github.values()],
    traffic,
  };
}
