import type { JobInput, Profile } from './model.js';
import { locateJob } from '../src/analytics.js';
import type { Scenario } from './selection-profile.js';
import { canonicalUrl } from './model.js';
import { stale, type StoredObservation } from './company-research.js';

export function professionalRole(job: Pick<JobInput, 'title' | 'seniority'>, profile: Profile) {
  const t = job.title;
  const families = profile.selection?.roleFamilies || [];
  const matches =
    !families.length ||
    (families.includes('product_analytics') &&
      /product.*analy|продуктов.*аналит|аналит.*продукт/iu.test(t)) ||
    (families.includes('data_analytics') && /data\s+analyst|аналитик\s+данных/iu.test(t)) ||
    (families.includes('decision_science') &&
      /decision\s+scientist|(?:data\s+scientist.*(?:product|insights|decision|growth)|(?:product|insights|decision|growth).*data\s+scientist)/iu.test(
        t,
      )) ||
    (families.includes('analytics_lead') &&
      /(?:analytics|аналитик).*(?:lead|head|manager|руковод)|(?:lead|head|manager|руковод).*analyt/iu.test(
        t,
      ));
  if (!matches) return 'excluded' as const;
  let level = job.seniority;
  if (/\b(intern|junior|jr)\b|стаж[её]р|младший/iu.test(t)) level = 'junior';
  else if (/\b(lead|staff|principal|head|director|manager)\b|руководител/iu.test(t)) level = 'lead';
  else if (/\b(senior|sr)\b|старший/iu.test(t)) level = 'senior';
  else if (/\b(mid|middle|mid-level|II)\b/iu.test(t)) level = 'middle';
  if (level === 'unknown') return 'review' as const;
  const desired = profile.seniority;
  if (
    desired !== 'any' &&
    (desired === 'middle_plus' ? !['middle', 'senior', 'lead'].includes(level) : desired !== level)
  )
    return 'excluded' as const;
  return level;
}
export function locationMatch(
  location: string,
  requested: string[],
): 'match' | 'unknown' | 'mismatch' {
  if (!requested.length) return 'match';
  const places = locateJob(location);
  if (
    requested.some((l) => {
      const wanted = locateJob(l);
      if (wanted.length)
        return wanted.some((w) =>
          places.some((p) => (w.kind === 'country' ? p.code === w.code : p.id === w.id)),
        );
      return !!l.trim() && location.toLowerCase().includes(l.toLowerCase());
    })
  )
    return 'match';
  return places.length ? 'mismatch' : 'unknown';
}
export function scenarioFit(
  job: JobInput,
  scenario: Scenario | undefined,
  observations: StoredObservation[],
) {
  const questions: string[] = [],
    blockers: string[] = [];
  if (!scenario)
    return { status: 'not_selected', questions, blockers, label: 'Без ограничений географии' };
  const geo = locationMatch(job.location, scenario.locations);
  if (geo === 'unknown') questions.push('Доступна ли работа из выбранной страны');
  if (geo === 'mismatch') blockers.push('Другая география');
  if (scenario.workMode !== 'any' && job.workMode === 'unknown') questions.push('Формат работы');
  const countries = locateJob(job.location).map((p) => p.code);
  const facts = observations.filter(
    (o) =>
      o.verifiedAt &&
      !o.rejected &&
      o.confidence !== 'low' &&
      !stale(o) &&
      (!o.scope.job_url ||
        (!!job.url && canonicalUrl(o.scope.job_url) === canonicalUrl(job.url))) &&
      (!o.scope.country || countries.includes(o.scope.country)) &&
      (!o.scope.role || o.scope.role.toLowerCase() === job.title.toLowerCase()),
  );
  for (const [required, id, label] of [
    [scenario.sponsorship === 'required', 'A04', 'Визовая поддержка'],
    [scenario.relocation === 'required', 'A04_RELOCATION', 'Помощь с релокацией'],
  ] as const) {
    if (!required) continue;
    const values = facts.filter((o) => o.criterion_id === id).map((o) => o.value);
    if (values.includes(false) && !values.includes(true)) blockers.push(label + ' не предлагается');
    else if (!values.includes(true) || values.includes(false)) questions.push(label);
  }
  if (scenario.languages.length) {
    const lang = (v: string) =>
      ({
        english: 'en',
        английский: 'en',
        russian: 'ru',
        русский: 'ru',
        spanish: 'es',
        испанский: 'es',
        french: 'fr',
        французский: 'fr',
        german: 'de',
        немецкий: 'de',
      })[v.trim().toLowerCase()] || v.trim().toLowerCase();
    const languageFacts = facts.filter((o) => o.criterion_id === 'A01' && Array.isArray(o.value));
    const compatible = languageFacts.some((o) =>
      (o.value as string[]).some((v) => scenario.languages.map(lang).includes(lang(v))),
    );
    if (!compatible) questions.push('Рабочий язык: ' + scenario.languages.join(', '));
  }
  if (scenario.minSalary !== null && job.salaryMin === null) questions.push('Компенсация');
  return {
    status: blockers.length ? 'blocker' : questions.length ? 'unknown' : 'compatible',
    questions,
    blockers,
    label: blockers.length
      ? 'Есть ограничение'
      : questions.length
        ? 'Уточнить условия'
        : 'По известным условиям подходит',
  };
}
