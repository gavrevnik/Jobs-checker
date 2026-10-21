import {
  canonicalUrl,
  providerLabels,
  type Job,
  type Source,
  type Profile,
} from '../shared/model.js';
import { acceptsJob, searchSchema } from '../shared/source-tools.js';
import { scenarioFit } from '../shared/job-fit.js';
import type { Scenario } from '../shared/selection-profile.js';
import type { StoredObservation } from '../shared/company-research.js';
import {
  jobAvailability,
  targetLevel,
  targetVacancyContract,
  type JobPresence,
} from '../shared/target-vacancies.js';
import { locateJob } from '../src/analytics.js';

function boardUrl(source: Source) {
  const board = encodeURIComponent(source.board);
  switch (source.provider) {
    case 'greenhouse':
      return `https://job-boards.greenhouse.io/${board}`;
    case 'ashby':
      return `https://jobs.ashbyhq.com/${board}`;
    case 'lever':
      return `https://jobs.${source.region === 'eu' ? 'eu.' : ''}lever.co/${board}`;
    case 'smartrecruiters':
      return `https://careers.smartrecruiters.com/${board}`;
    default:
      return '';
  }
}
export function companyTargetVacancies(
  companyId: string,
  allJobs: Job[],
  allSources: Source[],
  observations: JobPresence[],
  now = Date.now(),
  profile?: Profile,
  scenario?: Scenario,
  research: StoredObservation[] = [],
) {
  const matching = allJobs.filter(
    (j) =>
      j.companyId === companyId &&
      targetLevel(j, profile) &&
      (!profile || acceptsJob(j, searchSchema.parse({}), profile)),
  );
  // ATS IDs are the navigation contract; a repeated URL never inflates the counters.
  const grouped = new Map<string, Job[]>();
  for (const job of matching) {
    const key = job.url ? canonicalUrl(job.url) : job.id;
    grouped.set(key, [...(grouped.get(key) || []), job]);
  }
  const jobs = [...grouped.values()]
    .map((copies) => {
      const ranked = copies
        .map((j) => ({ j, availability: jobAvailability(j, observations, now) }))
        .sort(
          (a, b) =>
            Number(b.availability.state === 'open') - Number(a.availability.state === 'open') ||
            b.availability.checkedAt.localeCompare(a.availability.checkedAt),
        );
      const { j, availability } = ranked[0];
      return {
        ...j,
        atsJobIds: copies.map((c) => c.id),
        targetLevel: targetLevel(j, profile)!,
        availability,
        scenarioFit: scenarioFit(j, scenario, research),
        openCityIds: copies
          .filter((c) => jobAvailability(c, observations, now).state === 'open')
          .flatMap((c) => locateJob(c.location))
          .filter((p) => p.kind === 'city')
          .map((p) => p.id),
        cities: [
          ...new Map(
            copies
              .flatMap((c) => locateJob(c.location))
              .filter((p) => p.kind === 'city')
              .map((p) => [p.id, { id: p.id, name: p.name, country: p.code }]),
          ).values(),
        ],
      };
    })
    .sort(
      (a, b) =>
        Number(b.availability.state === 'open') - Number(a.availability.state === 'open') ||
        a.title.localeCompare(b.title),
    );
  const offices = new Map<string, { id: string; name: string; country: string; open: boolean }>();
  const closedOffices = new Map<string, { id: string; name: string; country: string }>();
  for (const job of jobs)
    for (const city of job.cities) {
      offices.set(city.id, {
        ...city,
        open: !!offices.get(city.id)?.open || job.openCityIds.includes(city.id),
      });
      if (job.availability.state === 'closed') closedOffices.set(city.id, city);
    }
  const sources = new Map<string, { id: string; label: string; url: string; updatedAt: string }>();
  const add = (id: string, label: string, url: string, updatedAt: string) => {
    const old = sources.get(id);
    sources.set(id, {
      id,
      label,
      url,
      updatedAt: [old?.updatedAt || '', updatedAt].sort().at(-1)!,
    });
  };
  const linkedSources = allSources.filter(
    (s) =>
      (s.companyId === companyId && !!s.lastSync) ||
      matching.some((j) => j.sourceId === s.id) ||
      observations.some((o) => o.sourceId === s.id && matching.some((j) => j.id === o.jobId)),
  );
  for (const s of linkedSources)
    add(
      s.id,
      `${providerLabels[s.provider] || s.provider} · ${s.name}`,
      boardUrl(s),
      [
        s.lastSync || '',
        ...observations
          .filter((o) => o.sourceId === s.id && matching.some((j) => j.id === o.jobId))
          .map((o) => o.lastSeenAt),
      ]
        .sort()
        .at(-1) || '',
    );
  for (const job of matching) {
    const presence = observations.filter((o) => o.jobId === job.id);
    const links = presence.map((o) => o.sourceId);
    // Search adapters use virtual source IDs, not rows in sources. Preserve their
    // attribution even when URL dedupe kept an older imported ATS card.
    for (const o of presence) {
      const provider = o.sourceId.replace(/^discovery:/, '');
      if (o.sourceId.startsWith('discovery:') && providerLabels[provider])
        add(`provider:${provider}`, providerLabels[provider], '', o.lastSeenAt);
    }
    if (![job.sourceId, ...links].some((id) => linkedSources.some((s) => s.id === id))) {
      // A job's own observation is dated; editedAt/createdAt do not prove a provider refresh.
      add(
        `provider:${job.source}`,
        providerLabels[job.source] || job.source,
        '',
        jobAvailability(job, observations, now).checkedAt,
      );
    }
  }
  return {
    contract: profile?.selection?.roleFamilies.length
      ? {
          ...targetVacancyContract,
          version: '2.0',
          roleFamilies: profile.selection.roleFamilies,
          profileVersion: profile.selection.version,
          scenarioId: profile.selection.scenarioId,
        }
      : targetVacancyContract,
    companyId,
    total: jobs.length,
    open: jobs.filter((j) => j.availability.state === 'open').length,
    closed: jobs.filter((j) => j.availability.state === 'closed').length,
    needsReview: jobs.filter((j) => ['stale', 'unverified'].includes(j.availability.state)).length,
    jobIds: jobs.map((j) => j.id),
    jobs,
    offices: [...offices.values()].sort(
      (a, b) => Number(b.open) - Number(a.open) || a.name.localeCompare(b.name),
    ),
    openOffices: [...offices.values()]
      .filter((o) => o.open)
      .sort((a, b) => a.name.localeCompare(b.name)),
    closedOffices: [...closedOffices.values()].sort((a, b) => a.name.localeCompare(b.name)),
    sources: [...sources.values()],
  };
}
