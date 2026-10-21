import {
  stale,
  scopeKey,
  valueKey,
  type StoredObservation,
  type SalaryBenchmarkValue,
} from '../shared/company-research';
import {
  collectTags,
  currentResearchFacts,
  factScope,
  type ResearchTag,
} from '../shared/company-signals';
import { canonicalUrl } from '../shared/model';
import { companyInterviewDetails } from '../shared/company-interviews';
import type { ComparisonProfile } from './company-comparison';
import { salaryBenchmarkText } from './salary-benchmark';
import { shortSentences } from './company-presentation';

type Profile = Pick<ComparisonProfile, 'observations' | 'jobs' | 'targetVacancies'>;
export function companyScreening(p: Profile, now = Date.now()) {
  const facts = currentResearchFacts(p.observations, now).sort((a, b) =>
    b.importedAt.localeCompare(a.importedAt),
  );
  const groups = {
    business: collectTags(),
    focus: collectTags(),
    work: collectTags(),
    team: collectTags(),
  };
  // Prefer the latest phrasing of the same fact without hiding independent roles or sources.
  const seen = new Set<string>();
  const openUrls = new Set(
    p.targetVacancies.jobs
      .filter((j) => j.availability.state === 'open')
      .map((j) => canonicalUrl(j.url)),
  );
  for (const o of facts) {
    const key = o.criterion_id + '|' + scopeKey(o.scope) + '|' + valueKey(o.value);
    if (seen.has(key) || !o.short_facts?.length) continue;
    seen.add(key);
    const scoped = !!(o.scope.role || o.scope.job_url);
    const group =
      o.criterion_id === 'B04'
        ? scoped
          ? groups.focus
          : groups.business
        : o.criterion_id === 'AN06' && scoped
          ? groups.focus
          : o.criterion_id === 'B08' && !scoped
            ? groups.business
            : ['AN02', 'AN03', 'P03_PUBLIC'].includes(o.criterion_id)
              ? groups.team
              : o.criterion_id === 'A05' &&
                  o.scope.job_url &&
                  openUrls.has(canonicalUrl(o.scope.job_url))
                ? groups.work
                : null;
    if (!group) continue;
    for (const label of o.short_facts) group.add(label, o);
  }
  // Historical audience figures keep their explicit metric and date, never become MAU by inference.
  const audienceKeys = new Set<string>();
  const audience = facts.filter((o) => {
    if (o.criterion_id !== 'B06' || typeof o.value !== 'string') return false;
    const key = scopeKey(o.scope) + '|' + valueKey(o.value);
    if (audienceKeys.has(key)) return false;
    audienceKeys.add(key);
    return true;
  });
  const traffic = audience.map((o) => {
    const tag = collectTags();
    const date = o.evidence
      .map((e) => e.published_at || e.observed_at)
      .sort()
      .at(-1)
      ?.slice(0, 10);
    const published = o.evidence.some(
      (e) => e.published_at === date || e.published_at?.startsWith(date || '--'),
    );
    tag.add(
      (o.short_facts?.join(' · ') || shortSentences(o.value as string, 1, 170)) +
        (date ? ' · ' + (published ? 'источник ' : 'проверено ') + date : ''),
      o,
    );
    return tag.values()[0];
  });
  // Explicit country eligibility can narrow a current remote role; the country of its office cannot.
  for (const o of facts) {
    if (
      o.criterion_id !== 'A05' ||
      !o.scope.job_url ||
      !openUrls.has(canonicalUrl(o.scope.job_url)) ||
      !o.value ||
      typeof o.value !== 'object' ||
      !('modes' in o.value)
    )
      continue;
    if (o.value.modes.includes('remote') && o.value.eligible_countries.length)
      groups.work.add('Remote · ' + o.value.eligible_countries.join('/'), o);
  }
  const salary = salaryFacts(p.observations, now);
  const interviews = companyInterviewDetails(p.observations, p.jobs, now);
  const currentInterviewIds = new Set(
    facts.filter((o) => o.criterion_id === 'P07_INTERVIEW').map((o) => o.id),
  );
  const assignments = [
    ...new Set(
      facts
        .filter((o) => currentInterviewIds.has(o.id))
        .flatMap((o) => {
          if (
            !o.value ||
            typeof o.value !== 'object' ||
            !('stages' in o.value) ||
            !o.value.assignment
          )
            return [];
          const a = o.value.assignment;
          const label = {
            take_home: 'take-home',
            live: 'live case',
            none: 'без тестового',
            unspecified: '',
          }[a.kind];
          return label
            ? [
                label +
                  (a.duration &&
                  a.duration.length < 30 &&
                  !/не указан|неизвест|не раскрыт|unknown/i.test(a.duration)
                    ? ' · ' + a.duration
                    : ''),
              ]
            : [];
        }),
    ),
  ];
  const withAnswers = (tags: ResearchTag[]) =>
    tags.map((t) => {
      const os = p.observations.filter((o) => t.observationIds.includes(o.id));
      const unique = (xs: string[]) => [...new Set(xs.filter(Boolean))].join('\n');
      return {
        ...t,
        details: [
          unique(os.flatMap((o) => (typeof o.value === 'string' ? [o.value] : []))),
          unique(os.map(factScope)),
          unique(os.map((o) => o.reasoning)),
          'Проверено ' + unique(os.map((o) => o.verifiedAt?.slice(0, 10) || '')),
          unique(
            os.flatMap((o) =>
              o.evidence.map((e) =>
                [
                  e.title,
                  e.url,
                  e.published_at ? 'Опубликовано ' + e.published_at.slice(0, 10) : '',
                  'Прочитано ' + e.observed_at.slice(0, 10),
                ]
                  .filter(Boolean)
                  .join('\n'),
              ),
            ),
          ),
        ]
          .filter(Boolean)
          .join('\n\n'),
      };
    });
  return {
    business: withAnswers(groups.business.values()),
    focus: withAnswers(groups.focus.values()),
    work: groups.work.values(),
    team: withAnswers(groups.team.values()),
    traffic: withAnswers(traffic),
    salary,
    interview: {
      visible: interviews.length > 0,
      label:
        'Интервью' +
        (assignments.length > 1
          ? ' · зависит от роли'
          : assignments.length
            ? ' · ' + assignments[0]
            : ''),
      details: interviews
        .map((i) => [i.scope, i.notice, i.text, ...i.sources.map((s) => s.url)].join('\n'))
        .join('\n\n'),
    },
  };
}
function salaryFacts(observations: StoredObservation[], now: number): ResearchTag[] {
  const candidates = observations.filter(
    (o) =>
      o.criterion_id === 'A07_SALARY_BENCHMARK' &&
      !o.rejected &&
      o.verifiedAt &&
      o.confidence !== 'low' &&
      !stale(o, now) &&
      o.value &&
      o.evidence.some((e) => e.source_type === 'market_estimate'),
  );
  const groups = new Map<string, StoredObservation[]>();
  for (const o of candidates) {
    const v = o.value as SalaryBenchmarkValue;
    const key =
      scopeKey(o.scope) + '|' + [v.component, v.statistic, v.currency, v.period].join('|');
    groups.set(key, [...(groups.get(key) || []), o]);
  }
  return [...groups.values()]
    .flatMap((g) => {
      g.sort(
        (a, b) =>
          ((b.value as SalaryBenchmarkValue).source_updated_at || '').localeCompare(
            (a.value as SalaryBenchmarkValue).source_updated_at || '',
          ) || b.importedAt.localeCompare(a.importedAt),
      );
      const o = g[0],
        v = o.value as SalaryBenchmarkValue;
      if (
        g.some(
          (x) =>
            (x.value as SalaryBenchmarkValue).source_updated_at === v.source_updated_at &&
            valueKey({
              amount: (x.value as SalaryBenchmarkValue).amount,
              min: (x.value as SalaryBenchmarkValue).min,
              max: (x.value as SalaryBenchmarkValue).max,
            }) !== valueKey({ amount: v.amount, min: v.min, max: v.max }),
        )
      )
        return [];
      const money = (n: number) =>
        new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
      const amount =
        v.statistic === 'range'
          ? [v.min === null ? '' : 'от ' + money(v.min), v.max === null ? '' : 'до ' + money(v.max)]
              .filter(Boolean)
              .join(' ')
          : money(v.amount!);
      const component = {
        total: 'TC',
        base: 'base',
        stock: 'equity',
        bonus: 'бонус',
        sign_on: 'sign-on',
      }[v.component];
      const statistic = {
        median: 'медиана',
        mean: 'среднее',
        range: 'диапазон',
        individual: 'одно сообщение',
      }[v.statistic];
      const label = `≈${amount} ${v.currency} ${component}/${{ year: 'год', month: 'мес.', hour: 'час' }[v.period]} · ${o.scope.role} · ${o.scope.country}${v.role_relation === 'related' ? ' · смежная роль' : ''}`;
      return [
        {
          label,
          scope: factScope(o),
          countries: [o.scope.country!],
          observationIds: [o.id],
          details: [
            statistic,
            salaryBenchmarkText(v),
            factScope(o),
            'Проверено ' + o.verifiedAt?.slice(0, 10),
            ...o.evidence.map((e) => e.url),
          ].join('\n'),
        },
      ];
    })
    .sort(
      (a, b) => Number(a.label.includes('смежная роль')) - Number(b.label.includes('смежная роль')),
    );
}
