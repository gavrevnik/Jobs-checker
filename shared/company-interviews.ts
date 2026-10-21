import type { Job } from './model.js';
import { canonicalUrl } from './model.js';
import { stale, type StoredObservation, type Observation } from './company-research.js';

export type InterviewValue = Extract<NonNullable<Observation['value']>, { stages: unknown }>;
type InterviewJob = Job & { checkedAt?: string };
export function interviewText(value: InterviewValue) {
  return [
    value.summary,
    ...value.stages.map(
      (s, i) =>
        `${i + 1}. ${s.title}${s.duration ? ' · ' + s.duration : ''}${s.details ? '\n' + s.details : ''}`,
    ),
    value.assignment
      ? `Тестовое задание: ${{ take_home: 'домашнее', live: 'в ходе интервью', none: 'не предусмотрено', unspecified: 'формат не уточнён' }[value.assignment.kind]}${value.assignment.duration ? ' · ' + value.assignment.duration : ''}. ${value.assignment.details}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Extract only an explicit process section, never generic hiring/accommodation footers. */
export function extractInterviewSection(description: string) {
  const lines = description.replace(/\r/g, '').split('\n');
  const start = lines.findIndex(
    (line) =>
      /^(?:our |the )?(?:hiring|interview|recruitment) (?:process|stages|steps)\s*[:?]?$/i.test(
        line.trim(),
      ) || /^(?:what does|what to expect)\b.{0,80}\bhiring process\b/i.test(line.trim()),
  );
  if (start < 0) return '';
  const end = lines.findIndex(
    (line, i) =>
      i > start &&
      /^(?:diversity|equal opportunit|about (?:us|the company)|benefits|privacy|data protection|notice to candidates|why you.ll love|you should know)\b/i.test(
        line.trim(),
      ),
  );
  const text = lines
    .slice(start + 1, end < 0 ? undefined : end)
    .join('\n')
    .trim()
    .slice(0, 10000);
  const stages = [
    /screening|intro(?:duction)? call|recruiter (?:call|interview)|talent (?:manager|acquisition)/i,
    /technical interview|technical assessment|live.{0,20}(?:exercise|coding)/i,
    /take.home|business case|\btask\s*[-–—:]|assignment/i,
    /culture fit|team (?:interview|fit)|meet the team|values interview/i,
    /reference check|\boffer\b|final interview/i,
  ].filter((re) => re.test(text)).length;
  const explicitSingleStep =
    /\btake.home (?:assignment|task|exercise|test)\b|\b(?:screening call|technical interview)\b.{0,80}\b(?:min|minutes?|hours?|hr)\b|\bno (?:take.home|homework) (?:task|assignment|test)\b/i.test(
      text,
    );
  return stages >= 2 || explicitSingleStep ? text : '';
}
export type InterviewDetail = {
  id: string;
  role: string;
  scope: string;
  text: string;
  notice: string;
  sources: StoredObservation['evidence'];
  observationIds: string[];
};
export function companyInterviewDetails(
  observations: StoredObservation[],
  jobs: InterviewJob[] = [],
  now = Date.now(),
): InterviewDetail[] {
  const facts = observations
    .filter(
      (o) =>
        !o.rejected &&
        o.criterion_id === 'P07_INTERVIEW' &&
        o.value &&
        typeof o.value === 'object' &&
        'stages' in o.value,
    )
    .sort(
      (a, b) =>
        Number(!!b.verifiedAt) - Number(!!a.verifiedAt) || b.importedAt.localeCompare(a.importedAt),
    );
  const result: InterviewDetail[] = [],
    covered = new Set<string>(),
    seen = new Set<string>();
  for (const o of facts) {
    const text = interviewText(o.value as InterviewValue);
    const scope = [o.scope.country, o.scope.city, o.scope.role, o.scope.level]
      .filter(Boolean)
      .join(' · ');
    const key = [text, scope, o.scope.job_url].join('|');
    if (!seen.has(key))
      result.push({
        id: o.id,
        role: o.scope.role || 'Процесс компании',
        scope,
        text,
        notice: [
          !o.verifiedAt ? 'Не проверено' : 'Источник проверен',
          o.verifiedAt && stale(o, now) ? 'Устаревшие сведения' : '',
          o.confidence === 'low' ? 'Низкая уверенность' : '',
          o.evidence.some((e) => e.source_type === 'employee_report')
            ? 'Рассказ кандидата / отзыв, не официальное условие'
            : '',
        ]
          .filter(Boolean)
          .join(' · '),
        sources: o.evidence,
        observationIds: [o.id],
      });
    seen.add(key);
    // A dated observation of this job supersedes only that exact saved job's raw process section.
    if (o.scope.job_url) covered.add(canonicalUrl(o.scope.job_url));
  }
  for (const job of jobs) {
    if (!job.url || covered.has(canonicalUrl(job.url))) continue;
    const text = extractInterviewSection(job.description);
    if (!text) continue;
    covered.add(canonicalUrl(job.url));
    result.push({
      id: 'job-interview:' + job.id,
      role: job.title,
      scope: [job.location, job.title].filter(Boolean).join(' · '),
      text,
      notice:
        'Из сохранённой вакансии · не проверено' +
        (job.checkedAt || job.lastSeenAt
          ? ' · наблюдение ' + (job.checkedAt || job.lastSeenAt).slice(0, 10)
          : '') +
        (Date.parse(job.checkedAt || job.lastSeenAt || job.createdAt) < now - 180 * 86400000
          ? ' · Устаревшие сведения'
          : ''),
      sources: [
        {
          url: job.url,
          title: job.title,
          source_type: 'job',
          observed_at: job.checkedAt || job.lastSeenAt || job.createdAt,
          excerpt: text,
        },
      ],
      observationIds: [],
    });
  }
  return result;
}
