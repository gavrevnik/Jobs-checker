import type { Job } from './model.js';
import type { AvailabilityState } from './target-vacancies.js';

export function jobReviewCategory(job: Job) {
  return job.catalogReview?.category ?? job.discoveryAssessment?.category ?? 'uncertain';
}

export function pipelineSection(job: Job, availability?: { state: AvailabilityState }) {
  const category = jobReviewCategory(job);
  if (job.demo || category === 'reject') return 'hidden';
  if (job.stage === 'archived' || availability?.state === 'closed') return 'history';
  if (availability?.state === 'open' && (category === 'target' || category === 'practice'))
    return 'working';
  return 'review';
}
