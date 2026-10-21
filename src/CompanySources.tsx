import './company-sources.css';
import { useEffect, useState } from 'react';
import { api } from './api';
import type { UsedSource } from '../shared/company-provenance';
import type { ComparisonProfile } from './company-comparison';

export const sourceDate = (value: string) =>
  value && Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }).format(
        new Date(value),
      )
    : '—';
const kinds = {
  api: 'API',
  web_search: 'Веб-поиск',
  web_page: 'Материал',
  model: 'Сводка модели',
  manual: 'Ручной источник',
};
const outcomes: Record<string, string> = {
  success: 'прочитано / получено',
  empty: 'результатов нет',
  error: 'ошибка доступа',
  partial: 'неполные / непроверенные сведения',
  cached: 'кэш',
};
export function CompanySources({ sources }: { sources: UsedSource[] }) {
  return (
    <section className="company-used-sources">
      <h3>Использованные источники</h3>
      {sources.length ? (
        <ul>
          {sources.map((s, i) => (
            <li key={[s.name, s.url, s.query, i].join('|')}>
              <strong>
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noreferrer">
                    {s.name}
                  </a>
                ) : (
                  s.name
                )}
              </strong>
              <small>
                {kinds[s.kind]} · {sourceDate(s.observedAt)} · {outcomes[s.outcome] || s.outcome}
              </small>
              <p>{s.description}</p>
              {s.query && <small>Запрос: {s.query}</small>}
            </li>
          ))}
        </ul>
      ) : (
        <p>—</p>
      )}
    </section>
  );
}
export function CompanySourcesPanel({ companyId }: { companyId: string }) {
  const [sources, setSources] = useState<UsedSource[]>([]),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void api<ComparisonProfile>(`/company-research/${encodeURIComponent(companyId)}`)
      .then((p) => {
        if (active)
          setSources([
            ...new Map(
              Object.values(p.columnSources)
                .flat()
                .map((s) => [[s.kind, s.name, s.url, s.query || ''].join('|'), s]),
            ).values(),
          ]);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [companyId]);
  return error ? <p role="alert">{error}</p> : <CompanySources sources={sources} />;
}
