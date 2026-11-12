import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Bookmark,
  BookOpen,
  BriefcaseBusiness,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Compass,
  ExternalLink,
  FileDown,
  Flag,
  Globe2,
  KanbanSquare,
  ListFilter,
  Loader2,
  MapPin,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Target,
  Trash2,
  Upload,
  Wifi,
  Plug,
  X,
} from 'lucide-react';
import {
  matchJob,
  keywordLabel,
  profileLevelLabel,
  providerLabels,
  stageLabels,
  stages,
  workLabels,
  type Company,
  type Job,
  type Profile,
  type Source,
  type State,
} from '../shared/model';
import { api, date } from './api';
import { availabilityLabels } from '../shared/target-vacancies';
import { jobReviewCategory, pipelineSection } from '../shared/job-pipeline';
import { SourcesPage } from './SourcesPage';
import { ResourcesPage, type ResourceTab } from './ResourcesPage';
const AnalyticsPage = lazy(() =>
  import('./AnalyticsPage').then((module) => ({ default: module.AnalyticsPage })),
);
import {
  CompanyForm,
  CompanyWebsite,
  ErrorText,
  External,
  ImportForm,
  JobForm,
  Logo,
  Modal,
  ProfileForm,
  Salary,
  SourceForm,
} from './components';

const CompaniesPage = lazy(() =>
  import('./CompaniesPage').then((m) => ({ default: m.CompaniesPage })),
);
const CompanyDetails = lazy(() =>
  import('./CompaniesPage').then((m) => ({ default: m.CompanyDetails })),
);
const CompanyComparisonPage = lazy(() =>
  import('./CompanyComparisonPage').then((m) => ({ default: m.CompanyComparisonPage })),
);
const TargetVacanciesModal = lazy(() =>
  import('./TargetVacanciesModal').then((m) => ({ default: m.TargetVacanciesModal })),
);
import { ProfileSettingsModal } from './ProfileSettingsModal';
import './selection.css';
type Page =
  | 'jobs'
  | 'companies'
  | 'comparison'
  | 'pipeline'
  | 'sources'
  | 'profiles'
  | 'resources'
  | 'analytics'
  | 'connections';
type Dialog =
  | { kind: 'job'; item?: Job }
  | { kind: 'company'; item?: Company }
  | { kind: 'companyDetail'; id: string }
  | { kind: 'companyJobs'; id: string }
  | { kind: 'profile'; item?: Profile }
  | { kind: 'source'; company?: string }
  | { kind: 'import' }
  | { kind: 'detail'; id: string }
  | null;
const nav = [
  { id: 'jobs', label: 'Вакансии', icon: BriefcaseBusiness },
  { id: 'companies', label: 'Компании', icon: Building2 },
  { id: 'comparison', label: 'Сравнение компаний', icon: ListFilter },
  { id: 'pipeline', label: 'Моя воронка', icon: KanbanSquare },
  { id: 'analytics', label: 'Аналитика', icon: Globe2 },
  { id: 'profiles', label: 'Исходные профили', icon: SlidersHorizontal },
  { id: 'resources', label: 'Полезные ресурсы', icon: BookOpen },
  { id: 'connections', label: 'Источники', icon: Plug },
] as const;
const blank: State = {
  jobs: [],
  companies: [],
  profiles: [],
  sources: [],
  adzunaConfigured: false,
};
const reviewLabels = {
  target: 'Целевая роль',
  practice: 'Для тренировки',
  reject: 'Не подходит',
  uncertain: 'Нужна проверка',
};

const pipelineStages = stages.filter((stage) => stage !== 'archived');

