import { CatalogPanel } from './CatalogPanel';
import { useEffect, useState } from 'react';
import {
  ArrowUpRight,
  Building2,
  Check,
  ChevronDown,
  Globe2,
  Gauge,
  History,
  KeyRound,
  Loader2,
  Plug,
  Plus,
  RefreshCw,
  Search,
} from 'lucide-react';
import type { Profile, Source, State } from '../shared/model';
import {
  boardProviders,
  providerCatalog,
  searchSchema,
  webSearchPlan,
  type ProviderId,
  type ProviderView,
  type ProviderQuota,
  type SourceRun,
} from '../shared/source-tools';
import { api, date } from './api';
import { ErrorText, External } from './components';
import './sources.css';

type Status = {
  providers: ProviderView[];
  sources: Source[];
  runs: SourceRun[];
  observations: { sourceId: string; jobId: string; missingCount: number }[];
};
const labels = {
  disabled: 'Выключен',
  not_configured: 'Нужен ключ',
  ready: 'Готов',
  connected: 'Подключён',
  error: 'Ошибка',
};
const tabs = [
  { id: 'connections', title: 'Подключения', icon: Plug },
  { id: 'monitor', title: 'Компании', icon: Building2 },
  { id: 'web', title: 'Web-поиск', icon: Globe2 },
  { id: 'history', title: 'История', icon: History },
] as const;
const quotaDate = (value: string) =>
  `${new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(value))} UTC`;
