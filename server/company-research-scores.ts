import type { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import {
  registry,
  summarize,
  matchesCountry,
  type StoredObservation,
} from '../shared/company-research.js';

type Summary = ReturnType<typeof summarize>;
export type ResearchScoreSnapshot = {
  fingerprint: string;
  calculatedAt: string;
  summaries: Record<string, Summary>;
};

// Include the complete rules, not only a version string, when invalidating stored results.
const rules = JSON.stringify(registry);
export function scoreFingerprint(observations: StoredObservation[]) {
  return createHash('sha256').update(rules).update(JSON.stringify(observations)).digest('hex');
}

export function calculateScoreSnapshot(
  observations: StoredObservation[],
  now = Date.now(),
): ResearchScoreSnapshot {
  const countries = new Set<string>();
  for (const o of observations) {
    if (o.scope.country) countries.add(o.scope.country);
    if (o.criterion_id === 'A02_OFFICES' && Array.isArray(o.value))
      for (const country of o.value) if (typeof country === 'string') countries.add(country);
    if (o.criterion_id === 'A05' && o.value)
      for (const country of (o.value as { eligible_countries: string[] }).eligible_countries)
        countries.add(country);
  }
  // '*' represents any country not mentioned by the evidence. Compute equivalent scopes once.
  const summaries: Record<string, Summary> = {};
  const byObservations = new Map<string, Summary>();
  for (const country of ['', '*', ...countries]) {
    const scoped = observations.filter((o) => matchesCountry(o, country));
    const key = JSON.stringify(scoped.map((o) => o.id));
    let summary = byObservations.get(key);
    if (!summary) {
      summary = summarize(scoped, '', now);
      byObservations.set(key, summary);
    }
    summaries[country] = summary;
  }
  return {
    fingerprint: scoreFingerprint(observations),
    calculatedAt: new Date(now).toISOString(),
    summaries,
  };
}

export function saveScoreSnapshot(
  db: DatabaseSync,
  companyId: string,
  snapshot: ResearchScoreSnapshot,
) {
  db.prepare(
    'INSERT INTO company_research_scores (company_id,data) VALUES (?,?) ON CONFLICT(company_id) DO UPDATE SET data=excluded.data',
  ).run(companyId, JSON.stringify(snapshot));
}
