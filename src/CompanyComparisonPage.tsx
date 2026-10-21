import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownUp, Search, ExternalLink, ChevronDown, Maximize2, Minimize2 } from 'lucide-react';
import { TargetVacancySourcesModal } from './TargetVacancySourcesModal';
import { ComparisonColumnGuide, type GuideColumn } from './ComparisonColumnGuide';
import { companyPresentation } from './company-presentation';
import { companySizeLabels } from '../shared/model';
import { TargetVacanciesModal } from './TargetVacanciesModal';
import { CompanyHiringLinks } from './CompanyHiringLinks';
import { CompanyColumnModal } from './CompanyColumnModal';
import { companyCulture } from './company-culture';
import { companyResearchTags, uncoveredTechnicalFacts } from '../shared/company-signals';
import { companyInformationRows } from './company-information-table';
import { CompanyUsefulLinksModal } from './CompanyUsefulLinksModal';
import { CompanyInterviewModal } from './CompanyInterviewModal';
import { companyInterviewDetails } from '../shared/company-interviews';
import { companyScreening } from './company-screening';
import type { ResearchTag } from '../shared/company-signals';
import { api } from './api';
import { Modal } from './components';
import { registry, sections, type Section } from '../shared/company-research';
import type { CompanyResearch } from '../server/company-research';
import './company-comparison.css';
import {
  comparisonModeMatches,
  comparisonHiringOffices,
  comparisonHiringOfficeMatches,
  comparisonHiringTags,
  uncoveredAvailabilityFacts,
} from './company-comparison';
type Profile = ReturnType<CompanyResearch['profile']>;
const label: Record<string, string> = {
  pass: '✓',
  fail: '✗',
  unknown: '?',
  conflicting: '⚠',
  not_applicable: 'N/A',
};
const statusLabels: Record<string, string> = {
  not_researched: 'Не исследовано',
  needs_review: 'Проверить evidence',
  conflicting: 'Противоречия',
  stale: 'Устаревшие данные',
  reviewed: 'Проверено',
};
const show = (value: unknown) =>
  value === null || value === undefined
    ? 'Неизвестно'
    : typeof value === 'object'
      ? JSON.stringify(value)
      : String(value);
