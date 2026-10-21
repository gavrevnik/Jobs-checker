import type { ComparisonProfile } from './company-comparison';
import { companyHiringLinks } from '../shared/company-hiring';

export type UsefulLink = { label: string; url: string; note: string; children: UsefulLink[] };
export function sourceUrl(value: string): string {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol)) return '';
    if (
      url.username ||
      url.password ||
      /^(localhost|127\.|0\.|\[?::1\]?$)/i.test(url.hostname) ||
      /\.(localhost|local)$/i.test(url.hostname)
    )
      return '';
    url.hash = '';
    for (const key of [...url.searchParams.keys()])
      if (/^(utm_.+|fbclid|gclid|ref|source)$/i.test(key)) url.searchParams.delete(key);
    return url.href.replace(/\/$/, '');
  } catch {
    return '';
  }
}
export function sourceLabel(url: string, title = '') {
  const host = new URL(url).hostname.replace(/^www\./, '');
  const platform = [
    ['adzuna.', 'Adzuna'],
    ['arbeitnow.', 'Arbeitnow'],
    ['linkedin.com', 'LinkedIn'],
    ['indeed.', 'Indeed'],
    ['welcometothejungle.', 'Welcome to the Jungle'],
    ['wellfound.com', 'Wellfound'],
    ['greenhouse.io', 'Greenhouse'],
    ['ashbyhq.com', 'Ashby'],
    ['lever.co', 'Lever'],
    ['smartrecruiters.com', 'SmartRecruiters'],
    ['myworkdayjobs.com', 'Workday'],
    ['jobicy.com', 'Jobicy'],
    ['remotive.com', 'Remotive'],
    ['levels.fyi', 'Levels.fyi'],
    ['github.com', 'GitHub'],
  ].find(([domain]) => host.includes(domain))?.[1];
  return platform || title.trim().slice(0, 100) || host;
}

/** No network calls or guessed employer profiles. Aggregate saved identities and evidence only. */
export function companyUsefulLinks(p: ComparisonProfile): UsefulLink[] {
  const links = new Map<string, UsefulLink>();
  const parents = new Map<string, string>();
  const requestedParents = new Map<string, string>();
  const homes = new Map<string, 'blog' | 'ats'>();
  const add = (url: string, label: string, note = '', explicit = false) => {
    const key = sourceUrl(url);
    if (!key) return;
    const old = links.get(key);
    if (old) {
      if (explicit) old.label = label;
      if (note && !old.note.includes(note)) old.note = [old.note, note].filter(Boolean).join(' · ');
    } else links.set(key, { label, url: key, note, children: [] });
  };
  if (p.company.website) add(p.company.website, 'Сайт компании');
  for (const link of companyHiringLinks(p.company)) add(link.url, link.label);
  for (const source of [
    p.company.hiringSources?.careers,
    p.company.hiringSources?.linkedin,
    ...(p.company.hiringSources?.ats || []),
  ])
    for (const url of source?.evidenceUrls || []) if (sourceUrl(url)) add(url, sourceLabel(url));
  for (const ats of p.company.hiringSources?.ats || []) {
    add(
      ats.url,
      `Доска ${sourceLabel(ats.url, ats.provider)}`,
      ats.status === 'needs_review' ? 'Связь с компанией не подтверждена' : '',
    );
    if (sourceUrl(ats.url)) homes.set(sourceUrl(ats.url), 'ats');
  }
  for (const source of p.targetVacancies.sources) {
    if (!source.url) continue;
    add(source.url, source.label);
    if (/greenhouse|lever|ashby|smartrecruiters/i.test(source.label))
      homes.set(sourceUrl(source.url), 'ats');
  }
  for (const source of Object.values(p.columnSources).flat())
    if (source.url && source.kind !== 'model')
      add(
        source.url,
        sourceLabel(source.url, source.name),
        source.outcome === 'error' ? 'Недоступен при последней проверке' : '',
      );
  for (const origin of p.company.origins) add(origin.url, origin.label);
  for (const url of p.company.evidenceUrls) if (sourceUrl(url)) add(url, sourceLabel(url));
  for (const observation of p.observations.filter((o) => !o.rejected))
    for (const e of observation.evidence) {
      if (!sourceUrl(e.url)) continue;
      add(e.url, e.title || sourceLabel(e.url), '', true);
      if (e.source_type === 'engineering' && new URL(e.url).pathname === '/')
        homes.set(sourceUrl(e.url), 'blog');
    }
  for (const flag of p.flags)
    for (const e of flag.evidence) add(e.url, e.title || 'Источник сигнала');
  for (const job of p.jobs) add(job.url, job.title, '', true);
  for (const link of p.company.sourceLinks || []) {
    add(link.url, link.label, link.note || '', true);
    if (['blog', 'ats'].includes(link.kind))
      homes.set(sourceUrl(link.url), link.kind as 'blog' | 'ats');
    if (link.parentUrl) requestedParents.set(sourceUrl(link.url), sourceUrl(link.parentUrl));
  }
  for (const [url, link] of links) {
    // Nest only under saved, confirmed directory URLs (longest matching path wins).
    const parent =
      requestedParents.get(url) ||
      [...homes.keys()]
        .filter((home) => url !== home && url.startsWith(home + '/'))
        .sort((a, b) => b.length - a.length)[0];
    if (
      parent &&
      parent !== url &&
      links.has(parent) &&
      !requestedParents.has(parent) &&
      !parents.has(parent)
    ) {
      links.get(parent)!.children.push(link);
      parents.set(url, parent);
    }
  }
  return [...links.values()]
    .filter((link) => !parents.has(link.url) || !links.has(parents.get(link.url)!))
    .sort(
      (a, b) =>
        Number(homes.has(b.url)) - Number(homes.has(a.url)) || a.label.localeCompare(b.label, 'ru'),
    );
}
