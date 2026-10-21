import type { Job } from './model.js';
import { jobAvailability, type JobPresence } from './target-vacancies.js';

/** Saved source text, independent of ATS visibility, target grade and search profile. */
export function companyJobMaterials(
  companyId: string,
  jobs: Job[],
  observations: JobPresence[],
  now = Date.now(),
) {
  return jobs
    .filter((job) => job.companyId === companyId && job.description.trim())
    .map((job) => {
      const availability = jobAvailability(job, observations, now);
      const historical = availability.state !== 'open';
      return {
        origin: 'saved_ats' as const,
        // Keep source content, not personal notes, AI conclusions or CRM history.
        job: {
          id: job.id,
          companyId: job.companyId,
          company: job.company,
          title: job.title,
          url: job.url,
          location: job.location,
          seniority: job.seniority,
          workMode: job.workMode,
          description: job.description,
        },
        provider: job.source,
        sourceId: job.sourceId,
        availability,
        researchUse: historical ? ('historical' as const) : ('current_role' as const),
        publishedAt: job.publishedAt,
        // Reading a saved description does not refresh its source observation.
        observedAt: availability.checkedAt,
        savedAt: job.createdAt,
        scope: {
          role: job.title,
          ...(job.url ? { job_url: job.url } : {}),
          ...(job.seniority !== 'unknown' ? { level: job.seniority } : {}),
          ...(historical ? { context: 'historical_job' } : {}),
        },
      };
    });
}
