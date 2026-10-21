import type { CompanyResearch } from '../server/company-research';
import { canonicalUrl } from '../shared/model';
import { effectiveVerdict, registry } from '../shared/company-research';
import {
  collectTags,
  currentResearchFacts,
  verifiedResearchFacts,
} from '../shared/company-signals';
export type ComparisonProfile = ReturnType<CompanyResearch['profile']>;

type HiringProfile = Pick<ComparisonProfile, 'company' | 'targetVacancies'>;
export function comparisonHiringOffices(profiles: HiringProfile[]) {
  const offices = new Map<
    string,
    { id: string; name: string; country: string; companies: Set<string> }
  >();
  for (const profile of profiles) {
    for (const office of profile.targetVacancies.offices) {
      if (!office.open) continue;
      const entry = offices.get(office.id) || { ...office, companies: new Set<string>() };
      entry.companies.add(profile.company.id);
      offices.set(office.id, entry);
    }
  }
  return [...offices.values()]
    .map(({ companies, ...office }) => ({ ...office, count: companies.size }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru') || a.country.localeCompare(b.country));
}

export function comparisonHiringOfficeMatches(profile: HiringProfile, officeId: string) {
  return !officeId || profile.targetVacancies.offices.some((o) => o.id === officeId && o.open);
}

export function comparisonHiringTags(
  profile: Pick<ComparisonProfile, 'targetVacancies' | 'confirmed'> &
    Partial<Pick<ComparisonProfile, 'observations'>>,
) {
  const confirmed = profile.observations
    ? currentResearchFacts(profile.observations)
    : profile.confirmed;
  const open = profile.targetVacancies.jobs.filter((j) => j.availability.state === 'open');
  const openUrls = new Set(open.filter((j) => j.url).map((j) => canonicalUrl(j.url)));
  const modes = new Set(open.map((j) => j.workMode).filter((mode) => mode !== 'unknown'));
  for (const o of confirmed) {
    if (o.criterion_id !== 'A05' || !open.length) continue;
    if (o.scope.job_url && !openUrls.has(canonicalUrl(o.scope.job_url))) continue;
    // Country/role policies without a job URL must apply to an open target vacancy.
    if (!o.scope.job_url && (o.scope.country || o.scope.city || o.scope.role || o.scope.level))
      continue;
    const value = o.value as { modes: ('remote' | 'hybrid' | 'onsite')[] };
    for (const mode of value.modes) modes.add(mode);
  }
  const aliases: Record<string, string> = {
    en: 'ENG',
    eng: 'ENG',
    english: 'ENG',
    английский: 'ENG',
    ru: 'RU',
    rus: 'RU',
    russian: 'RU',
    русский: 'RU',
    es: 'ES',
    spanish: 'ES',
    испанский: 'ES',
    fr: 'FR',
    french: 'FR',
    французский: 'FR',
    de: 'DE',
    german: 'DE',
    немецкий: 'DE',
    pt: 'PT',
    portuguese: 'PT',
    португальский: 'PT',
  };
  const languages = new Set(
    confirmed
      .filter((o) => o.criterion_id === 'A01')
      .flatMap((o) => o.value as string[])
      .map((v) => aliases[v.trim().toLowerCase()] || v.trim().toUpperCase()),
  );
  const benefits = collectTags();
  for (const o of confirmed) {
    if (o.value !== true) continue;
    if (o.criterion_id === 'A04') benefits.add('visa sponsorship', o);
    if (o.criterion_id === 'A04_RELOCATION') benefits.add('relocation', o);
  }
  return {
    modes: [...modes].sort(),
    languages: [...languages].sort(),
    benefits: benefits.values(),
  };
}

export function uncoveredAvailabilityFacts(profile: ComparisonProfile, now = Date.now()) {
  const covered = new Set(comparisonHiringTags(profile).benefits.flatMap((t) => t.observationIds));
  for (const o of currentResearchFacts(profile.observations, now))
    if (o.criterion_id === 'A01' && Array.isArray(o.value) && o.value.length) covered.add(o.id);
  return verifiedResearchFacts(profile.observations, now).filter(
    (o) =>
      registry.criteria.find((c) => c.id === o.criterion_id)?.section === 'A' &&
      effectiveVerdict(o, now) === 'pass' &&
      !covered.has(o.id),
  );
}

export function comparisonModeMatches(p: ComparisonProfile, mode: string) {
  return (
    mode === 'all' ||
    p.currentJobs.some((j) => j.workMode === mode) ||
    p.confirmed.some(
      (o) => o.criterion_id === 'A05' && (o.value as { modes: string[] }).modes.includes(mode),
    )
  );
}

const countryNames = new Intl.DisplayNames(['ru'], { type: 'region' });
export function headquartersBadges(hq: ComparisonProfile['headquarters']) {
  if (hq.status === 'distributed')
    return [
      {
        code: '',
        flag: '',
        label: 'Распределённая команда',
        tone: 'hq-green',
        title:
          'Компания описывает свою штаб-квартиру как распределённую команду. Единственная страна основного офиса не заявлена.',
      },
    ];
  if (hq.status !== 'verified' || !hq.countries.length)
    return [
      {
        code: '',
        flag: '',
        label:
          hq.status === 'conflicting'
            ? 'Основной офис: конфликт'
            : hq.status === 'pending'
              ? 'Основной офис: на проверке'
              : 'Основной офис: уточнить',
        tone: 'hq-unknown',
        title:
          'Это страна основного офиса, а не страна найма. Подтверждённых данных пока недостаточно.',
      },
    ];
  return hq.countries.map((code) => ({
    code,
    flag: String.fromCodePoint(...code.split('').map((c) => 127397 + c.charCodeAt(0))),
    label: countryNames.of(code) || code,
    tone: ['ES', 'PT', 'IT', 'FR'].includes(code)
      ? 'hq-warm'
      : ['DE', 'NL', 'SE', 'FI', 'DK', 'NO', 'CH', 'AT'].includes(code)
        ? 'hq-blue'
        : ['US', 'CA', 'GB', 'IE'].includes(code)
          ? 'hq-purple'
          : 'hq-green',
    title: `Основной офис / штаб-квартира: ${countryNames.of(code) || code}. Подтверждено источником. Города открытых целевых вакансий показаны отдельно.`,
  }));
}