export function CompanyComparisonPage({
  onDetail,
  profileId,
  companyRevision,
  onJob,
  onJobs,
  expanded,
  onExpandedChange,
}: {
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onDetail: (id: string) => void;
  profileId: string;
  companyRevision: string;
  onJob: (id: string) => void;
  onJobs: (companyId: string, ids: string[]) => void;
}) {
  const [data, setData] = useState<Profile[]>([]),
    [query, setQuery] = useState('');
  const [mode, setMode] = useState('all'),
    [relocation, setRelocation] = useState('all'),
    [visa, setVisa] = useState('all');
  const [office, setOffice] = useState(''),
    [moreFilters, setMoreFilters] = useState(false);
  const [hasJobs, setHasJobs] = useState(false);
  const [companySize, setCompanySize] = useState('all');
  const [status, setStatus] = useState('all'),
    [priority, setPriority] = useState('all'),
    [domain, setDomain] = useState('');
  const [section, setSection] = useState<Section>('A'),
    [minPass, setMinPass] = useState(0),
    [coverage, setCoverage] = useState(0);
  const [sort, setSort] = useState('name'),
    [descending, setDescending] = useState(false),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<string | null>(null);
  const [linksCompany, setLinksCompany] = useState<{ id: string; name: string } | null>(null);
  const [targetCompany, setTargetCompany] = useState<{ id: string; name: string } | null>(null);
  const [targetSourcesOpen, setTargetSourcesOpen] = useState(false);
  const [columnGuide, setColumnGuide] = useState<GuideColumn | null>(null);
  const [infrastructureGuide, setInfrastructureGuide] = useState<Profile | null>(null);
  const [interviewCompany, setInterviewCompany] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [hasLoaded, setHasLoaded] = useState(false);
  const loadController = useRef<AbortController | null>(null);
  const [columnDetail, setColumnDetail] = useState<{
    id: string;
    name: string;
    column: 'business' | 'analytics_culture' | 'infrastructure';
  } | null>(null);
  const load = useCallback(async () => {
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    setError('');
    setLoading(true);
    try {
      const params = new URLSearchParams({
        ...(profileId ? { profileId } : {}),
      });
      const result = await api<{ companies: Profile[] }>(
        `/company-research?${params}`,
        'GET',
        undefined,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setData(result.companies);
      setHasLoaded(true);
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [profileId, companyRevision]);
  useEffect(() => {
    void load();
    return () => loadController.current?.abort();
  }, [load]);
  const filteredProfiles = useMemo(
    () =>
      data
        .filter((p) => {
          const criterion = (id: string) => p.criteria.find((c) => c.criterion.id === id)!;
          const verdictMatch = (id: string, filter: string) =>
            filter === 'all' || criterion(id).verdict === filter;
          return (
            (!query ||
              [p.company.name, p.company.description, p.company.industry]
                .join(' ')
                .toLowerCase()
                .includes(query.toLowerCase())) &&
            comparisonModeMatches(p, mode) &&
            verdictMatch('A04_RELOCATION', relocation) &&
            verdictMatch('A04', visa) &&
            (!hasJobs || p.targetVacancies.open > 0) &&
            (companySize === 'all' || p.company.sizeCategory === companySize) &&
            (status === 'all' || p.researchStatus === status) &&
            (priority === 'all' || p.preferences.priority === priority) &&
            (!domain ||
              p.company.industry.toLowerCase().includes(domain.toLowerCase()) ||
              p.confirmed.some(
                (o) =>
                  o.criterion_id === 'B04' &&
                  show(o.value).toLowerCase().includes(domain.toLowerCase()),
              )) &&
            p.scores[section].pass >= minPass &&
            p.scores[section].coverage * 100 >= coverage
          );
        })
        .sort((a, b) => {
          const val = (p: Profile): string | number =>
            sort === 'name'
              ? p.company.name
              : sort === 'jobs'
                ? p.targetVacancies.open
                : sort === 'coverage'
                  ? p.scores[section].coverage
                  : sort === 'pass'
                    ? p.scores[section].pass
                    : sort === 'domain'
                      ? p.company.industry
                      : p.lastResearchAt;
          const av = val(a),
            bv = val(b);
          return (
            (typeof av === 'number' && typeof bv === 'number'
              ? av - bv
              : String(av).localeCompare(String(bv))) * (descending ? -1 : 1)
          );
        }),
    [
      data,
      query,
      mode,
      relocation,
      visa,
      hasJobs,
      companySize,
      status,
      priority,
      domain,
      section,
      minPass,
      coverage,
      sort,
      descending,
    ],
  );
  const offices = useMemo(() => comparisonHiringOffices(filteredProfiles), [filteredProfiles]);
  const selectedOffice = data
    .flatMap((p) => p.targetVacancies.offices)
    .find((o) => o.id === office);
  const rows = useMemo(
    () => filteredProfiles.filter((p) => comparisonHiringOfficeMatches(p, office)),
    [filteredProfiles, office],
  );
  const visibleSections = useMemo(
    () =>
      new Set([
        ...(data.some((p) => uncoveredAvailabilityFacts(p).length > 0) ? ['A'] : []),
        ...(data.some((p) => uncoveredTechnicalFacts(p.observations).length > 0) ? ['T'] : []),
      ]),
    [data],
  );
  useEffect(() => {
    if (!expanded) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('[role="dialog"]')) onExpandedChange(false);
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [expanded, onExpandedChange]);
  const closeDetail = useCallback(() => setDetail(null), []);
  const closeTargets = useCallback(() => setTargetCompany(null), []);
  const closeColumn = useCallback(() => setColumnDetail(null), []);
  const closeGuide = useCallback(() => setColumnGuide(null), []);
  return (
    <section className={`comparison-page${expanded ? ' comparison-page-expanded' : ''}`}>
      <div className="comparison-filters">
        <div className="comparison-primary-filters">
          <label>
            <span className="comparison-search-label">
              <Search size={15} /> Название компании
            </span>
            <input
              placeholder="Название компании"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <label>
            Актуальные офисы найма
            <select value={office} onChange={(e) => setOffice(e.target.value)}>
              <option value="">Все города</option>
              {office && !offices.some((o) => o.id === office) && (
                <option value={office}>{selectedOffice?.name || office} · 0</option>
              )}
              {offices.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} · {o.count}
                </option>
              ))}
            </select>
          </label>
          <label>
            Размер компании
            <select value={companySize} onChange={(e) => setCompanySize(e.target.value)}>
              <option value="all">Любой размер</option>
              {Object.entries(companySizeLabels).map(([value, title]) => (
                <option key={value} value={value}>
                  {title}
                </option>
              ))}
            </select>
          </label>
          <label className="comparison-active-jobs">
            <input
              type="checkbox"
              checked={hasJobs}
              onChange={(e) => setHasJobs(e.target.checked)}
            />
            Есть активные вакансии
          </label>
          <button
            className="button comparison-more-button"
            onClick={() => setMoreFilters((v) => !v)}
            aria-expanded={moreFilters}
            aria-controls="comparison-more-filters"
          >
            Подробнее <ChevronDown size={16} />
          </button>
          <button
            className="button comparison-expand"
            onClick={() => onExpandedChange(!expanded)}
            aria-label={expanded ? 'Свернуть таблицу' : 'Развернуть таблицу на всё окно'}
            title={expanded ? 'Свернуть таблицу (Esc)' : 'Развернуть таблицу на всё окно'}
            aria-pressed={expanded}
          >
            {expanded ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
          </button>
        </div>
        <div id="comparison-more-filters" className="comparison-more-filters" hidden={!moreFilters}>
          <label>
            Формат
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="all">Все</option>
              <option value="remote">Remote</option>
              <option value="hybrid">Hybrid</option>
              <option value="onsite">Office</option>
            </select>
          </label>
          {[
            [relocation, setRelocation, 'Релокация'],
            [visa, setVisa, 'Visa sponsorship'],
          ].map(([v, set, l]) => (
            <label key={String(l)}>
              {String(l)}
              <select
                value={v as string}
                onChange={(e) => (set as (s: string) => void)(e.target.value)}
              >
                <option value="all">Все</option>
                <option value="pass">Подтверждена</option>
                <option value="fail">Явно отсутствует</option>
                <option value="unknown">Неизвестно</option>
                <option value="conflicting">Противоречия</option>
              </select>
            </label>
          ))}
          <label>
            Research status
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="all">Все</option>
              {Object.entries(statusLabels).map(([v, l]) => (
                <option value={v} key={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            Приоритет
            <select value={priority} onChange={(e) => setPriority(e.target.value)}>
              {['all', 'Target', 'Secondary', 'Practice', 'Unassigned'].map((v) => (
                <option key={v} value={v}>
                  {v === 'all' ? 'Все' : v}
                </option>
              ))}
            </select>
          </label>
          <label>
            Направление
            <input
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="Домен бизнеса"
            />
          </label>
          <label>
            Раздел
            <select value={section} onChange={(e) => setSection(e.target.value as Section)}>
              {Object.entries(sections).map(([v, l]) => (
                <option value={v} key={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            Pass от
            <input
              type="number"
              min="0"
              max="30"
              value={minPass}
              onChange={(e) => setMinPass(Number(e.target.value))}
            />
          </label>
          <label>
            Coverage % от
            <input
              type="number"
              min="0"
              max="100"
              value={coverage}
              onChange={(e) => setCoverage(Number(e.target.value))}
            />
          </label>
          <label>
            Сортировка
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              {Object.entries({
                name: 'Компания',
                jobs: 'Целевые: открытые',
                domain: 'Направление',
                coverage: 'Coverage раздела',
                pass: 'Pass раздела',
                date: 'Дата исследования',
              }).map(([v, l]) => (
                <option value={v} key={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <button className="button" onClick={() => setDescending((v) => !v)}>
            <ArrowDownUp size={14} />
            {descending ? 'По убыванию' : 'По возрастанию'}
          </button>
        </div>
      </div>
      <p className="comparison-help comparison-count">
        {rows.length} из {data.length} компаний
        {visibleSections.size > 0 && (
          <>
            {' '}
            · Coverage = (pass + fail) / применимые оцениваемые критерии. Противоречия не дают
            баллов.
          </>
        )}
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {loading && !hasLoaded ? (
        <p role="status">Загрузка сравнения…</p>
      ) : !rows.length ? (
        <div className="comparison-empty">
          {data.length
            ? 'Нет компаний по выбранным фильтрам.'
            : 'Добавьте компании в разделе «Компании» или импортируйте исследование. Оценки появятся после проверки evidence.'}
        </div>
      ) : (
        <div
          className="comparison-scroll"
          tabIndex={0}
          aria-label="Сравнительная таблица, горизонтальная прокрутка"
        >
          <table
            className={`comparison-table${visibleSections.size ? '' : ' comparison-table-compact'}`}
          >
            <thead>
              <tr>
                <th>Компания</th>
                <th>
                  <button
                    className="comparison-heading-button"
                    onClick={() => setColumnGuide('business')}
                    aria-label="Описание бизнеса: источники и заполнение"
                  >
                    Описание бизнеса
                  </button>
                </th>
                <th>
                  <button
                    className="comparison-heading-button"
                    onClick={() => setTargetSourcesOpen(true)}
                    aria-label="Целевые вакансии: источники и лимиты"
                  >
                    Целевые вакансии
                  </button>
                </th>
                <th>
                  <button
                    className="comparison-heading-button"
                    onClick={() => setColumnGuide('analytics_culture')}
                    aria-label="Аналитика: источники и заполнение"
                  >
                    Аналитика
                  </button>
                </th>
                {Object.entries(sections)
                  .filter(([id]) => visibleSections.has(id))
                  .map(([id, l]) => (
                    <Fragment key={id}>
                      {id !== 'A' && (
                        <th key={id + 'score'}>
                          {l}
                          <small>Score / coverage</small>
                        </th>
                      )}
                      <th key={id + 'highlights'}>
                        Highlights<small>{l}</small>
                      </th>
                    </Fragment>
                  ))}
                <th>Информация</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const presentation = companyPresentation(p.company, p.observations);
                const culture = companyCulture(p.observations);
                const hiringTags = comparisonHiringTags(p);
                const infrastructure = companyResearchTags(p.observations).infrastructure;
                const screening = companyScreening(p);
                const hq =
                  p.headquarters.status === 'distributed'
                    ? 'Распределённая команда'
                    : p.headquarters.status === 'verified'
                      ? p.headquarters.countries
                          .map(
                            (code) =>
                              new Intl.DisplayNames(['ru'], { type: 'region' }).of(code) || code,
                          )
                          .join(', ')
                      : '—';
                return (
                  <tr key={p.company.id}>
                    <td>
                      <div className="comparison-company-title">
                        <button className="comparison-name" onClick={() => onDetail(p.company.id)}>
                          {p.company.name}
                        </button>
                        {p.company.website && (
                          <a
                            className="comparison-site-icon"
                            href={p.company.website}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`Сайт компании ${p.company.name}`}
                          >
                            <ExternalLink size={15} />
                          </a>
                        )}
                      </div>
                      {presentation.businessType && (
                        <span className="comparison-business-tag">{presentation.businessType}</span>
                      )}
                      {p.preferences.priority !== 'Unassigned' && (
                        <span className="comparison-business-tag">{p.preferences.priority}</span>
                      )}
                      <small>{presentation.size}</small>
                      <small>Основной офис / штаб-квартира: {hq}</small>
                      <button
                        className="comparison-useful-links"
                        aria-label={`Полезные ссылки: ${p.company.name}`}
                        onClick={() => setLinksCompany({ id: p.company.id, name: p.company.name })}
                      >
                        Полезные ссылки
                      </button>
                    </td>
                    <td className="comparison-business-description">
                      <button
                        className="comparison-column-button"
                        onClick={() =>
                          setColumnDetail({
                            id: p.company.id,
                            name: p.company.name,
                            column: 'business',
                          })
                        }
                      >
                        {presentation.description}
                      </button>
                      <FactChips
                        tags={screening.business}
                        limit={2}
                        open={() =>
                          setColumnDetail({
                            id: p.company.id,
                            name: p.company.name,
                            column: 'business',
                          })
                        }
                      />
                      {screening.traffic.length > 0 && (
                        <button
                          className="comparison-column-button screening-audience"
                          title={screening.traffic.map((t) => t.details).join('\n\n')}
                          onClick={() =>
                            setColumnDetail({
                              id: p.company.id,
                              name: p.company.name,
                              column: 'business',
                            })
                          }
                        >
                          Масштаб: {screening.traffic[0].label}
                          {screening.traffic.length > 1
                            ? ` · +${screening.traffic.length - 1}`
                            : ''}
                        </button>
                      )}
                    </td>
                    <td>
                      <button
                        className="comparison-target-cell"
                        aria-label={`Целевые вакансии: ${p.company.name}`}
                        onClick={() => setTargetCompany({ id: p.company.id, name: p.company.name })}
                      >
                        <span>Всего найдено {p.targetVacancies.total}</span>
                        <strong className="target-open">Открытые {p.targetVacancies.open}</strong>
                        <span className="comparison-offices-label">Офисы найма:</span>
                        <span>
                          {p.targetVacancies.offices.length
                            ? p.targetVacancies.offices.map((city) => (
                                <span
                                  className={`comparison-office${city.open ? ' target-open' : ''}`}
                                  key={city.id}
                                >
                                  {city.name}
                                </span>
                              ))
                            : '—'}
                        </span>
                      </button>
                      <CompanyHiringLinks company={p.company} />
                      <FactChips
                        tags={screening.focus}
                        open={() => setDetail(p.company.id)}
                        limit={2}
                      />
                      <FactChips
                        tags={screening.work}
                        open={() => setDetail(p.company.id)}
                        limit={2}
                      />
                      {(hiringTags.modes.length > 0 ||
                        hiringTags.languages.length > 0 ||
                        hiringTags.benefits.length > 0) && (
                        <div className="culture-tags comparison-tags">
                          {hiringTags.modes
                            .filter(
                              (mode) =>
                                mode !== 'remote' ||
                                !screening.work.some((t) => t.label.startsWith('Remote ·')),
                            )
                            .map((mode) => (
                              <span key={mode} title="Формат открытых целевых вакансий">
                                {mode}
                              </span>
                            ))}
                          {hiringTags.languages.map((language) => (
                            <span key={language} title="язык команды">
                              {language}
                            </span>
                          ))}
                          {hiringTags.benefits.map((tag) => (
                            <span key={tag.label} title={tag.details}>
                              {tag.label}
                              {tag.countries.length
                                ? ' · ' + tag.countries.join('/')
                                : tag.scope
                                  ? ' · условия'
                                  : ''}
                            </span>
                          ))}
                        </div>
                      )}
                      {screening.interview.visible && (
                        <button
                          className="interview-badge"
                          aria-label={`Интервью: ${p.company.name}`}
                          title={screening.interview.details}
                          onClick={() =>
                            setInterviewCompany({ id: p.company.id, name: p.company.name })
                          }
                        >
                          {screening.interview.label}
                        </button>
                      )}
                    </td>
                    <td className="comparison-culture">
                      <button
                        className="comparison-column-button"
                        aria-label={`Аналитика: ${p.company.name}`}
                        onClick={() =>
                          setColumnDetail({
                            id: p.company.id,
                            name: p.company.name,
                            column: 'analytics_culture',
                          })
                        }
                      >
                        {culture.preview && <p>{culture.preview}</p>}
                      </button>
                      <FactChips
                        tags={screening.team}
                        open={() =>
                          setColumnDetail({
                            id: p.company.id,
                            name: p.company.name,
                            column: 'analytics_culture',
                          })
                        }
                        limit={2}
                      />
                      {culture.blogs.map((b) => (
                        <a key={b.url} href={b.url} target="_blank" rel="noreferrer">
                          {b.title} <ExternalLink size={12} />
                        </a>
                      ))}
                      {culture.github.map((b) => (
                        <a key={b.url} href={b.url} target="_blank" rel="noreferrer">
                          GitHub · {b.title} <ExternalLink size={12} />
                        </a>
                      ))}
                      {culture.tags.length > 0 && (
                        <button
                          className="comparison-column-button comparison-tags"
                          aria-label={`Теги аналитики: ${p.company.name}`}
                          onClick={() =>
                            setColumnDetail({
                              id: p.company.id,
                              name: p.company.name,
                              column: 'analytics_culture',
                            })
                          }
                        >
                          <span className="culture-tags">
                            {culture.tags.slice(0, 3).map((t) => (
                              <span key={t.label} title={t.details}>
                                {t.label}
                              </span>
                            ))}
                            {culture.tags.length > 3 && (
                              <span
                                title={culture.tags
                                  .slice(3)
                                  .map((t) => t.label)
                                  .join(' · ')}
                              >
                                +{culture.tags.length - 3}
                              </span>
                            )}
                          </span>
                        </button>
                      )}
                      <div className="comparison-infrastructure-section">
                        <button
                          className="comparison-heading-button"
                          onClick={() => setInfrastructureGuide(p)}
                          aria-label={`Инфраструктура: источники и заполнение · ${p.company.name}`}
                        >
                          Инфраструктура
                        </button>
                        <button
                          className="comparison-column-button"
                          aria-label={`Инфраструктура: ${p.company.name}`}
                          onClick={() =>
                            setColumnDetail({
                              id: p.company.id,
                              name: p.company.name,
                              column: 'infrastructure',
                            })
                          }
                        >
                          {infrastructure.length ? (
                            <span className="culture-tags">
                              {infrastructure.slice(0, 4).map((tag) => (
                                <span
                                  className={tag.assessment ? 'research-assessment' : ''}
                                  key={tag.label}
                                  title={tag.details}
                                >
                                  {tag.label}
                                </span>
                              ))}
                              {infrastructure.length > 4 && (
                                <span
                                  title={infrastructure
                                    .slice(4)
                                    .map((t) => t.label)
                                    .join(' · ')}
                                >
                                  +{infrastructure.length - 4}
                                </span>
                              )}
                            </span>
                          ) : (
                            '—'
                          )}
                        </button>
                      </div>
                    </td>
                    {Object.entries(p.scores)
                      .filter(([id]) => visibleSections.has(id))
                      .map(([id, s]) => (
                        <Fragment key={id}>
                          {id !== 'A' && (
                            <td key={id + 'score'}>
                              <strong>
                                {s.pass} ✓ / {s.fail} ✗ / {s.unknown} ?
                              </strong>
                              <small>
                                {s.conflicting > 0 ? `${s.conflicting} ⚠ · ` : ''}
                                {s.not_applicable > 0
                                  ? `${s.not_applicable} N/A · `
                                  : ''}Coverage {Math.round(s.coverage * 100)}%
                              </small>
                              <meter
                                min="0"
                                max="1"
                                value={s.coverage}
                                aria-label={`${sections[id as Section]} coverage`}
                              />
                              {s.coverage >= 0.5 && s.positiveShare !== null && (
                                <small>
                                  Положительных среди оценённых: {Math.round(s.positiveShare * 100)}
                                  %
                                </small>
                              )}
                            </td>
                          )}
                          <td key={id + 'highlights'}>
                            {(id === 'T' || id === 'A') && (
                              <p className="comparison-uncovered">
                                {(id === 'T'
                                  ? uncoveredTechnicalFacts(p.observations)
                                  : uncoveredAvailabilityFacts(p)
                                ).map((o) => (
                                  <span key={o.id} title={o.reasoning}>
                                    Вне тегов:{' '}
                                    {registry.criteria.find((c) => c.id === o.criterion_id)?.name} ·{' '}
                                    {show(o.value)}
                                  </span>
                                ))}
                              </p>
                            )}
                            {s.highlights.length ? (
                              <details>
                                <summary>
                                  {s.highlights.join(' · ').slice(0, 160)}
                                  {s.highlights.join(' · ').length > 160 ? '…' : ''}
                                </summary>
                                {s.highlights.join(' · ')}
                              </details>
                            ) : (
                              'Нет подтверждённых плюсов'
                            )}
                          </td>
                        </Fragment>
                      ))}
                    <td>
                      {screening.salary.length > 0 && <small>Ориентир · Levels.fyi</small>}
                      <FactChips
                        tags={screening.salary}
                        open={() => setDetail(p.company.id)}
                        limit={2}
                      />
                      <button
                        className="button"
                        aria-label={`Вся информация: ${p.company.name}`}
                        onClick={() => setDetail(p.company.id)}
                      >
                        Вся информация
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {detail && (
        <Modal title="Информация о компании" close={closeDetail} wide>
          <EvidenceProfile companyId={detail} />
        </Modal>
      )}
      {targetCompany && (
        <TargetVacanciesModal
          companyId={targetCompany.id}
          name={targetCompany.name}
          close={closeTargets}
          onJob={onJob}
          onJobs={onJobs}
        />
      )}
      {targetSourcesOpen && <TargetVacancySourcesModal close={() => setTargetSourcesOpen(false)} />}
      {columnGuide && <ComparisonColumnGuide column={columnGuide} close={closeGuide} />}
      {infrastructureGuide && (
        <ComparisonColumnGuide
          column="infrastructure"
          profile={infrastructureGuide}
          close={() => setInfrastructureGuide(null)}
        />
      )}
      {interviewCompany && (
        <CompanyInterviewModal
          companyId={interviewCompany.id}
          name={interviewCompany.name}
          close={() => setInterviewCompany(null)}
        />
      )}
      {columnDetail && (
        <CompanyColumnModal
          companyId={columnDetail.id}
          name={columnDetail.name}
          column={columnDetail.column}
          close={closeColumn}
        />
      )}
      {linksCompany && (
        <CompanyUsefulLinksModal
          companyId={linksCompany.id}
          name={linksCompany.name}
          close={() => setLinksCompany(null)}
        />
      )}
    </section>
  );
}

function FactChips({
  tags,
  open,
  limit = 3,
}: {
  tags: ResearchTag[];
  open: () => void;
  limit?: number;
}) {
  if (!tags.length) return null;
  return (
    <div className="screening-facts culture-tags">
      {tags.slice(0, limit).map((t) => (
        <button key={t.label} className="screening-fact" title={t.details} onClick={open}>
          {t.label}
        </button>
      ))}
      {tags.length > limit && (
        <button
          className="screening-fact"
          onClick={open}
          title={tags
            .slice(limit)
            .map((t) => t.label)
            .join(' · ')}
        >
          +{tags.length - limit}
        </button>
      )}
    </div>
  );
}
function EvidenceProfile({ companyId }: { companyId: string }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    // Read all countries and roles, independently of board filters.
    void api<Profile>(
      `/company-research/${encodeURIComponent(companyId)}`,
      'GET',
      undefined,
      controller.signal,
    )
      .then(setProfile)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [companyId]);
  if (!profile) return <p role="status">{error || 'Загрузка сведений…'}</p>;
  const rows = companyInformationRows(profile);
  return (
    <div className="company-information">
      <h3>{profile.company.name}</h3>
      {!rows.length ? (
        <p>Заполненных сведений пока нет.</p>
      ) : (
        <div className="compact-company-scroll">
          <table className="compact-company-table company-information-table">
            <thead>
              <tr>
                <th>Тип информации</th>
                <th>Факты</th>
                <th>Источники</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  <td>
                    {row.facts.map((fact) => (
                      <p key={fact}>{fact}</p>
                    ))}
                  </td>
                  <td>
                    {row.sources.map((source) => (
                      <p key={source.url + source.note}>
                        <a href={source.url} target="_blank" rel="noreferrer">
                          {source.title}
                        </a>
                        {source.note && <small>{source.note}</small>}
                      </p>
                    ))}
                    {row.notes.length > 0 && <small>{row.notes.join(' · ')}</small>}
                    {!row.sources.length && !row.notes.length && '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
