import {
  registry,
  sections,
  stale,
  isHistoricalJob,
  valueKey,
  type StoredObservation,
  type InfrastructureValue,
} from '../shared/company-research';
import type { ComparisonProfile } from './company-comparison';
import { companyInterviewDetails, interviewText } from '../shared/company-interviews';
import { salaryBenchmarkText } from './salary-benchmark';

type SummaryProfile = Pick<
  ComparisonProfile,
  'company' | 'observations' | 'flags' | 'headquarters'
> &
  Partial<Pick<ComparisonProfile, 'jobs'>>;
const regionNames = new Intl.DisplayNames(['ru'], { type: 'region' });
const countryName = (code: string) => regionNames.of(code) || code;
const tidy = (text: string) => text.replace(/\s+/g, ' ').trim();
// Remove known collection templates, not the substantive qualification that may follow them.
function content(text: string) {
  return tidy(text)
    .replace(
      /^(?:Перенос сохранённых сведений без повторной проверки публичного источника|Подтверждение относится к описанному источником объекту и периоду|Прямое указание штаб-квартиры в официальном источнике|Сводка прочитанного первичного материала; утверждения ограничены источником и датой)\.\s*/i,
      '',
    )
    .replace(
      /^Самодекларация работодателя в поле Headquarters; identity проверена по названию, продукту и корпоративному домену\.\s*/i,
      '',
    )
    .replace(
      /^(?:Проверенное содержание источника|Прямое подтверждение в указанном scope|Условия указанной вакансии)[.;]?\s*/i,
      '',
    )
    .replace(/Это не повторная проверка объявления\.?/gi, '')
    .replace(/;?\s*опубликованная в карточке оплата: не указана\.?/gi, '')
    .replace(/География допуска неизвестна\.?/gi, '')
    .trim();
}
const boilerplateContext =
  /^(research coverage gap|official[_ ]|legacy_|source:|company_headquarters$|distributed_headquarters$|headquarters$)/i;