function readStorage(key: string) {
  try {
    return localStorage.getItem(key) || '';
  } catch {
    return '';
  }
}
export default function App() {
  const [state, setState] = useState<State>(blank);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState<Page>('comparison');
  const [profileSettings, setProfileSettings] = useState(false);
  const [advancedNav, setAdvancedNav] = useState(false);
  const closeProfileSettings = useCallback(() => setProfileSettings(false), []);
  const [comparisonExpanded, setComparisonExpanded] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => readStorage('scout-sidebar-collapsed') === 'true',
  );
  const [resourceTab, setResourceTab] = useState<ResourceTab>('search');
  const isSources = page === 'resources' && resourceTab === 'sources';
  const [dialog, setDialog] = useState<Dialog>(null);
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState('');
  const [profileId, setProfileId] = useState(readStorage('scout-profile'));
  const [companyFilter, setCompanyFilter] = useState('');
  const [pipelineView, setPipelineView] = useState<'working' | 'review'>('working');
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState('all');
  const [mode, setMode] = useState('all');
  const [level, setLevel] = useState('all');
  const [location, setLocation] = useState('');
  const [source, setSource] = useState('all');
  const [minMatch, setMinMatch] = useState(0);
  const [sort, setSort] = useState('new');
  const [moreFilters, setMoreFilters] = useState(false);
  const [scopedJobIds, setScopedJobIds] = useState<string[] | null>(null);
  const [showExcluded, setShowExcluded] = useState(false);
  const [visibleCount, setVisibleCount] = useState(40);
  const [syncResults, setSyncResults] = useState<
    {
      name: string;
      added: number;
      total: number;
      cached?: boolean;
      error?: string;
      reviewBatchIds?: string[];
      pendingReview?: number;
    }[]
  >([]);
  const close = useCallback(() => setDialog(null), []);
  const refresh = useCallback(async () => {
    const data = await api<State>('/state');
    setState(data);
    setError('');
  }, []);
  useEffect(() => {
    refresh()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [refresh]);
  useEffect(() => {
    if (toast) {
      const id = setTimeout(() => setToast(''), 5000);
      return () => clearTimeout(id);
    }
  }, [toast]);
  useEffect(
    () => setVisibleCount(40),
    [search, tab, mode, level, location, source, minMatch, sort, showExcluded, profileId],
  );
  const profile =
    state.effectiveProfile || state.profiles.find((p) => p.id === profileId) || state.profiles[0];
  const matches = useMemo(
    () => new Map(state.jobs.map((j) => [j.id, matchJob(j, profile)])),
    [state.jobs, profile],
  );
  const jobs = useMemo(
    () =>
      state.jobs
        .filter((j) => {
          const match = matches.get(j.id)!;
          const historical = pipelineSection(j, state.jobAvailability?.[j.id]) === 'history';
          return (
            jobReviewCategory(j) !== 'reject' &&
            (tab === 'saved_targets' ||
              (tab === 'archived'
                ? historical
                : !historical &&
                  (tab === 'all' ||
                    (tab === 'favorites'
                      ? j.favorite
                      : tab === 'due'
                        ? !!j.followUp &&
                          j.followUp <= new Date().toLocaleDateString('en-CA') &&
                          j.stage !== 'offer'
                        : j.stage === tab)))) &&
            (!companyFilter || j.companyId === companyFilter) &&
            (scopedJobIds === null || scopedJobIds.includes(j.id)) &&
            (!search ||
              [j.title, j.company, ...j.tags, j.description]
                .join(' ')
                .toLowerCase()
                .includes(search.toLowerCase())) &&
            (mode === 'all' || j.workMode === mode) &&
            (level === 'all' || j.seniority === level) &&
            (!location || j.location.toLowerCase().includes(location.toLowerCase())) &&
            (source === 'all' || j.source === source) &&
            (!minMatch || (match.score !== null && match.score >= minMatch)) &&
            (showExcluded || !match.excluded)
          );
        })
        .sort((a, b) =>
          sort === 'ai'
            ? (b.aiScore ?? -1) - (a.aiScore ?? -1)
            : sort === 'match'
              ? (matches.get(b.id)?.score ?? -1) - (matches.get(a.id)?.score ?? -1)
              : sort === 'company'
                ? a.company.localeCompare(b.company)
                : b.createdAt.localeCompare(a.createdAt),
        ),
    [
      state.jobs,
      state.jobAvailability,
      matches,
      companyFilter,
      scopedJobIds,
      search,
      tab,
      mode,
      level,
      location,
      source,
      minMatch,
      sort,
      showExcluded,
    ],
  );
  const catalogJobs = state.jobs.filter((j) => jobReviewCategory(j) !== 'reject');
  const active = catalogJobs.filter(
    (j) => pipelineSection(j, state.jobAvailability?.[j.id]) !== 'history',
  );
  const pipeline = useMemo(() => {
    const working: Job[] = [];
    const review: Job[] = [];
    const workingJobIds = state.workingJobIds && new Set(state.workingJobIds);
    for (const job of state.jobs) {
      if (companyFilter && job.companyId !== companyFilter) continue;
      const section = pipelineSection(job, state.jobAvailability?.[job.id]);
      if (section === 'working' && (!workingJobIds || workingJobIds.has(job.id))) working.push(job);
      if (section === 'review') review.push(job);
    }
    return { working, review };
  }, [state.jobs, state.jobAvailability, state.workingJobIds, companyFilter]);
  const inProgress = active.filter((j) => ['applied', 'interview'].includes(j.stage));
  const good = active.filter((j) => (matches.get(j.id)?.score ?? -1) >= 70);
  const due = active.filter(
    (j) =>
      j.followUp && j.followUp <= new Date().toLocaleDateString('en-CA') && j.stage !== 'offer',
  );
  const navigate = (p: Page) => {
    setPage(p === 'sources' ? 'resources' : p);
    if (p === 'sources') setResourceTab('sources');
    setSearch('');
    setTab('all');
    setCompanyFilter('');
    setScopedJobIds(null);
    setPipelineView('working');
  };
  const openCompanyPipeline = (companyId: string) => {
    close();
    navigate('pipeline');
    setCompanyFilter(companyId);
    void refresh().catch((e: Error) => setError(e.message));
  };
  const openCompanyJobs = (companyId: string, ids: string[]) => {
    close();
    navigate('jobs');
    resetFilters();
    setCompanyFilter(companyId);
    setScopedJobIds(ids);
    setShowExcluded(true);
    setTab('saved_targets');
    void refresh().catch((e: Error) => setError(e.message));
  };
  const openCompanyJob = (id: string) => {
    setDialog({ kind: 'detail', id });
    if (!state.jobs.some((job) => job.id === id))
      void refresh().catch((e: Error) => setError(e.message));
  };
  const notify = async (fn: () => Promise<unknown>, message?: string) => {
    try {
      await fn();
      await refresh();
      if (message) setToast(message);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const done = () => {
    close();
    void notify(async () => {}, 'Изменения сохранены');
  };
  const runSync = async (sourceId?: string) => {
    setSyncing(true);
    setError('');
    try {
      const result = await api('/sync', 'POST', { sourceId });
      setSyncResults(result.results);
      await refresh();
      const added = result.results.reduce((n: number, r: { added: number }) => n + r.added, 0);
      const pending = result.results.reduce(
        (n: number, r: { pendingReview?: number }) => n + (r.pendingReview || 0),
        0,
      );
      setToast(`Добавлено: ${added} · На проверке: ${pending}. Результаты в разделе «Ресурсы».`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSyncing(false);
    }
  };
  const editJob = (id: string, data: Partial<Job>) =>
    notify(() => api(`/jobs/${id}`, 'PATCH', data));
  const selectProfile = (id: string) => {
    setProfileId(id);
    try {
      localStorage.setItem('scout-profile', id);
    } catch {
      /* Persistence is optional. */
    }
  };
  const details =
    dialog?.kind === 'detail' ? state.jobs.find((j) => j.id === dialog.id) : undefined;
  const detailDiscoveryReview = details?.catalogReview ? undefined : details?.discoveryAssessment;
  const detailReview = details?.catalogReview ?? detailDiscoveryReview;
  const detailAvailability = details ? state.jobAvailability?.[details.id] : undefined;
  const pipelineCompany = state.companies.find((company) => company.id === companyFilter);
  const configured =
    !!profile &&
    (profile.keywords.length > 0 ||
      profile.locations.length > 0 ||
      profile.workMode !== 'any' ||
      profile.seniority !== 'any' ||
      profile.minSalary !== null);
  const resetFilters = () => {
    setCompanyFilter('');
    setScopedJobIds(null);
    setSearch('');
    setMode('all');
    setLevel('all');
    setLocation('');
    setSource('all');
    setMinMatch(0);
    setShowExcluded(false);
    setTab('all');
  };
  const filtersActive = !!(
    companyFilter ||
    scopedJobIds !== null ||
    search ||
    mode !== 'all' ||
    level !== 'all' ||
    location ||
    source !== 'all' ||
    minMatch ||
    showExcluded
  );

  return (
    <div
      className={`app-shell${sidebarCollapsed ? ' sidebar-collapsed' : ''}${page === 'comparison' && comparisonExpanded ? ' comparison-expanded' : ''}`}
    >
      <aside className="sidebar">
        <a
          className="brand"
          aria-label="Jobs checker — главная"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate('comparison');
          }}
        >
          <span className="brand-mark">
            <Compass size={26} strokeWidth={1.5} />
          </span>
          <span>Jobs checker</span>
        </a>
        <button
          className="sidebar-toggle"
          aria-label={sidebarCollapsed ? 'Развернуть меню' : 'Свернуть меню'}
          title={sidebarCollapsed ? 'Развернуть меню' : 'Свернуть меню'}
          aria-expanded={!sidebarCollapsed}
          aria-controls="main-navigation"
          onClick={() => {
            const collapsed = !sidebarCollapsed;
            setSidebarCollapsed(collapsed);
            try {
              localStorage.setItem('scout-sidebar-collapsed', String(collapsed));
            } catch {
              // The menu still works when browser storage is unavailable.
            }
          }}
        >
          {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>
        <nav id="main-navigation">
          {[...nav]
            .sort((a, b) => Number(b.id === 'comparison') - Number(a.id === 'comparison'))
            .filter((item) => advancedNav || ['comparison', 'pipeline'].includes(item.id))
            .map((item) => (
              <button
                key={item.id}
                aria-label={item.label}
                title={item.label}
                className={`nav-item ${page === item.id ? 'active' : ''}`}
                onClick={() => navigate(item.id)}
              >
                <item.icon size={19} strokeWidth={1.7} />
                <span>{item.label}</span>
                {item.id === 'jobs' && active.length > 0 && <b>{active.length}</b>}
                {item.id === 'pipeline' && inProgress.length > 0 && <span className="nav-dot" />}
              </button>
            ))}
          <button
            className="nav-item"
            aria-label="Дополнительно"
            title="Дополнительно"
            aria-expanded={advancedNav}
            onClick={() => setAdvancedNav((v) => !v)}
          >
            <ChevronDown size={19} />
            <span>Дополнительно</span>
          </button>
        </nav>
        <div className="sidebar-profile">
          <button
            className="nav-item"
            onClick={() => setProfileSettings(true)}
            title={state.selection?.core.name || 'Мой профиль'}
          >
            <Settings2 size={19} />
            <span>{state.selection?.core.name || 'Мой профиль'}</span>
          </button>
        </div>
        <div className="sidebar-bottom">
          <a
            className="sidebar-export"
            href="/api/export"
            title="Экспорт JSON"
            aria-label="Экспорт JSON"
          >
            <ArrowDownToLine size={17} />
            <span>Экспорт JSON</span>
          </a>
        </div>
      </aside>
      <div className="main-shell">
        <main>
          <div className="page-heading">
            <div>
              <h1>{nav.find((item) => item.id === page)?.label}</h1>
            </div>
            <div className="heading-actions">
              <button
                className="notification-button"
                title="Действия на сегодня"
                aria-label="Действия на сегодня"
                onClick={() => {
                  navigate('jobs');
                  resetFilters();
                  setTab('due');
                }}
              >
                <Bell size={18} />
                {due.length > 0 && <i />}
              </button>
              {page === 'comparison' ? null : page === 'resources' ? (
                <button className="button secondary" onClick={() => setProfileSettings(true)}>
                  <Target size={16} />
                  Мой профиль
                </button>
              ) : (
                <button className="button secondary" onClick={() => setDialog({ kind: 'import' })}>
                  <Upload size={16} />
                  Импорт
                </button>
              )}
              {page !== 'comparison' && page !== 'profiles' && (
                <button
                  className="button primary"
                  onClick={() =>
                    setDialog({
                      kind: page === 'companies' ? 'company' : isSources ? 'source' : 'job',
                    })
                  }
                >
                  <Plus size={17} />
                  {page === 'companies'
                    ? 'Компания'
                    : isSources
                      ? 'Ресурс'
                      : page === 'resources'
                        ? 'Добавить вакансию'
                        : 'Вакансия'}
                </button>
              )}
            </div>
          </div>
          {error && (
            <div className="page-error">
              <ErrorText error={error} />
              <button
                className="icon-button"
                onClick={() => setError('')}
                aria-label="Скрыть ошибку"
              >
                <X size={16} />
              </button>
            </div>
          )}
          {state.jobs.some((j) => j.demo) && (
            <div className="demo-banner">
              <span>
                <Sparkles size={15} />В базе есть вымышленные примеры, отмеченные «Демо».
              </span>
              <button
                onClick={() =>
                  void notify(() => api('/demo', 'DELETE', {}), 'Демонстрационные записи удалены')
                }
              >
                Убрать демо <X size={13} />
              </button>
            </div>
          )}
          {loading ? (
            <div className="loading">
              <Loader2 className="spin" />
              Загружаем ваше пространство…
            </div>
          ) : (
            <>
              {page === 'jobs' && (
                <div className="stats-grid">
                  <Stat
                    label="Возможностей в базе"
                    value={active.length}
                    icon={<BriefcaseBusiness size={18} />}
                    text={`${state.companies.length} компаний в поле зрения`}
                  />
                  <Stat
                    label="Совпадают с профилем"
                    value={configured ? good.length : '—'}
                    icon={<Target size={18} />}
                    text={configured ? 'Совпадение от 70%' : 'Настройте критерии поиска'}
                    green
                  />
                  <Stat
                    label="В процессе"
                    value={inProgress.length}
                    icon={<Flag size={18} />}
                    text="Отклики и собеседования"
                  />
                  <Stat
                    label="Следующий шаг"
                    value={due.length}
                    icon={<Bell size={18} />}
                    text={
                      due.length ? 'Запланировано на сегодня и ранее' : 'Нет действий на сегодня'
                    }
                  />
                </div>
              )}
              {page === 'jobs' && (
                <div className="jobs-layout">
                  <section className="jobs-section">
                    <div className="section-top">
                      <div className="tabs">
                        {tab === 'saved_targets' && (
                          <button className="selected">Целевые · вся история</button>
                        )}
                        {[
                          ['all', 'Все вакансии'],
                          ['favorites', 'Избранное'],
                          ['new', 'Новые'],
                          ['archived', 'Архив'],
                        ].map(([v, t]) => (
                          <button
                            key={v}
                            onClick={() => setTab(v)}
                            className={tab === v ? 'selected' : ''}
                          >
                            {t}
                            {v === 'all' && <span>{active.length}</span>}
                          </button>
                        ))}
                        {tab === 'due' && (
                          <button className="selected" onClick={() => setTab('due')}>
                            На сегодня
                          </button>
                        )}
                      </div>
                      <button
                        className="button ghost compact"
                        disabled={syncing}
                        onClick={() => void runSync()}
                      >
                        <RefreshCw size={15} className={syncing ? 'spin' : ''} />
                        {syncing ? 'Загрузка…' : 'Обновить'}
                      </button>
                    </div>
                    <div className="filters">
                      <div className="search-input">
                        <Search size={17} />
                        <input
                          aria-label="Поиск вакансий"
                          placeholder="Должность, компания или навык"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                        {search && (
                          <button
                            className="icon-button"
                            aria-label="Очистить поиск"
                            onClick={() => setSearch('')}
                          >
                            <X size={14} />
                          </button>
                        )}
                      </div>
                      <select
                        aria-label="Формат работы"
                        value={mode}
                        onChange={(e) => setMode(e.target.value)}
                      >
                        <option value="all">Любой формат</option>
                        {Object.entries(workLabels).map(([v, t]) => (
                          <option key={v} value={v}>
                            {t}
                          </option>
                        ))}
                      </select>
                      <button
                        className={`filter-button ${moreFilters ? 'selected' : ''}`}
                        title="Дополнительные фильтры"
                        onClick={() => setMoreFilters(!moreFilters)}
                      >
                        <SlidersHorizontal size={17} />
                        <span>Фильтры</span>
                      </button>
                    </div>
                    {moreFilters && (
                      <div className="extended-filters">
                        <label>
                          География
                          <input
                            value={location}
                            onChange={(e) => setLocation(e.target.value)}
                            placeholder="Europe, Berlin…"
                          />
                        </label>
                        <label>
                          Уровень
                          <select value={level} onChange={(e) => setLevel(e.target.value)}>
                            <option value="all">Любой уровень</option>
                            {['intern', 'junior', 'middle', 'senior', 'lead', 'unknown'].map(
                              (v) => (
                                <option key={v} value={v}>
                                  {v === 'unknown' ? 'Не указан' : v}
                                </option>
                              ),
                            )}
                          </select>
                        </label>
                        <label>
                          Источник
                          <select value={source} onChange={(e) => setSource(e.target.value)}>
                            <option value="all">Все источники</option>
                            {Object.entries(providerLabels).map(([v, t]) => (
                              <option key={v} value={v}>
                                {t}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Совпадение
                          <select
                            value={minMatch}
                            onChange={(e) => setMinMatch(Number(e.target.value))}
                          >
                            <option value={0}>Любое</option>
                            <option value={50}>От 50%</option>
                            <option value={70}>От 70%</option>
                            <option value={90}>От 90%</option>
                          </select>
                        </label>
                        <label className="check-label">
                          <input
                            type="checkbox"
                            checked={showExcluded}
                            onChange={(e) => setShowExcluded(e.target.checked)}
                          />
                          Показывать исключения профиля
                        </label>
                      </div>
                    )}
                    <div className="results-bar">
                      <span>
                        {scopedJobIds !== null && 'Выборка компаний · '}
                        {companyFilter &&
                          `${state.companies.find((c) => c.id === companyFilter)?.name} · `}
                        Вакансий: {jobs.length}
                        {filtersActive && <button onClick={resetFilters}>Сбросить фильтры</button>}
                      </span>
                      <label>
                        Сначала
                        <select
                          aria-label="Сортировка"
                          value={sort}
                          onChange={(e) => setSort(e.target.value)}
                        >
                          <option value="new">недавно добавленные</option>
                          <option value="match">релевантные</option>
                          <option value="ai">высокий AI-score</option>
                          <option value="company">по компании</option>
                        </select>
                      </label>
                    </div>
                    {!jobs.length ? (
                      <Empty
                        type={state.jobs.length ? 'filtered' : 'initial'}
                        onAdd={() => setDialog({ kind: 'job' })}
                        onSource={() => navigate('sources')}
                        onReset={resetFilters}
                        onDemo={() =>
                          void notify(
                            () => api('/demo', 'POST', {}),
                            'Демонстрационные записи добавлены',
                          )
                        }
                      />
                    ) : (
                      <div className="job-list">
                        {jobs.slice(0, visibleCount).map((j) => (
                          <article className="job-card" key={j.id}>
                            <div className="job-main">
                              <Logo name={j.company} />
                              <div className="job-content">
                                <div className="company-line">
                                  <span>{j.company}</span>
                                  <span className="small-dot" />
                                  {j.demo ? (
                                    <span className="demo-label">Демо</span>
                                  ) : (
                                    <span>{providerLabels[j.source]}</span>
                                  )}
                                </div>
                                <button
                                  className="job-title"
                                  onClick={() => setDialog({ kind: 'detail', id: j.id })}
                                >
                                  {j.title}
                                </button>
                                <div className="job-meta">
                                  <span>
                                    <MapPin size={13} />
                                    {j.location || 'География не указана'}
                                  </span>
                                  <span>
                                    <Globe2 size={13} />
                                    {workLabels[j.workMode]}
                                  </span>
                                  {j.seniority !== 'unknown' && (
                                    <span className="seniority">{j.seniority}</span>
                                  )}
                                </div>
                              </div>
                              <div className="job-actions">
                                {j.aiScore != null && (
                                  <button
                                    className={`ai-score ${j.aiScore >= 8 ? 'strong' : ''}`}
                                    title={j.aiSummary || 'Открыть AI-оценку'}
                                    onClick={() => setDialog({ kind: 'detail', id: j.id })}
                                  >
                                    <Sparkles size={13} /> AI {j.aiScore}/10
                                  </button>
                                )}
                                <button
                                  className={`bookmark ${j.favorite ? 'saved' : ''}`}
                                  aria-label={
                                    j.favorite
                                      ? `Убрать из избранного: ${j.title}`
                                      : `В избранное: ${j.title}`
                                  }
                                  onClick={() => void editJob(j.id, { favorite: !j.favorite })}
                                >
                                  <Bookmark size={18} fill={j.favorite ? 'currentColor' : 'none'} />
                                </button>
                                {matches.get(j.id)?.score !== null && (
                                  <button
                                    className={`match-badge ${(matches.get(j.id)?.score || 0) >= 70 ? 'good' : ''}`}
                                    title="Показать причины совпадения"
                                    onClick={() => setDialog({ kind: 'detail', id: j.id })}
                                  >
                                    <Sparkles size={12} />
                                    Фильтр {matches.get(j.id)?.score}%
                                  </button>
                                )}
                              </div>
                            </div>
                            {j.aiSummary && <p className="job-ai-summary">{j.aiSummary}</p>}
                            <div className="job-bottom">
                              <div className="job-tags">
                                {j.tags.slice(0, 3).map((t, i) => (
                                  <span key={`${t}-${i}`}>{t}</span>
                                ))}
                              </div>
                              <div className="salary">
                                <Salary job={j} />
                              </div>
                            </div>
                            <div className="job-footer">
                              <span className={`stage-indicator stage-${j.stage}`}>
                                <i />
                                {stageLabels[j.stage]}
                              </span>
                              <span>
                                {j.followUp && (
                                  <span className="followup-inline">
                                    <Bell size={12} />
                                    {date(j.followUp)} ·{' '}
                                  </span>
                                )}
                                Добавлено {date(j.createdAt)}
                              </span>
                              <button onClick={() => setDialog({ kind: 'detail', id: j.id })}>
                                Подробнее <ArrowUpRight size={14} />
                              </button>
                            </div>
                          </article>
                        ))}
                        {jobs.length > visibleCount && (
                          <button
                            className="button secondary load-more"
                            onClick={() => setVisibleCount((v) => v + 40)}
                          >
                            Показать ещё · осталось {jobs.length - visibleCount}
                          </button>
                        )}
                      </div>
                    )}
                  </section>
                </div>
              )}
              {page === 'companies' && (
                <Suspense
                  fallback={
                    <div className="loading">
                      <Loader2 className="spin" />
                      Загрузка компаний…
                    </div>
                  }
                >
                  <CompaniesPage
                    companies={state.companies}
                    jobs={state.jobs}
                    onDetail={(id) => setDialog({ kind: 'companyDetail', id })}
                    onAdd={() => setDialog({ kind: 'company' })}
                    onJobs={(companyId, ids) => {
                      navigate('jobs');
                      resetFilters();
                      setCompanyFilter(companyId);
                      setScopedJobIds(ids);
                    }}
                  />
                </Suspense>
              )}
              {page === 'comparison' && (
                <Suspense fallback={<div className="loading">Загрузка сравнения…</div>}>
                  <CompanyComparisonPage
                    selection={state.selection}
                    onProfileSettings={() => setProfileSettings(true)}
                    onSelectionChanged={refresh}
                    expanded={comparisonExpanded}
                    onExpandedChange={setComparisonExpanded}
                    onDetail={(id) => setDialog({ kind: 'companyDetail', id })}
                    onJob={openCompanyJob}
                    onJobs={openCompanyJobs}
                    onPipeline={openCompanyPipeline}
                    profileId={profile?.id || ''}
                    companyRevision={[
                      String(state.selection?.version || ''),
                      ...state.companies.map((c) => c.id + ':' + c.updatedAt),
                      ...state.jobs.map((j) => {
                        const availability = state.jobAvailability?.[j.id];
                        return [
                          j.id,
                          j.updatedAt,
                          j.lastSeenAt,
                          availability?.state,
                          availability?.checkedAt,
                          availability?.verifiedAt,
                        ].join(':');
                      }),
                      ...state.sources.map((s) => s.id + ':' + s.lastSync),
                    ].join('|')}
                  />
                </Suspense>
              )}
              {page === 'pipeline' && (
                <>
                  <div className="standalone-toolbar">
                    <div className="search-input">
                      <Search size={17} />
                      <input
                        placeholder="Поиск по воронке"
                        aria-label="Поиск по воронке"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </div>
                    <label className="pipeline-view">
                      <span>Показывать</span>
                      <select
                        value={pipelineView}
                        onChange={(event) =>
                          setPipelineView(event.target.value as 'working' | 'review')
                        }
                      >
                        <option value="working">
                          Открытые для работы ({pipeline.working.length})
                        </option>
                        <option value="review">На проверке ({pipeline.review.length})</option>
                      </select>
                    </label>
                    {pipelineCompany && (
                      <div className="pipeline-scope">
                        <button
                          className="text-link"
                          onClick={() =>
                            setDialog({ kind: 'companyDetail', id: pipelineCompany.id })
                          }
                        >
                          {pipelineCompany.name}
                        </button>
                        <button
                          className="icon-button"
                          aria-label="Показать все компании"
                          onClick={() => setCompanyFilter('')}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    )}
                    <span className="pipeline-tip">
                      Перетащите карточку или выберите этап в ней
                    </span>
                  </div>
                  <div className="kanban">
                    {pipelineStages.map((s) => {
                      const cards = pipeline[pipelineView].filter(
                        (j) =>
                          j.stage === s &&
                          (!search ||
                            `${j.title} ${j.company}`.toLowerCase().includes(search.toLowerCase())),
                      );
                      return (
                        <section
                          className={`kanban-column column-${s}`}
                          key={s}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => {
                            e.preventDefault();
                            const id = e.dataTransfer.getData('text/plain');
                            if (state.jobs.some((j) => j.id === id)) void editJob(id, { stage: s });
                          }}
                        >
                          <h3>
                            <span className={`stage-indicator stage-${s}`}>
                              <i />
                              {stageLabels[s]}
                            </span>
                            <b>{cards.length}</b>
                          </h3>
                          <div className="kanban-cards">
                            {cards.map((j) => (
                              <article
                                draggable
                                onDragStart={(e) => {
                                  e.dataTransfer.setData('text/plain', j.id);
                                  e.dataTransfer.effectAllowed = 'move';
                                }}
                                className="kanban-card"
                                key={j.id}
                              >
                                <div>
                                  <Logo name={j.company} />
                                  <span>
                                    <button
                                      className="text-link pipeline-company-link"
                                      onClick={() =>
                                        setDialog({ kind: 'companyDetail', id: j.companyId })
                                      }
                                    >
                                      {j.company}
                                    </button>
                                    {j.demo && <small>Демо</small>}
                                  </span>
                                </div>
                                <button
                                  className="job-title"
                                  onClick={() => setDialog({ kind: 'detail', id: j.id })}
                                >
                                  {j.title}
                                </button>
                                <small className="pipeline-job-status">
                                  {reviewLabels[jobReviewCategory(j) ?? 'uncertain']}
                                  {pipelineView === 'review' &&
                                    ` · ${availabilityLabels[state.jobAvailability?.[j.id]?.state ?? 'unverified']}`}
                                </small>
                                <p>
                                  <MapPin size={12} />
                                  {j.location || 'Не указано'}
                                </p>
                                {j.followUp && (
                                  <div className="kanban-date">
                                    <Bell size={12} />
                                    {date(j.followUp)}
                                  </div>
                                )}
                                <select
                                  aria-label={`Этап: ${j.title}`}
                                  value={j.stage}
                                  onChange={(e) =>
                                    void editJob(j.id, { stage: e.target.value as Job['stage'] })
                                  }
                                >
                                  {stages.map((stage) => (
                                    <option key={stage} value={stage}>
                                      {stageLabels[stage]}
                                    </option>
                                  ))}
                                </select>
                              </article>
                            ))}
                          </div>
                          {!cards.length && (
                            <div className="kanban-placeholder">
                              Здесь появятся вакансии
                              <br />
                              на этом этапе
                            </div>
                          )}
                        </section>
                      );
                    })}
                  </div>
                </>
              )}
              {page === 'analytics' && (
                <Suspense
                  fallback={
                    <div className="loading">
                      <Loader2 className="spin" />
                      Загрузка аналитики…
                    </div>
                  }
                >
                  <AnalyticsPage
                    jobs={state.jobs}
                    profile={profile}
                    onOpen={(id) => setDialog({ kind: 'detail', id })}
                  />
                </Suspense>
              )}
              {page === 'connections' && (
                <SourcesPage
                  state={state}
                  profile={profile}
                  refresh={refresh}
                  openJob={(id) => setDialog({ kind: 'detail', id })}
                />
              )}
              {page === 'resources' && (
                <ResourcesPage
                  activeTab={resourceTab}
                  onTabChange={setResourceTab}
                  sourcesCount={state.sources.length}
                  sourcesPanel={
                    <>
                      <div className="source-banner">
                        <div className="source-banner-icon">
                          <Globe2 size={35} strokeWidth={1.2} />
                        </div>
                        <div>
                          <h2>Загрузка вакансий</h2>
                          <p>
                            Remotive помогает открывать новые компании, карьерные страницы — следить
                            за выбранными.
                          </p>
                        </div>
                        <button
                          className="button primary"
                          disabled={syncing || !state.sources.some((s) => s.enabled)}
                          onClick={() => void runSync()}
                        >
                          <RefreshCw size={16} className={syncing ? 'spin' : ''} />
                          {syncing ? 'Загружаем…' : 'Обновить всё'}
                        </button>
                      </div>
                      {syncResults.length > 0 && (
                        <div className="sync-results">
                          <h3>Результат последнего запуска</h3>
                          {syncResults.map((r, i) => (
                            <div key={i} className={r.error ? 'sync-error' : ''}>
                              <span>
                                {r.error ? <CircleHelp size={16} /> : <CheckCircle2 size={16} />}
                                {r.name}
                              </span>
                              <span>
                                {r.error ||
                                  (r.cached
                                    ? `Данные свежие · ${r.total} вакансий в последней загрузке`
                                    : `+${r.added} новых · получено ${r.total}`)}
                                {r.pendingReview ? ` · На проверке: ${r.pendingReview}` : ''}
                              </span>
                              {r.reviewBatchIds?.map((id) => (
                                <small key={id}>
                                  Пакет для проверки агентом: <code>{id}</code>
                                </small>
                              ))}
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="section-label">
                        <h2>
                          Подключённые ресурсы <span>{state.sources.length}</span>
                        </h2>
                        <p>Обновляются по вашему запросу</p>
                      </div>
                      <div className="sources-grid">
                        {state.sources.map((s) => (
                          <article
                            className={`source-card ${!s.enabled ? 'disabled-source' : ''}`}
                            key={s.id}
                          >
                            <div className="source-card-header">
                              <span className={`provider-icon provider-${s.provider}`}>
                                {providerLabels[s.provider][0]}
                              </span>
                              <div>
                                <h3>{s.name}</h3>
                                <span>
                                  {providerLabels[s.provider]}
                                  {s.board && ` / ${s.board}`}
                                </span>
                              </div>
                              <button
                                className={`toggle ${s.enabled ? 'on' : ''}`}
                                disabled={syncing}
                                role="switch"
                                aria-checked={s.enabled}
                                aria-label={`Источник ${s.name}`}
                                onClick={() =>
                                  void notify(() =>
                                    api(`/sources/${s.id}`, 'PATCH', { enabled: !s.enabled }),
                                  )
                                }
                              >
                                <i />
                              </button>
                            </div>
                            <div className="source-details">
                              <span>
                                {s.provider === 'adzuna'
                                  ? `${s.country.toUpperCase()} · ${s.query}`
                                  : s.provider === 'remotive'
                                    ? 'Разные компании · удалённая работа'
                                    : 'Карьерная страница компании'}
                              </span>
                              <b>{s.count} вакансий</b>
                            </div>
                            {s.error && <ErrorText error={s.error} />}
                            <div className="source-card-footer">
                              <span>
                                {s.lastSync
                                  ? `Обновлено ${date(s.lastSync)} в ${new Date(s.lastSync).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
                                  : 'Ещё не загружали'}
                              </span>
                              <button
                                className="icon-button"
                                title="Удалить источник"
                                aria-label={`Удалить источник ${s.name}`}
                                disabled={syncing}
                                onClick={() => {
                                  if (
                                    confirm(
                                      'Удалить источник? Уже загруженные вакансии сохранятся.',
                                    )
                                  )
                                    void notify(
                                      () => api(`/sources/${s.id}`, 'DELETE', {}),
                                      'Источник удалён',
                                    );
                                }}
                              >
                                <Trash2 size={15} />
                              </button>
                              <button
                                className="button ghost compact"
                                disabled={syncing || !s.enabled}
                                onClick={() => void runSync(s.id)}
                              >
                                <RefreshCw size={14} />
                                Обновить
                              </button>
                            </div>
                          </article>
                        ))}
                        <button
                          className="add-source-card"
                          onClick={() => setDialog({ kind: 'source' })}
                        >
                          <Plus size={24} />
                          <strong>Подключить ресурс</strong>
                          <span>Greenhouse, Lever, Ashby и другие</span>
                        </button>
                      </div>
                      <div className="source-info-grid">
                        <div className="info-card">
                          <h3>
                            <Wifi size={18} />
                            Без регистрации
                          </h3>
                          <p>
                            Remotive — поиск среди разных компаний. Greenhouse, Lever и Ashby —
                            вакансии с конкретной карьерной страницы. Достаточно её ссылки.
                          </p>
                          <p>
                            Remotive обновляется раз в 6 часов, ATS — раз в 15 минут. Система
                            показывает статус и ошибки каждого источника.
                          </p>
                        </div>
                        <div className="info-card">
                          <h3>
                            <ExternalLink size={18} />
                            Более широкий поиск
                          </h3>
                          <p>
                            Adzuna ищет по запросу и стране. Для подключения нужны APP ID и API Key
                            в локальном .env.
                          </p>
                          <External href="https://developer.adzuna.com/">
                            {state.adzunaConfigured
                              ? 'Ключи настроены · документация'
                              : 'Получить доступ к Adzuna'}
                          </External>
                        </div>
                        <div className="info-card">
                          <h3>
                            <FileDown size={18} />
                            Любой другой источник
                          </h3>
                          <p>
                            Нашли компанию на LinkedIn, в каталоге или через чат? Добавьте её
                            вручную или импортируйте подборку в JSON / CSV.
                          </p>
                          <button
                            className="text-link"
                            onClick={() => setDialog({ kind: 'import' })}
                          >
                            Импортировать <ArrowRight size={14} />
                          </button>
                        </div>
                      </div>
                      <p className="source-footnote">
                        Remotive — источник публикаций с задержкой 24 часа. Удалённая работа может
                        иметь ограничения по стране. Исчезнувшие публикации автоматически не
                        удаляются: проверяйте доступность по ссылке перед откликом.
                      </p>
                    </>
                  }
                  onSources={() => navigate('sources')}
                  onCompanies={() => navigate('companies')}
                />
              )}
              {page === 'profiles' && (
                <section className="legacy-profiles">
                  <p>
                    Исходные записи сохранены для истории. Текущий профиль и сценарии редактируются
                    через шестерёнку в сравнении компаний.
                  </p>
                  <button className="button primary" onClick={() => setProfileSettings(true)}>
                    Настроить текущий профиль
                  </button>
                  {state.profiles.map((p) => (
                    <details key={p.id}>
                      <summary>{p.name}</summary>
                      <p>{p.notes}</p>
                      <p>{p.locations.join(', ')}</p>
                      <p>{p.keywords.join(', ')}</p>
                    </details>
                  ))}
                </section>
              )}
            </>
          )}
        </main>
      </div>
      {profileSettings && state.selection && (
        <ProfileSettingsModal
          config={state.selection}
          close={closeProfileSettings}
          saved={refresh}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
          <button
            className="icon-button"
            onClick={() => setToast('')}
            aria-label="Скрыть уведомление"
          >
            <X size={14} />
          </button>
        </div>
      )}
      {dialog?.kind === 'companyJobs' && (
        <Suspense fallback={<div className="loading">Загрузка вакансий…</div>}>
          <TargetVacanciesModal
            companyId={dialog.id}
            name={state.companies.find((company) => company.id === dialog.id)?.name || 'Компания'}
            close={close}
            onJob={openCompanyJob}
            onJobs={openCompanyJobs}
            onPipeline={openCompanyPipeline}
          />
        </Suspense>
      )}
      {dialog && dialog.kind !== 'companyJobs' && (
        <Modal
          title={
            dialog.kind === 'job'
              ? dialog.item
                ? 'Редактировать вакансию'
                : 'Новая возможность'
              : dialog.kind === 'companyDetail'
                ? state.companies.find((c) => c.id === dialog.id)?.name || 'Компания'
                : dialog.kind === 'company'
                  ? dialog.item
                    ? dialog.item.name
                    : 'Добавить компанию'
                  : dialog.kind === 'profile'
                    ? 'Ваш профиль поиска'
                    : dialog.kind === 'source'
                      ? 'Подключить источник'
                      : dialog.kind === 'import'
                        ? 'Пополнить пространство'
                        : 'Подробнее о возможности'
          }
          close={close}
          wide={dialog.kind === 'detail' || dialog.kind === 'import'}
        >
          {dialog.kind === 'job' && (
            <JobForm job={dialog.item} companies={state.companies} done={done} />
          )}
          {dialog.kind === 'company' && <CompanyForm company={dialog.item} done={done} />}
          {dialog.kind === 'companyDetail' &&
            (() => {
              const company = state.companies.find((c) => c.id === dialog.id);
              return company ? (
                <Suspense fallback={<Loader2 className="spin" />}>
                  <div className="detail-actions company-vacancy-navigation">
                    <button
                      className="button secondary"
                      onClick={() => setDialog({ kind: 'companyJobs', id: company.id })}
                    >
                      Вакансии компании
                    </button>
                    <button
                      className="button secondary"
                      onClick={() => openCompanyPipeline(company.id)}
                    >
                      В воронку
                    </button>
                  </div>
                  <CompanyDetails
                    company={company}
                    jobs={catalogJobs.filter(
                      (j) => j.companyId === company.id && j.stage !== 'archived',
                    )}
                    onEdit={() => setDialog({ kind: 'company', item: company })}
                    onConnect={() => setDialog({ kind: 'source', company: company.name })}
                  />
                </Suspense>
              ) : null;
            })()}

          {dialog.kind === 'profile' && <ProfileForm profile={dialog.item} done={done} />}
          {dialog.kind === 'source' && <SourceForm companyName={dialog.company} done={done} />}
          {dialog.kind === 'import' && <ImportForm done={done} />}
          {details && (
            <div className="detail">
              <div className="detail-heading">
                <Logo name={details.company} large />
                <div>
                  <p>
                    {details.company} {details.demo && <span className="demo-label">Демо</span>}
                  </p>
                  <h2>{details.title}</h2>
                  <span>
                    <MapPin size={14} />
                    {details.location || 'География не указана'} · {workLabels[details.workMode]}
                  </span>
                </div>
              </div>
              <div className="detail-actions">
                <button
                  className="button secondary"
                  onClick={() => setDialog({ kind: 'companyDetail', id: details.companyId })}
                >
                  <Building2 size={15} />
                  Компания
                </button>
                <select
                  aria-label="Этап вакансии"
                  value={details.stage}
                  onChange={(e) =>
                    void editJob(details.id, { stage: e.target.value as Job['stage'] })
                  }
                >
                  {stages.map((s) => (
                    <option key={s} value={s}>
                      {stageLabels[s]}
                    </option>
                  ))}
                </select>
                <button
                  className="button secondary"
                  onClick={() => setDialog({ kind: 'job', item: details })}
                >
                  <Settings2 size={15} />
                  Редактировать
                </button>
                {details.url && (
                  <External href={details.applicationUrl || details.url} className="button primary">
                    {details.source === 'remotive' ? 'Открыть в Remotive' : 'Открыть вакансию'}
                  </External>
                )}
              </div>
              <div className="detail-salary">
                <Salary job={details} />
              </div>
              <div className="job-tags">
                {details.tags.map((t, i) => (
                  <span key={i}>{t}</span>
                ))}
              </div>
              {detailAvailability && (
                <p className="detail-availability">
                  {availabilityLabels[detailAvailability.state]}
                  {detailAvailability.checkedAt &&
                    ` · наблюдение ${date(detailAvailability.checkedAt)}`}
                  {detailAvailability.verificationUrl && (
                    <>
                      {' '}
                      · <External href={detailAvailability.verificationUrl}>Основание</External>
                    </>
                  )}
                </p>
              )}
              {detailReview && (
                <div className="details-ai">
                  <strong>
                    {reviewLabels[detailReview.category]}
                    {detailDiscoveryReview && ` · ${detailDiscoveryReview.language.toUpperCase()}`}
                  </strong>
                  <p>{detailReview.reason}</p>
                  {detailDiscoveryReview && detailDiscoveryReview.uncertainties.length > 0 && (
                    <p>Уточнить: {detailDiscoveryReview.uncertainties.join('; ')}</p>
                  )}
                </div>
              )}
              {details.aiScore != null && (
                <section className="ai-review detail-section">
                  <h3>
                    <Sparkles size={17} /> AI-score {details.aiScore}/10
                  </h3>
                  <p className="ai-review-context">
                    {state.profiles.find((p) => p.id === details.aiProfileId)?.name ||
                      'Профиль на дату оценки'}
                    {details.aiReviewedAt && ` · ${date(details.aiReviewedAt)}`}
                  </p>
                  <p className="ai-review-summary">{details.aiSummary}</p>
                  <p className="description">{details.aiReason}</p>
                  {!!details.aiEvidenceUrls?.length && (
                    <div className="ai-review-links">
                      {details.aiEvidenceUrls.map((url, i) => (
                        <External key={url} href={url}>
                          Источник {i + 1} <ArrowUpRight size={12} />
                        </External>
                      ))}
                    </div>
                  )}
                </section>
              )}
              {matches.get(details.id)?.score !== null && (
                <div className="match-explanation">
                  <h3>
                    <Sparkles size={17} />
                    Совпадение {matches.get(details.id)?.score}% · {profile?.name}
                  </h3>
                  <div>
                    {matches.get(details.id)?.reasons.map((r) => (
                      <span className="match-yes" key={r}>
                        <Check size={13} />
                        {r}
                      </span>
                    ))}
                    {matches.get(details.id)?.missing.map((r) => (
                      <span className="match-no" key={r}>
                        {r} — не подтверждено
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div className="detail-section">
                <h3>О вакансии</h3>
                <p className="description">
                  {details.description ||
                    'Описание пока не добавлено. Откройте первоисточник или дополните карточку вручную.'}
                </p>
              </div>
              <div className="detail-section">
                <h3>Ваши заметки</h3>
                <p className="description">
                  {details.notes ||
                    'Добавьте заметки через «Редактировать»: контакты, вопросы и впечатления.'}
                </p>
                {details.followUp && (
                  <p className="followup-detail">
                    <Bell size={15} />
                    Следующее действие: {date(details.followUp)}
                  </p>
                )}
              </div>
              <div className="detail-section">
                <h3>История</h3>
                <div className="history">
                  {details.history.map((h, i) => (
                    <span key={i}>
                      <i />
                      {stageLabels[h.stage]}
                      <small>{date(h.at)}</small>
                    </span>
                  ))}
                </div>
              </div>
              <div className="detail-provenance">
                <span>
                  {details.eligibleLocations?.length ? (
                    <p>Страны допуска: {details.eligibleLocations.join(', ')}</p>
                  ) : null}
                  {details.timezoneRestrictions?.length ? (
                    <p>Ограничения по часовым поясам: {details.timezoneRestrictions.join(', ')}</p>
                  ) : null}
                  Источник:{' '}
                  {details.source === 'himalayas' ? (
                    <External href={details.url}>Himalayas</External>
                  ) : (
                    providerLabels[details.source]
                  )}{' '}
                  · Добавлено {date(details.createdAt)}
                  {details.publishedAt && ` · Опубликовано ${date(details.publishedAt)}`}
                  {details.lastSeenAt && ` · Проверено ${date(details.lastSeenAt)}`}
                </span>
                <button
                  className="danger-link"
                  onClick={() => {
                    if (
                      confirm('Удалить вакансию вместе с заметками? Это действие нельзя отменить.')
                    ) {
                      close();
                      void notify(
                        () => api(`/jobs/${details.id}`, 'DELETE', {}),
                        'Вакансия удалена',
                      );
                    }
                  }}
                >
                  <Trash2 size={14} />
                  Удалить
                </button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  icon,
  text,
  green = false,
}: {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  text: string;
  green?: boolean;
}) {
  return (
    <div className={`stat-card ${green ? 'green-stat' : ''}`}>
      <div className="stat-label">
        {label}
        <span>{icon}</span>
      </div>
      <strong>{value}</strong>
      <p>
        {green && <span className="small-dot" />}
        {text}
      </p>
    </div>
  );
}
function Empty({
  type,
  onAdd,
  onSource,
  onReset,
  onDemo,
}: {
  type: string;
  onAdd: () => void;
  onSource: () => void;
  onReset: () => void;
  onDemo: () => void;
}) {
  return (
    <div className="empty">
      <div className="empty-art">
        <div className="empty-ring" />
        <div className="empty-mini-card">
          <span />
          <i />
          <i />
        </div>
        <div className="empty-compass">
          <Compass size={39} strokeWidth={1.3} />
        </div>
        <span className="empty-spark">✳</span>
      </div>
      <h2>
        {type === 'initial' ? 'Следующая глава начинается здесь' : 'Пока нет подходящих вакансий'}
      </h2>
      <p>
        {type === 'initial' ? (
          <>
            Подключите источники, добавьте интересную вакансию
            <br />
            или перенесите подборку из чата.
          </>
        ) : (
          <>
            Попробуйте изменить фильтры или пополнить базу.
            <br />
            Каждый поиск начинается с первого шага.
          </>
        )}
      </p>
      <div className="empty-actions">
        <button className="button primary" onClick={type === 'initial' ? onSource : onReset}>
          {type === 'initial' ? <Globe2 size={16} /> : <ListFilter size={16} />}
          {type === 'initial' ? 'Подключить источники' : 'Сбросить фильтры'}
        </button>
        <button className="button secondary" onClick={onAdd}>
          <Plus size={16} />
          Добавить вручную
        </button>
      </div>
      {type === 'initial' && (
        <button className="demo-link" onClick={onDemo}>
          Сначала посмотреть на примерах <ArrowRight size={13} />
        </button>
      )}
    </div>
  );
}
