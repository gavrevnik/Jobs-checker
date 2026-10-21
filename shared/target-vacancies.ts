import type { Job, Profile } from './model.js';
import { professionalRole } from './job-fit.js';

// Fixed comparison contract; independent of the active search profile and its keywords.
export const targetVacancyContract = {
  version: '1.0',
  roles: ['product_analyst', 'data_analyst'],
  levels: ['middle', 'senior'],
  openWithinDays: 30,
  history: 'all_saved',
} as const;
export function targetLevel(
  job: Pick<Job, 'title' | 'seniority'>,
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
export function jobAvailability(job: Job, observations: JobPresence[], now = Date.now()) {
  const valid = (s: string) => Number.isFinite(Date.parse(s)) && Date.parse(s) <= now + 60000;
  const seen = observations.filter((o) => o.jobId === job.id);
  const checkedAt =
    [...seen.map((o) => o.lastSeenAt), job.lastSeenAt].filter(valid).sort().at(-1) || '';
  const fresh = (s: string) =>
    valid(s) && Date.parse(s) >= now - targetVacancyContract.openWithinDays * 86400000;
  const missing = seen.length > 0 && seen.every((o) => o.missingCount >= 2);
  const state =
    job.stage === 'archived' || missing
      ? 'closed'
      : seen.length
        ? seen.some((o) => o.missingCount < 2 && fresh(o.lastSeenAt))
          ? 'open'
          : checkedAt
            ? 'stale'
            : 'unverified'
        : fresh(checkedAt)
          ? 'open'
          : checkedAt
            ? 'stale'
            : 'unverified';
  return { state: state as 'open' | 'closed' | 'stale' | 'unverified', checkedAt };
}
