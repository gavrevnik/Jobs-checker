import { useEffect, useState } from 'react';
import { Check, X, Minus } from 'lucide-react';
import { Modal } from './components';
import { api } from './api';
import type { ProviderView } from '../shared/source-tools';
import { sourceConnection, sourceLimits, sourceNotes } from './vacancy-source-guide';

export function TargetVacancySourcesModal({ close }: { close: () => void }) {
  const [providers, setProviders] = useState<ProviderView[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const data = await api<{ providers: ProviderView[] }>('/source-tools');
        if (active) {
          setProviders(data.providers);
          setError('');
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    };
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 30000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);
  const sorted = [...providers].sort(
    (a, b) => Number(sourceConnection(b).connected) - Number(sourceConnection(a).connected),
  );
  return (
    <Modal
      title="Целевые вакансии · источники и лимиты"
      close={close}
      className="source-guide-modal"
    >
      <div className="target-source-guide">
        <p>
          Middle / Senior Product Analyst и Data Analyst. ✓ — источник включён и настроен; для ATS
          подключена хотя бы одна доска. Открытие справки не запускает поиск.
        </p>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {!providers.length && !error && <p role="status">Загрузка статусов…</p>}
        {!!providers.length && (
          <div
            className="source-guide-scroll"
            tabIndex={0}
            aria-label="Таблица источников целевых вакансий"
          >
            <table className="source-guide-table">
              <thead>
                <tr>
                  <th scope="col">Источник</th>
                  <th scope="col">Условия запуска</th>
                  <th scope="col">Лимиты и расход</th>
                  <th scope="col">Дополнительно</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((p) => {
                  const connection = sourceConnection(p);
                  return (
                    <tr key={p.id}>
                      <th scope="row">
                        <span className="source-guide-name">
                          <a href={p.docs} target="_blank" rel="noreferrer">
                            {p.name}
                          </a>
                          <span
                            className={
                              connection.connected ? 'source-connected' : 'source-disconnected'
                            }
                            role="img"
                            aria-label={connection.connected ? 'Подключён' : 'Не подключён'}
                          >
                            {connection.connected ? <Check size={16} /> : <X size={16} />}
                          </span>
                        </span>
                        <small className={p.status === 'error' ? 'source-run-error' : ''}>
                          {connection.label}
                        </small>
                      </th>
                      <td>
                        {p.id === 'serpapi'
                          ? 'По явному запросу'
                          : 'По скиллу monitoring / discovery'}
                      </td>
                      <td>
                        {sourceLimits(p).map((line, i) => (
                          <span className="source-limit-line" key={i}>
                            {line}
                          </span>
                        ))}
                      </td>
                      <td>{sourceNotes[p.id]}</td>
                    </tr>
                  );
                })}
                <tr className="source-web-row">
                  <th scope="row">
                    <span className="source-guide-name">
                      Веб-поиск <Minus size={16} aria-hidden="true" />
                    </span>
                    <small>Через модель · отдельного API в приложении нет</small>
                  </th>
                  <td>По скиллу monitoring / discovery</td>
                  <td>Лимиты веб-инструмента модели; расход в Jobs Checker не учитывается.</td>
                  <td>
                    Careers компаний, Workday, LinkedIn, Indeed, WTTJ, Wellfound, EURES. Сначала
                    официальные страницы, затем поиск по пробелам.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        <p className="source-guide-footnote">
          Расход локальный, общий для UI / API / MCP; кэш запросы не тратит. «Сегодня» —
          Europe/Belgrade; месяцы и скользящие периоды — по настройкам источника. Обновление раз в
          30 секунд.
        </p>
      </div>
    </Modal>
  );
}
