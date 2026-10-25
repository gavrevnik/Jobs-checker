import type { Job, Profile, Source } from './model.js';
import { professionalRole } from './job-fit.js';

// Fixed comparison contract; independent of the active search profile and its keywords.
export const targetVacancyContract = {
  version: '1.1',
  roles: ['product_analyst', 'data_analyst'],
  levels: ['middle', 'senior'],
  openWithinDays: 30,
  history: 'all_saved',
} as const;
export function targetLevel(
  job: Pick<Job, 'title' | 'seniority'> & Partial<Pick<Job, 'description'>>,
  profile?: Profile,
): 'intern' | 'junior' | 'middle' | 'senior' | 'lead' | 'review' | null {
  if (profile?.selection?.roleFamilies.length) {
    const result = professionalRole(job, profile);
    return result === 'excluded' ? null : result;
  }
  const title = job.title;
  if (
    !/\b(?:product(?:\s*(?:&|and|\/)\s*data)?|product\s+data|data)\s+analyst\b|(?:продуктов[а-яё]*\s+аналитик|аналитик\s+данных)/iu.test(
      title,
    )
  )
    return null;
  if (
    /\b(?:intern|internship|junior|jr|lead|staff|principal|head|director|manager)\b|стаж[её]р|младший|руководител/iu.test(
      title,
    )
  )
    return null;
  if (['intern', 'junior', 'lead'].includes(job.seniority)) return null;
  if (job.seniority === 'middle' || job.seniority === 'senior') return job.seniority;
  if (/\b(?:senior|sr)\b|старший/iu.test(title)) return 'senior';
  if (/\b(?:mid|middle|mid-level|II)\b/i.test(title)) return 'middle';
  return null;
}
export type JobPresence = {
  sourceId: string;
  jobId: string;
  lastSeenAt: string;
  missingCount: number;
};
const officialProviders = new Set(['greenhouse', 'lever', 'ashby', 'smartrecruiters']);
export const availabilityLabels = {
  open: 'Подтверждена открытость',
  unverified: 'Открытость не подтверждена',
  stale: 'Устаревшая запись',
  closed: 'Закрыта',
};
export type AvailabilityState = keyof typeof availabilityLabels;

export function jobAvailability(
  job: Job,
  observations: JobPresence[],
  now = Date.now(),
  sources: Pick<Source, 'id' | 'provider' | 'lastSync'>[] = [],
) {
  const time = (s: string) => Date.parse(s);
  const valid = (s: string) => Number.isFinite(time(s)) && time(s) <= now + 60000;
  const fresh = (s: string) =>
    valid(s) && time(s) >= now - targetVacancyContract.openWithinDays * 86400000;
  const latest = (xs: string[]) =>
    xs
      .filter(valid)
      .sort((a, b) => time(a) - time(b))
      .at(-1) || '';
  const seen = observations.filter((o) => o.jobId === job.id);
  const checkedAt = latest([...seen.map((o) => o.lastSeenAt), job.lastSeenAt]);
  const official = (id: string) => {
    const source = sources.find((s) => s.id === id);
    const provider =
      source?.provider ||
      (id.startsWith('discovery:')
        ? id.split(':')[1]
        : id && id === job.sourceId
          ? job.source
          : '');
    return officialProviders.has(provider);
  };
  const evidence: { state: 'open' | 'closed'; at: string; reason: string; url: string }[] = [];
  for (const o of seen.filter((o) => official(o.sourceId))) {
    if (o.missingCount >= 2) {
      // missingCount is only meaningful for complete official board snapshots.
      const at = sources.find((s) => s.id === o.sourceId)?.lastSync || o.lastSeenAt;
      if (valid(at))
        evidence.push({ state: 'closed', at, reason: 'official_snapshot_missing', url: '' });
    } else if (valid(o.lastSeenAt)) {
      evidence.push({
        state: 'open',
        at: o.lastSeenAt,
        reason: 'official_observation',
        url: job.url,
      });
    }
  }
  // Legacy official postings retain their dated provenance. Never borrow a date
  // from an aggregator observation to refresh an earlier official confirmation.
  if (!seen.length && officialProviders.has(job.source) && valid(job.lastSeenAt))
    evidence.push({
      state: 'open',
      at: job.lastSeenAt,
      reason: 'official_observation',
      url: job.url,
    });
  const verification = job.availabilityVerification;
  if (verification && valid(verification.checkedAt))
    evidence.push({
      state: verification.state,
      at: verification.checkedAt,
      reason: 'official_verification',
      url: verification.url,
    });
  evidence.sort(
    (a, b) =>
      time(b.at) - time(a.at) || Number(b.state === 'closed') - Number(a.state === 'closed'),
  );
  const confirmed = evidence[0];
  const observedAt = latest([checkedAt, confirmed?.at || '']);
  const state: AvailabilityState =
    confirmed?.state === 'closed'
      ? 'closed'
      : confirmed && fresh(confirmed.at)
        ? 'open'
        : fresh(observedAt) || !observedAt
          ? 'unverified'
          : 'stale';
  return {
    state,
    // Kept for API compatibility; this is observation time, not proof of openness.
    checkedAt: observedAt,
    verifiedAt: confirmed?.at || '',
    verificationUrl: confirmed?.url || '',
    reason:
      state === 'open' || state === 'closed'
        ? confirmed!.reason
        : observedAt
          ? 'observation_only'
          : 'undated',
  };
}