function context(o: Pick<StoredObservation, 'scope'>) {
  return [
    ...new Set(
      [
        o.scope.country && countryName(o.scope.country),
        o.scope.city,
        o.scope.role,
        o.scope.level && !o.scope.role?.toLowerCase().includes(o.scope.level.toLowerCase())
          ? o.scope.level
          : '',
        o.scope.context && !boilerplateContext.test(o.scope.context)
          ? o.scope.context
              .replace(/^historical_job(?=;|$)/, 'Историческая вакансия')
              .replaceAll('_', ' ')
          : '',
      ].filter(Boolean),
    ),
  ].join(' · ');
}
function detail(o: StoredObservation) {
  const reasoning = content(o.reasoning);
  const excerpts = [...new Set(o.evidence.map((e) => content(e.excerpt)).filter(Boolean))].join(
    ' ',
  );
  return reasoning
    ? [
        reasoning,
        excerpts && !reasoning.includes(excerpts) && !excerpts.includes(reasoning) ? excerpts : '',
      ]
        .filter(Boolean)
        .join(' ')
    : excerpts;
}
function valueText(o: StoredObservation): string {
  if (o.value === null) return '';
  if (typeof o.value === 'object' && !Array.isArray(o.value) && 'sample_scope' in o.value)
    return salaryBenchmarkText(o.value);
  if (typeof o.value === 'string') {
    if (o.criterion_id === 'AN06') {
      const label = {
        product_data: 'Продуктовая / Data-аналитика',
        bi_de_ml: 'BI / Data Engineering / ML',
        mixed: 'Смешанные обязанности',
      }[o.value];
      return [label, detail(o)].filter(Boolean).join('. ');
    }
    return enrich(tidy(o.value), detail(o));
  }
  const extra = detail(o);
  if (typeof o.value === 'boolean')
    return [o.value ? 'Да.' : 'Нет.', extra].filter(Boolean).join(' ');
  if (Array.isArray(o.value)) {
    if (!o.value.length) return '';
    const countries = ['A02_OFFICES', 'A02_HQ'].includes(o.criterion_id);
    const value = o.value.map((v) => (countries ? countryName(v) : v)).join(', ');
    return enrich(value, extra);
  }
  if ('modes' in o.value) {
    if (!o.value.modes.length && !o.value.eligible_countries.length) return '';
    const modes = { remote: 'удалённо', hybrid: 'гибрид', onsite: 'офис' };
    const value = [
      o.value.modes.map((m) => modes[m]).join(', '),
      o.value.eligible_countries.length
        ? 'Допустимые страны: ' + o.value.eligible_countries.map(countryName).join(', ')
        : '',
    ]
      .filter(Boolean)
      .join('. ');
    return enrich(value, extra);
  }
  if ('stages' in o.value) return interviewText(o.value);
  if ('summary' in o.value) {
    const assessments =
      'assessments' in o.value
        ? ((o.value as InfrastructureValue).assessments || [])
            .map((a) => `Оценка анализа: ${a.label}. Основание: ${a.basis}`)
            .join('\n')
        : '';
    return enrich(
      [o.value.summary, o.value.tags.join(' · '), assessments].filter(Boolean).join('\n\n'),
      extra,
    );
  }
  return '';
}
function enrich(value: string, extra: string) {
  if (!value) return '';
  if (extra && tidy(extra).toLowerCase().includes(tidy(value).toLowerCase())) return extra;
  return [
    value,
    extra && !tidy(value).toLowerCase().includes(tidy(extra).toLowerCase()) ? extra : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}
function status(o: StoredObservation, now: number) {
  const parts = [
    !o.verifiedAt
      ? o.scope.context?.startsWith('legacy_')
        ? 'карточка, не проверено'
        : 'ресерч, не проверено'
      : '',
    o.confidence === 'low' ? 'низкая уверенность' : '',
    isHistoricalJob(o)
      ? 'исторические сведения, текущие условия не подтверждены'
      : o.verifiedAt && stale(o, now)
        ? 'устаревшие данные'
        : '',
    o.evidence.some((e) => e.source_type === 'employee_report') ? 'отзыв' : '',
    o.evidence.some((e) => ['market_estimate', 'news'].includes(e.source_type))
      ? 'внешняя оценка / сообщение, не установленное условие компании'
      : '',
  ].filter(Boolean);
  const publication = o.evidence
    .map((e) => e.published_at)
    .filter(Boolean)
    .sort()
    .at(-1);
  if (publication) parts.push('источник ' + publication.slice(0, 10));
  if (isHistoricalJob(o)) {
    const observed = o.evidence
      .map((e) => e.observed_at)
      .sort()
      .at(-1);
    if (observed) parts.push('наблюдение ' + observed.slice(0, 10));
  }
  return parts.length ? ' (' + parts.join('; ') + ')' : '';
}
export type CompanyInformationItem = {
  id: string;
  label: string;
  question?: string;
  body: string;
  scope: string;
  notice: string;
  sources: StoredObservation['evidence'];
  observationIds: string[];
  flagIds: string[];
};
export type CompanyInformationSection = {
  id: string;
  title: string;
  items: CompanyInformationItem[];
};
function mergeSources(
  target: StoredObservation['evidence'],
  sources: StoredObservation['evidence'],
) {
  for (const source of sources)
    if (
      !target.some(
        (e) =>
          e.url === source.url &&
          e.excerpt === source.excerpt &&
          e.published_at === source.published_at &&
          e.source_type === source.source_type,
      )
    )
      target.push(source);
}
/** Filled questionnaire only. Keep provenance, scope and caveats without collection/audit records. */
export function companyInformation(
  p: SummaryProfile,
  now = Date.now(),
): CompanyInformationSection[] {
  const observations = p.observations.filter((o) => !o.rejected && o.value !== null);
  const result: CompanyInformationSection[] = [];
  for (const [section, title] of Object.entries(sections)) {
    const items: CompanyInformationItem[] = [];
    for (const criterion of registry.criteria.filter((c) => c.section === section)) {
      const facts = observations
        .filter((o) => o.criterion_id === criterion.id)
        .sort(
          (a, b) =>
            Number(!!b.verifiedAt && !stale(b, now)) - Number(!!a.verifiedAt && !stale(a, now)) ||
            b.importedAt.localeCompare(a.importedAt),
        );
      const seen = new Map<string, CompanyInformationItem>();
      for (const o of facts) {
        const body = valueText(o);
        if (!body) continue;
        // Ignore collection boilerplate, retain country/role/job distinctions and meaningful qualifiers.
        const key =
          valueKey(o.value) + '|' + context(o) + '|' + (o.scope.job_url || '') + '|' + body;
        const previous = seen.get(key);
        if (previous) {
          previous.observationIds.push(o.id);
          mergeSources(previous.sources, o.evidence);
          continue;
        }
        const item: CompanyInformationItem = {
          id: o.id,
          label: criterion.name,
          question: criterion.question,
          body,
          scope: context(o),
          notice: status(o, now).trim(),
          sources: [...o.evidence],
          observationIds: [o.id],
          flagIds: [],
        };
        if (o.scope.job_url && !item.sources.some((s) => s.url === o.scope.job_url))
          item.sources.push({
            url: o.scope.job_url,
            title: 'Вакансия',
            source_type: 'job',
            observed_at: o.importedAt,
            excerpt: '',
          });
        seen.set(key, item);
        items.push(item);
      }
      if (criterion.id === 'A02_HQ' && p.headquarters.status === 'distributed') {
        const records = p.observations.filter(
          (o) =>
            !o.rejected &&
            o.criterion_id === 'A02_HQ' &&
            o.scope.context === 'distributed_headquarters',
        );
        items.push({
          id: 'distributed-hq',
          label: criterion.name,
          question: criterion.question,
          body: 'Распределённая команда.',
          scope: '',
          notice: '',
          sources: records.flatMap((o) => o.evidence),
          observationIds: records.map((o) => o.id),
          flagIds: [],
        });
      }
    }
    if (section === 'B') {
      const card = (id: string, label: string, body: string) => {
        if (!body || items.some((item) => item.body.includes(body))) return;
        items.push({
          id,
          label,
          body,
          scope: '',
          notice: '(из карточки компании, не проверено)',
          sources: [],
          observationIds: [],
          flagIds: [],
        });
      };
      card('description', 'Описание компании', p.company.description);
      card('industry', 'Отрасль', p.company.industry);
      card('size', 'Размер компании', p.company.size);
      card('location', 'Местоположение', p.company.location);
      if (
        p.company.dataDrivenEvidence &&
        !result
          .concat({ id: section, title, items })
          .some((s) => s.items.some((i) => i.body.includes(p.company.dataDrivenEvidence)))
      ) {
        card('data-driven', 'Аналитические практики из карточки', p.company.dataDrivenEvidence);
        const item = items.find((i) => i.id === 'data-driven');
        if (item)
          item.sources = p.company.evidenceUrls.map((url) => ({
            url,
            title: 'Источник из карточки',
            source_type: 'user' as const,
            observed_at: p.company.checkedAt || p.company.updatedAt,
            excerpt: '',
          }));
      }
    }
    if (items.length) result.push({ id: section, title, items });
  }
  const rawInterviews = companyInterviewDetails(p.observations, p.jobs).filter(
    (i) => !i.observationIds.length,
  );
  if (rawInterviews.length) {
    let process = result.find((s) => s.id === 'P');
    if (!process) {
      process = { id: 'P', title: sections.P, items: [] };
      result.push(process);
    }
    process.items.push(
      ...rawInterviews.map((i) => ({
        id: i.id,
        label: 'Детали интервью',
        body: i.text,
        scope: i.scope,
        notice: i.notice,
        sources: i.sources,
        observationIds: [],
        flagIds: [],
      })),
    );
  }
  const flags = new Map<string, CompanyInformationItem>();
  for (const f of p.flags) {
    const scope = context({ scope: f.scope });
    const key = [f.title, scope, f.scope.job_url, f.description, f.verification].join('|');
    const existing = flags.get(key);
    if (existing) {
      existing.flagIds.push(f.id);
      mergeSources(existing.sources, f.evidence);
    } else
      flags.set(key, {
        id: f.id,
        label: f.title,
        body: f.description || '',
        scope,
        notice:
          '(' +
          [
            f.verification === 'verified_source'
              ? 'источник проверен; сигнал риска'
              : 'сигнал, не проверено',
            f.evidence.some(
              (e: StoredObservation['evidence'][number]) => e.source_type === 'employee_report',
            )
              ? 'отзыв, не установленное условие компании'
              : '',
            f.confidence === 'low' ? 'низкая уверенность' : '',
            f.occurred_at ? 'событие ' + f.occurred_at.slice(0, 10) : '',
          ]
            .filter(Boolean)
            .join('; ') +
          ')',
        sources: [...f.evidence],
        observationIds: [],
        flagIds: [f.id],
      });
  }
  if (flags.size) result.push({ id: 'risks', title: 'Риски', items: [...flags.values()] });
  return result;
}
/** Text export shares the same filled answers as the reading view. */
export function companySummaryText(p: SummaryProfile, now = Date.now()) {
  return [
    p.company.website ? 'Сайт: ' + p.company.website : '',
    ...companyInformation(p, now).map((s) =>
      [
        s.title,
        ...s.items.map(
          (i) =>
            i.label +
            (i.scope ? ' — ' + i.scope : '') +
            ': ' +
            i.body +
            (i.notice ? ' ' + i.notice : ''),
        ),
      ].join('\n\n'),
    ),
  ]
    .filter(Boolean)
    .join('\n\n');
}