function quotaHint(quota: ProviderQuota) {
  return [
    quota.plan,
    ...quota.windows.map(
      (w) =>
        `${w.label}: ${w.used.toLocaleString('ru-RU')} / ${w.limit.toLocaleString('ru-RU')}, осталось ${w.remaining.toLocaleString('ru-RU')}. ${w.resetRule}${w.nextResetAt ? ` Ближайшее обновление: ${quotaDate(w.nextResetAt)}.` : ''}`,
    ),
    quota.note,
    `Проверено ${quotaDate(quota.updatedAt)}. На открытой странице обновляется каждые 30 секунд.`,
  ].join('\n\n');
}
export function SourcesPage({
  state,
  profile,
  refresh,
  openJob,
}: {
  state: State;
  profile?: Profile;
  refresh: () => Promise<void>;
  openJob: (id: string) => void;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [tab, setTab] = useState<string>('connections');
  const [expanded, setExpanded] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<ProviderId[]>(['arbeitnow', 'remotive']);
  const [keywords, setKeywords] = useState('');
  const [country, setCountry] = useState('');
  const [location, setLocation] = useState('');
  const [limit, setLimit] = useState(10);
  const [pages, setPages] = useState(1);
  const [store, setStore] = useState(true);
  const [result, setResult] = useState<any>(null);
  const [adding, setAdding] = useState(false);
  const [boardProvider, setBoardProvider] = useState('ashby');
  const [companyId, setCompanyId] = useState('');
  const load = async () => setStatus(await api<Status>('/source-tools'));
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [state.sources]);
  useEffect(() => {
    let active = true;
    let pending = false;
    const update = async () => {
      if (document.visibilityState !== 'visible' || pending) return;
      pending = true;
      try {
        const next = await api<Status>('/source-tools');
        if (active) setStatus(next);
      } catch {
        // Keep the last snapshot and its timestamp while the local server is unavailable.
      } finally {
        pending = false;
      }
    };
    const timer = window.setInterval(() => void update(), 30000);
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  useEffect(() => {
    setKeywords(profile?.keywords.join(', ') || '');
    setResult(null);
  }, [profile?.id]);
  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id);
    setError('');
    try {
      await fn();
      await refresh();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  };
  const availableSelected = selected.filter((id) =>
    status?.providers.some(
      (p) =>
        p.id === id &&
        p.enabled &&
        !p.missing.length &&
        (p.group !== 'boards' || p.connections > 0),
    ),
  );
  const query = () => ({
    profileId: profile?.id,
    keywords: keywords
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    country,
    location,
    maxRequests: limit,
    maxPages: pages,
  });
  const plan = webSearchPlan(searchSchema.parse(query()), profile);
  const boards = status?.sources.filter((s) => boardProviders.includes(s.provider)) || [];
  const switchTab = (value: string) => {
    setTab(value);
    setError('');
    setResult(null);
  };
  return (
    <div className="connections-page">
      <CatalogPanel />
      <div className="connection-tabs" aria-label="Разделы источников">
        {tabs.map(({ id, title, icon: Icon }) => (
          <button
            key={id}
            className={tab === id ? 'selected' : ''}
            onClick={() => switchTab(id)}
            aria-pressed={tab === id}
          >
            <Icon size={16} />
            {title}
            {id === 'monitor' && <small>{boards.length}</small>}
          </button>
        ))}
      </div>
      <ErrorText error={error} />
      {!status && !error && (
        <div className="loading">
          <Loader2 className="spin" />
          Загрузка подключений…
        </div>
      )}
      {(tab === 'connections' || tab === 'web') && (
        <form
          className="source-search"
          onSubmit={(e) => {
            e.preventDefault();
            if (tab === 'web') return;
            void act('search', async () =>
              setResult(
                await api('/source-tools/search', 'POST', {
                  ...query(),
                  providers: availableSelected,
                  execute: true,
                  store,
                }),
              ),
            );
          }}
        >
          <div className="source-search-fields">
            <label className="source-query">
              <span>Ключевые слова</span>
              <div className="search-input">
                <Search size={16} />
                <input
                  aria-label="Ключевые слова"
                  placeholder="Product analyst, analytics engineer"
                  value={keywords}
                  onChange={(e) => {
                    setKeywords(e.target.value);
                    setResult(null);
                  }}
                />
              </div>
            </label>
            <label>
              <span>Локация поиска</span>
              <input
                placeholder="Berlin, Germany"
                aria-label="Локация поиска"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </label>
            <label className="market-field">
              <span>Рынок API</span>
              <input
                placeholder="de"
                aria-label="Рынок API"
                maxLength={2}
                pattern="[A-Za-z]{2}|^$"
                value={country}
                onChange={(e) => setCountry(e.target.value.toLowerCase().replace(/[^a-z]/g, ''))}
              />
            </label>
            {tab === 'connections' && (
              <button
                type="submit"
                className="button primary"
                disabled={!!busy || !availableSelected.length}
              >
                {busy === 'search' ? <Loader2 size={16} className="spin" /> : <Search size={16} />}
                Найти вакансии
              </button>
            )}
          </div>
          {tab === 'connections' && (
            <div className="source-search-options">
              <label>
                <input
                  type="checkbox"
                  checked={store}
                  onChange={(e) => setStore(e.target.checked)}
                />
                Сохранять в ATS
              </label>
              <label>
                Лимит запросов{' '}
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={limit}
                  onChange={(e) =>
                    setLimit(Math.max(1, Math.min(100, Number(e.target.value) || 1)))
                  }
                />
              </label>
              <label>
                Страниц / запрос{' '}
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={pages}
                  onChange={(e) => setPages(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
                />
              </label>
              <details>
                <summary>Фильтры профиля</summary>
                <p>{profile?.name || 'Без профиля'}</p>
                <p>
                  География: {profile?.locations.join(', ') || 'любая'} · Формат:{' '}
                  {profile?.workMode || 'any'} · Уровень: {profile?.seniority || 'any'}
                </p>
                <p>
                  Исключения: {profile?.exclude.join(', ') || 'нет'} · Зарплата от:{' '}
                  {profile?.minSalary ?? '—'} {profile?.minSalary ? profile.currency : ''}
                </p>
                <p>
                  Ключевые слова — альтернативы, синонимы — через |. География профиля проверяется
                  по тексту локации вакансии.
                </p>
              </details>
            </div>
          )}
        </form>
      )}
      {result && (
        <section className="source-results" aria-live="polite">
          <div className="source-group-title">
            <h2>{result.jobs ? `Найдено: ${result.jobs.length}` : 'Результат проверки'}</h2>
            <span>Запросов: {result.requests || 0}</span>
          </div>
          {(result.results || []).map((r: any, i: number) => (
            <div key={i} className={r.error ? 'source-run-error' : 'source-result-line'}>
              <b>{providerCatalog.find((p) => p.id === r.provider)?.name || r.name}</b>
              <span>
                {r.error ||
                  `Получено ${r.received} · подходит ${r.matched} · новых ${r.added}${r.cached ? ' · кэш' : ''}`}
              </span>
            </div>
          ))}
          {result.unavailable?.map((r: any) => (
            <p key={r.provider}>
              {r.provider}: {r.reason}
            </p>
          ))}
          {result.jobs?.slice(0, 20).map((j: any, i: number) => (
            <div className="source-job-result" key={`${j.externalId}-${i}`}>
              <div>
                {j.atsId ? (
                  <button className="text-link" onClick={() => openJob(j.atsId)}>
                    {j.title}
                  </button>
                ) : (
                  <strong>{j.title}</strong>
                )}
                <small>
                  {j.company} · {j.location || 'Локация не указана'}
                </small>
              </div>
              {j.url && <External href={j.url}>Открыть</External>}
            </div>
          ))}
        </section>
      )}
      {tab === 'connections' && status && (
        <>
          {(['discovery', 'boards'] as const).map((group) => (
            <section className="adapter-group" key={group}>
              <div className="source-group-title">
                <h2>
                  {group === 'discovery' ? 'API · поиск вакансий' : 'ATS · доски компаний'}
                  <small>{status.providers.filter((p) => p.group === group).length}</small>
                </h2>
                {group === 'boards' && (
                  <button
                    className="button secondary compact"
                    onClick={() => {
                      setTab('monitor');
                      setAdding(true);
                    }}
                  >
                    <Plus size={14} />
                    Компания
                  </button>
                )}
              </div>
              <div className="adapter-list">
                {status.providers
                  .filter((p) => p.group === group)
                  .map((p) => (
                    <article
                      className={`adapter-item ${!p.enabled ? 'adapter-disabled' : ''}`}
                      key={p.id}
                    >
                      <div className="adapter-row">
                        <input
                          type="checkbox"
                          aria-label={`Искать через ${p.name}`}
                          checked={availableSelected.includes(p.id)}
                          disabled={
                            !p.enabled ||
                            p.missing.length > 0 ||
                            (p.group === 'boards' && !p.connections)
                          }
                          onChange={(e) =>
                            setSelected(
                              e.target.checked
                                ? [...selected, p.id]
                                : selected.filter((id) => id !== p.id),
                            )
                          }
                        />
                        <span className={`adapter-mark adapter-${p.id}`}>
                          <Plug size={19} />
                        </span>
                        <button
                          className="adapter-identity"
                          aria-expanded={expanded === p.id}
                          onClick={() => setExpanded(expanded === p.id ? '' : p.id)}
                        >
                          <strong>
                            {p.name}
                            {p.status === 'connected' && <Check size={13} />}
                          </strong>
                          <span>{p.description}</span>
                        </button>
                        <div className="adapter-meta">
                          <span className={`adapter-status ${p.status}`}>
                            <i />
                            {labels[p.status]}
                          </span>
                          {p.quota.limit !== null ? (
                            <span
                              className={`adapter-quota ${p.quota.windows.some((w) => w.remaining === 0) ? 'exhausted' : p.quota.windows.some((w) => w.used >= w.limit * 0.8) ? 'warning' : ''}`}
                              tabIndex={0}
                              title={quotaHint(p.quota)}
                              aria-label={`${p.name}. ${quotaHint(p.quota)}`}
                            >
                              <Gauge size={12} aria-hidden="true" />
                              {p.quota.used.toLocaleString('ru-RU')} /{' '}
                              {p.quota.limit.toLocaleString('ru-RU')}
                              <span>· {p.quota.label}</span>
                            </span>
                          ) : (
                            <small>
                              {p.group === 'boards'
                                ? `${p.connections} досок`
                                : p.credentials.length
                                  ? 'Квота аккаунта'
                                  : 'Без ключа'}
                            </small>
                          )}
                        </div>
                        <button
                          className={`toggle ${p.enabled ? 'on' : ''}`}
                          role="switch"
                          aria-checked={p.enabled}
                          aria-label={`Включить ${p.name}`}
                          disabled={!!busy}
                          onClick={() =>
                            void act(p.id, () =>
                              api(`/source-tools/providers/${p.id}`, 'PATCH', {
                                enabled: !p.enabled,
                              }),
                            )
                          }
                        >
                          <i />
                        </button>
                        <button
                          className="icon-button"
                          aria-label={`Настройки ${p.name}`}
                          aria-expanded={expanded === p.id}
                          onClick={() => setExpanded(expanded === p.id ? '' : p.id)}
                        >
                          <ChevronDown size={16} />
                        </button>
                      </div>
                      {expanded === p.id && (
                        <div className="adapter-expanded">
                          <span>{p.quota.limit !== null ? p.quota.plan : p.cost}</span>
                          <span>
                            Кэш: {p.ttlHours < 1 ? '15 мин' : `${p.ttlHours} ч`} · MCP: jobs_search
                          </span>
                          {p.missing.length > 0 && (
                            <p>
                              <KeyRound size={14} />
                              {p.missing.join(', ')} → .env
                            </p>
                          )}
                          {p.error && <ErrorText error={p.error} />}
                          <External href={p.docs}>Документация</External>
                          {p.quota.pricingUrl && (
                            <External href={p.quota.pricingUrl}>Тарифы и лимиты</External>
                          )}
                          {p.group === 'boards' && (
                            <button
                              className="text-link"
                              onClick={() => {
                                setTab('monitor');
                                setAdding(true);
                                setBoardProvider(p.id);
                              }}
                            >
                              Добавить доску <ArrowUpRight size={14} />
                            </button>
                          )}
                        </div>
                      )}
                    </article>
                  ))}
              </div>
            </section>
          ))}
        </>
      )}
      {tab === 'monitor' && (
        <section className="adapter-group">
          <div className="source-group-title">
            <h2>
              Доски компаний <small>{boards.length}</small>
            </h2>
            <div className="heading-actions">
              <button
                className="button secondary"
                disabled={!!busy || !boards.length}
                onClick={() =>
                  void act('monitor', async () =>
                    setResult(
                      await api('/source-tools/monitor', 'POST', {
                        execute: true,
                        maxRequests: limit,
                      }),
                    ),
                  )
                }
              >
                <RefreshCw size={15} className={busy === 'monitor' ? 'spin' : ''} />
                Проверить по интервалу
              </button>
              <button className="button primary" onClick={() => setAdding(!adding)}>
                <Plus size={15} />
                Добавить
              </button>
            </div>
          </div>
          {adding && (
            <form
              className="board-form"
              onSubmit={(e) => {
                e.preventDefault();
                const form = new FormData(e.currentTarget);
                void act('board', async () => {
                  await api('/source-tools/boards', 'POST', {
                    provider: boardProvider,
                    name: companyId
                      ? state.companies.find((c) => c.id === companyId)!.name
                      : form.get('name'),
                    companyId,
                    board: form.get('board'),
                    region: form.get('region') || 'global',
                    profileId: profile?.id || '',
                    monitoring: true,
                  });
                  setAdding(false);
                  setCompanyId('');
                });
              }}
            >
              <label>
                <span>Компания</span>
                <select
                  aria-label="Компания для мониторинга"
                  value={companyId}
                  onChange={(e) => setCompanyId(e.target.value)}
                >
                  <option value="">Новая компания</option>
                  {state.companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              {!companyId && (
                <label>
                  <span>Название</span>
                  <input name="name" required placeholder="Компания" />
                </label>
              )}
              <label>
                <span>Платформа</span>
                <select
                  aria-label="Платформа ATS"
                  value={boardProvider}
                  onChange={(e) => setBoardProvider(e.target.value)}
                >
                  {providerCatalog
                    .filter((p) => p.group === 'boards')
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="board-url">
                <span>Доска вакансий</span>
                <input name="board" required placeholder="URL или идентификатор доски" />
              </label>
              {boardProvider === 'lever' && (
                <label>
                  <span>Регион Lever</span>
                  <select name="region">
                    <option value="global">Global</option>
                    <option value="eu">EU</option>
                  </select>
                </label>
              )}
              <button type="submit" className="button primary" disabled={!!busy}>
                Подключить
              </button>
            </form>
          )}
          <div className="adapter-list">
            {boards.map((s) => {
              const missing =
                status?.observations.filter((o) => o.sourceId === s.id && o.missingCount >= 2)
                  .length || 0;
              return (
                <article className="board-row" key={s.id}>
                  <div className="board-identity">
                    <strong>{s.name}</strong>
                    <small>
                      {providerCatalog.find((p) => p.id === s.provider)?.name} / {s.board}
                    </small>
                    <small>
                      {s.lastSync
                        ? `Проверено ${date(s.lastSync)} · ${s.count} вакансий`
                        : 'Ещё не проверено'}
                      {missing > 0 && ` · не найдены: ${missing}`}
                    </small>
                    {s.error && <ErrorText error={s.error} />}
                  </div>
                  <select
                    aria-label={`Профиль: ${s.name}`}
                    value={s.profileId}
                    disabled={!!busy}
                    onChange={(e) =>
                      void act(s.id, () =>
                        api(`/sources/${s.id}`, 'PATCH', { profileId: e.target.value }),
                      )
                    }
                  >
                    <option value="">Все вакансии</option>
                    {state.profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label={`Интервал: ${s.name}`}
                    value={s.intervalHours}
                    disabled={!!busy}
                    onChange={(e) =>
                      void act(s.id, () =>
                        api(`/sources/${s.id}`, 'PATCH', { intervalHours: Number(e.target.value) }),
                      )
                    }
                  >
                    {[6, 12, 24, 48, 168].map((n) => (
                      <option key={n} value={n}>
                        {n} ч
                      </option>
                    ))}
                  </select>
                  <button
                    role="switch"
                    aria-checked={s.monitoring && s.enabled}
                    aria-label={`Мониторинг ${s.name}`}
                    className={`toggle ${s.monitoring && s.enabled ? 'on' : ''}`}
                    disabled={!!busy}
                    onClick={() =>
                      void act(s.id, () =>
                        api(`/sources/${s.id}`, 'PATCH', {
                          monitoring: !(s.monitoring && s.enabled),
                          enabled: true,
                        }),
                      )
                    }
                  >
                    <i />
                  </button>
                </article>
              );
            })}
          </div>
          {!boards.length && (
            <div className="sources-empty">
              <Building2 size={30} />
              <p>Добавьте карьерную доску компании</p>
            </div>
          )}
          <details className="source-monitor-info">
            <summary>Режим мониторинга</summary>
            <p>
              Проверка по кнопке или MCP, только после выбранного интервала. Фоновое расписание пока
              не включено. Два отсутствия в полных успешных загрузках отмечаются отдельно; карточки
              и этапы сохраняются. Фильтры профиля применяются при добавлении новых карточек.
            </p>
          </details>
        </section>
      )}
      {tab === 'web' && (
        <section className="adapter-group">
          <div className="source-group-title">
            <h2>
              Web-search <small>{plan.length}</small>
            </h2>
            <span>По активному профилю</span>
          </div>
          <div className="adapter-list">
            {plan.map((p) => (
              <article className="web-source-row" key={p.id}>
                <span className="adapter-mark">
                  <Globe2 size={19} />
                </span>
                <div>
                  <strong>{p.name}</strong>
                  <p>{p.description}</p>
                  <details>
                    <summary>Запрос</summary>
                    <code>{p.query}</code>
                  </details>
                </div>
                <a
                  className="button secondary compact"
                  href={p.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Искать <ArrowUpRight size={14} />
                </a>
              </article>
            ))}
          </div>
        </section>
      )}
      {tab === 'history' && (
        <section className="adapter-group">
          <div className="source-group-title">
            <h2>Последние запуски</h2>
            <button
              className="button secondary compact"
              onClick={() => void act('refresh', load)}
              disabled={!!busy}
            >
              <RefreshCw size={14} />
              Обновить
            </button>
          </div>
          {!status?.runs.length ? (
            <div className="sources-empty">
              <History size={30} />
              <p>История появится после первого поиска</p>
            </div>
          ) : (
            <div className="source-history">
              {status.runs.map((r) => (
                <article key={r.id}>
                  <div>
                    <strong>{providerCatalog.find((p) => p.id === r.provider)?.name}</strong>
                    <small>
                      {new Date(r.at).toLocaleString('ru-RU')} · {r.kind}
                      {r.cached ? ' · кэш' : ''}
                    </small>
                  </div>
                  <span>{r.query || boards.find((s) => s.id === r.sourceId)?.name || '—'}</span>
                  <span>
                    {r.error ? (
                      <ErrorText error={r.error} />
                    ) : (
                      `Получено ${r.received} · подходит ${r.matched} · +${r.added}`
                    )}
                  </span>
                  <small>{r.requests} запросов</small>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
