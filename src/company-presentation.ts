import { companyTypeLabels, type Company } from '../shared/model';
import { stale, type StoredObservation } from '../shared/company-research';

export const cleanCompanyText = (value: string) =>
  value
    .replace(/<[^>]*>/g, ' ')
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
export function shortSentences(value: string, count = 1, limit = 220) {
  const text = cleanCompanyText(value);
  const sentences = [...new Intl.Segmenter('ru', { granularity: 'sentence' }).segment(text)]
    .slice(0, count)
    .map((s) => s.segment.trim())
    .join(' ');
  if (sentences.length <= limit) return sentences;
  const cut = sentences.slice(0, limit - 1);
  return (
    cut
      .slice(0, cut.lastIndexOf(' ') > limit / 2 ? cut.lastIndexOf(' ') : cut.length)
      .replace(/[ ,;:]+$/, '') + '…'
  );
}
const sizeLabels: Record<Company['sizeCategory'], string> = {
  unknown: '',
  small: 'Небольшая',
  medium: 'Средняя',
  growth: 'Растущая',
  large: 'Крупная',
  enterprise: 'Очень крупная',
};
export function compactCompanySize(company: Company) {
  if (
    company.sizeCategory === 'unknown' &&
    /не подтвержден|не раскрыт|неизвестн/i.test(company.size)
  )
    return '—';
  const numeric = cleanCompanyText(company.size).split(/;|\sпо\s|\sсотрудник|\sчеловек/i)[0];
  const people = numeric
    .match(/(?:более\s+|около\s+|до\s+|от\s+|~\s*)?\d[\d\s,.]*(?:[–—-]\s*\d[\d\s,.]*)?\+?/i)?.[0]
    .trim();
  return (
    [sizeLabels[company.sizeCategory], people ? `${people} человек` : '']
      .filter(Boolean)
      .join(' · ') || '—'
  );
}
export function companyPresentation(company: Company, observations: StoredObservation[]) {
  const business = observations
    .filter(
      (o) =>
        !o.rejected &&
        o.criterion_id === 'B04' &&
        !o.scope.role &&
        !o.scope.job_url &&
        typeof o.value === 'string' &&
        o.value.trim(),
    )
    .sort(
      (a, b) =>
        Number(!!b.verifiedAt && !stale(b)) - Number(!!a.verifiedAt && !stale(a)) ||
        b.importedAt.localeCompare(a.importedAt),
    );
  const verified = business.find((o) => o.verifiedAt && o.confidence !== 'low' && !stale(o));
  const description =
    (verified?.value as string | undefined) ||
    company.description ||
    (business[0]?.value as string | undefined) ||
    '';
  const blogs = new Map<string, { url: string; title: string }>();
  for (const o of observations.filter((o) => !o.rejected && /^(AN|T)/.test(o.criterion_id))) {
    for (const e of o.evidence)
      if (e.source_type === 'engineering' && /^https?:\/\//.test(e.url)) {
        if (!blogs.has(e.url))
          blogs.set(e.url, { url: e.url, title: e.title || new URL(e.url).hostname });
      }
  }
  return {
    businessType: company.companyType === 'other' ? '' : companyTypeLabels[company.companyType],
    size: compactCompanySize(company),
    tagline: shortSentences(description) || '—',
    description: shortSentences(description, 3, 700) || '—',
    blogs: [...blogs.values()],
  };
}
