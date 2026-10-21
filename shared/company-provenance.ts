import type { Company, Job } from './model.js';
import type { ResearchImport, StoredObservation } from './company-research.js';

export type CompanyColumn =
  'company' | 'business' | 'target_vacancies' | 'analytics_culture' | 'infrastructure';
export type CollectionSource = NonNullable<
  ResearchImport['companies'][number]['collection_sources']
>[number];
export type UsedSource = {
  name: string;
  kind: CollectionSource['kind'];
  description: string;
  url: string;
  observedAt: string;
  outcome: string;
  query?: string;
};
export const providerDescriptions: Record<string, string> = {
  greenhouse: 'Greenhouse Job Board API — публичные вакансии на карьерной доске работодателя.',
  ashby:
    'Ashby Job Postings API — опубликованные вакансии, описания, локации и раскрытая компенсация.',
  lever: 'Lever Postings API — публичные вакансии компании и их описания.',
  smartrecruiters:
    'SmartRecruiters Posting API — опубликованные вакансии; полное описание доступно через details.',
  adzuna: 'Adzuna API — поисковый агрегатор вакансий из карьерных сайтов и других досок.',
  arbeitnow: 'Arbeitnow API — публичная лента вакансий с географией и описаниями.',
  remotive: 'Remotive API — публичная лента удалённых вакансий с ограничениями географии.',
  serpapi: 'SerpAPI Google Jobs — API результатов поиска вакансий Google Jobs.',
  jooble: 'Jooble API — поисковый агрегатор вакансий с описаниями и ссылками на публикации.',
  manual: 'Ручное добавление — сохранённая пользователем карточка вакансии.',
  import: 'Импорт — ранее сохранённые вакансии из исследовательской подборки.',
};
type Run = {
  document?: {
    companies?: Array<{
      identity: { company_id?: string; name: string };
      collection_sources?: CollectionSource[];
    }>;
  };
};
export function companyColumnSources(
  company: Company,
  observations: StoredObservation[],
  jobs: Job[],
  targets: { sources: Array<{ label: string; id: string; url: string; updatedAt: string }> },
  history: Run[],
) {
  const result: Record<CompanyColumn, UsedSource[]> = {
    company: [],
    business: [],
    target_vacancies: [],
    analytics_culture: [],
    infrastructure: [],
  };
  for (const origin of company.origins) {
    const source: UsedSource = {
      name: origin.label,
      kind: 'manual',
      description:
        'Происхождение ранее сохранённой карточки компании; привязка к отдельному полю не была записана.',
      url: origin.url,
      observedAt: '',
      outcome: 'partial',
    };
    result.company.push(source);
    result.business.push(source);
  }
  for (const url of company.evidenceUrls.filter(Boolean)) {
    const source: UsedSource = {
      name: 'Сохранённый источник карточки',
      kind: 'web_page',
      description:
        'Ссылка из прежней карточки; дата чтения и соответствие конкретному полю отдельно не зафиксированы.',
      url,
      observedAt: '',
      outcome: 'partial',
    };
    result.company.push(source);
    result.business.push(source);
  }
  for (const run of history)
    for (const c of run.document?.companies || []) {
      if (
        c.identity.company_id
          ? c.identity.company_id !== company.id
          : c.identity.name !== company.name
      )
        continue;
      for (const source of c.collection_sources || [])
        for (const column of source.columns)
          result[column].push({
            name: source.name,
            kind: source.kind,
            description: source.description,
            url: source.url || '',
            observedAt: source.observed_at,
            outcome: source.outcome,
            query: source.query,
          });
    }
  for (const o of observations.filter((o) => !o.rejected)) {
    const columns: CompanyColumn[] =
      o.criterion_id === 'B04'
        ? o.scope.role || o.scope.job_url
          ? ['target_vacancies']
          : ['company', 'business']
        : o.criterion_id === 'B06' || o.criterion_id === 'B08'
          ? ['business']
          : o.criterion_id === 'P03_PUBLIC'
            ? ['analytics_culture']
            : o.criterion_id === 'P07_INTERVIEW'
              ? ['target_vacancies']
              : o.criterion_id === 'AN06'
                ? ['analytics_culture', 'target_vacancies']
                : o.criterion_id === 'A02_HQ' || o.criterion_id === 'B02'
                  ? ['company']
                  : /^(AN|T)/.test(o.criterion_id)
                    ? ['analytics_culture', 'infrastructure']
                    : /^(A01|A04|A05)/.test(o.criterion_id)
                      ? ['target_vacancies']
                      : [];
    for (const e of o.evidence)
      for (const column of columns)
        result[column].push({
          name: e.title,
          kind: 'web_page',
          description:
            e.source_type === 'job'
              ? 'Текст конкретной вакансии; выводы ограничены этой ролью.'
              : e.source_type === 'engineering'
                ? 'Техническая публикация, блог или публичный репозиторий.'
                : 'Исходный материал исследования компании.',
          url: e.url,
          observedAt: e.observed_at,
          outcome: o.verifiedAt ? 'success' : 'partial',
        });
  }
  for (const s of targets.sources) {
    const provider = s.id.replace(/^provider:/, '');
    const source: UsedSource = {
      name: s.label,
      kind: 'api',
      description:
        providerDescriptions[provider] ||
        Object.entries(providerDescriptions).find(([key]) =>
          s.label.toLowerCase().startsWith(key),
        )?.[1] ||
        'Карьерная доска или источник сохранённых вакансий.',
      url: s.url,
      observedAt: s.updatedAt,
      outcome: s.updatedAt ? 'success' : 'partial',
    };
    result.target_vacancies.push(source);
  }
  for (const job of jobs.filter(
    (j) => j.description && /analyst|analytics|data|аналитик/i.test(j.title),
  )) {
    const source: UsedSource = {
      name: job.title,
      kind: 'web_page',
      description: `Сохранённая вакансия · ${providerDescriptions[job.source] || job.source}`,
      url: job.url,
      observedAt: job.lastSeenAt || '',
      outcome: job.lastSeenAt ? 'success' : 'partial',
    };
    result.analytics_culture.push(source);
    result.infrastructure.push(source);
  }
  for (const column of Object.keys(result) as CompanyColumn[]) {
    const unique = new Map<string, UsedSource>();
    for (const s of result[column]) {
      const key = [s.kind, s.name, s.url, s.query || ''].join('|');
      if (!unique.has(key) || unique.get(key)!.observedAt < s.observedAt) unique.set(key, s);
    }
    result[column] = [...unique.values()].sort((a, b) => b.observedAt.localeCompare(a.observedAt));
  }
  return result;
}
