import { useEffect, useState } from 'react';
import { Modal } from './components';
import { api } from './api';
import { CompanySources, sourceDate } from './CompanySources';
import { companyCulture } from './company-culture';
import { companyPresentation } from './company-presentation';
import { companyResearchTags, factScope } from '../shared/company-signals';
import { registry } from '../shared/company-research';
import { InfrastructureSummary } from './InfrastructureSummary';
import { companyScreening } from './company-screening';
import type { ComparisonProfile } from './company-comparison';

export function CompanyColumnModal({
  companyId,
  name,
  column,
  close,
}: {
  companyId: string;
  name: string;
  column: 'business' | 'analytics_culture' | 'infrastructure';
  close: () => void;
}) {
  const [profile, setProfile] = useState<ComparisonProfile | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void api<ComparisonProfile>(`/company-research/${encodeURIComponent(companyId)}`)
      .then((p) => {
        if (active) setProfile(p);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [companyId]);
  const culture = profile && companyCulture(profile.observations);
  const infrastructure = profile && companyResearchTags(profile.observations).infrastructure;
  const screening = profile && companyScreening(profile);
  return (
    <Modal
      title={`${name} · ${{ business: 'Описание бизнеса', analytics_culture: 'Аналитика', infrastructure: 'Инфраструктура' }[column]}`}
      close={close}
      wide
    >
      {error ? (
        <p role="alert">{error}</p>
      ) : !profile || !culture ? (
        <p>Загрузка…</p>
      ) : (
        <div className="company-column-details">
          {column === 'business' ? (
            <>
              <p>{companyPresentation(profile.company, profile.observations).description}</p>
              {screening?.business.map((t) => (
                <article key={t.label}>
                  <strong>{t.label}</strong>
                  <p className="screening-detail">{t.details}</p>
                </article>
              ))}
              {culture.traffic.length > 0 && (
                <>
                  <h3>Аудитория / масштаб</h3>
                  {culture.traffic.map((t) => (
                    <article key={t.id}>
                      <p>{t.text}</p>
                      <small>{sourceDate(t.date)}</small>
                      {profile.observations
                        .find((o) => o.id === t.id)
                        ?.evidence.map((e, i) => (
                          <p key={i}>
                            <a href={e.url} target="_blank" rel="noreferrer">
                              {e.title}
                            </a>
                          </p>
                        ))}
                    </article>
                  ))}
                </>
              )}
            </>
          ) : column === 'infrastructure' ? (
            <>
              <InfrastructureSummary observations={profile.observations} />
              <h3>Теги и основания</h3>
              {infrastructure?.length ? (
                infrastructure.map((tag) => (
                  <article key={tag.label} className="infrastructure-fact">
                    <div className="culture-tags">
                      <span
                        className={tag.assessment ? 'research-assessment' : ''}
                        title={tag.details}
                      >
                        {tag.label}
                      </span>
                    </div>
                    <small>{tag.scope || 'Компания'}</small>
                    {tag.assessment && (
                      <p>
                        <em>{tag.details.split('\n\n')[0]}</em>
                      </p>
                    )}
                    {profile.observations
                      .filter((o) => tag.observationIds.includes(o.id))
                      .map((o) => (
                        <div key={o.id}>
                          <p>{o.reasoning}</p>
                          <small>{sourceDate(o.verifiedAt || '')}</small>
                          {o.evidence.map((e, index) => (
                            <blockquote key={index}>
                              <a href={e.url} target="_blank" rel="noreferrer">
                                {e.title}
                              </a>
                              <p>{e.excerpt}</p>
                            </blockquote>
                          ))}
                        </div>
                      ))}
                  </article>
                ))
              ) : (
                <p>—</p>
              )}
            </>
          ) : (
            <>
              <p>{culture.summary || '—'}</p>
              {!!screening?.team.length && (
                <>
                  <h3>Команда и работа с Product</h3>
                  {screening.team.map((t) => (
                    <article key={t.label}>
                      <strong>{t.label}</strong>
                      <p className="screening-detail">{t.details}</p>
                    </article>
                  ))}
                </>
              )}
              <h3>Блоги / публикации</h3>
              {culture.blogs.length ? (
                culture.blogs.map((b) => (
                  <p key={b.url}>
                    <a href={b.url} target="_blank" rel="noreferrer">
                      {b.title}
                    </a>
                  </p>
                ))
              ) : (
                <p>—</p>
              )}
              <h3>Публичный GitHub</h3>
              {culture.github.length ? (
                culture.github.map((b) => (
                  <p key={b.url}>
                    <a href={b.url} target="_blank" rel="noreferrer">
                      {b.title}
                    </a>
                  </p>
                ))
              ) : (
                <p>—</p>
              )}
              {culture.tags.length > 0 && (
                <div className="culture-tags comparison-tags">
                  {culture.tags.map((t) => (
                    <span key={t.label} title={t.details}>
                      {t.label}
                    </span>
                  ))}
                </div>
              )}
              <details>
                <summary>Основания выводов</summary>
                {profile.observations
                  .filter(
                    (o) =>
                      !o.rejected &&
                      o.value !== null &&
                      (o.criterion_id === 'AN09_CULTURE' ||
                        culture.tags.some((t) => t.observationIds.includes(o.id))),
                  )
                  .map((o) => (
                    <article key={o.id}>
                      <strong>
                        {registry.criteria.find((c) => c.id === o.criterion_id)?.name}
                      </strong>
                      <p>
                        {o.value &&
                        typeof o.value === 'object' &&
                        !Array.isArray(o.value) &&
                        'summary' in o.value
                          ? o.value.summary
                          : culture.tags
                              .filter((t) => t.observationIds.includes(o.id))
                              .map((t) => t.label)
                              .join(' · ')}
                      </p>
                      {o.reasoning && <p>{o.reasoning}</p>}
                      <small>
                        {factScope(o) || 'Компания'} ·{' '}
                        {o.verifiedAt
                          ? `Источник проверен ${sourceDate(o.verifiedAt)}`
                          : 'Не проверено'}
                      </small>
                      {o.evidence.map((e, i) => (
                        <blockquote key={i}>
                          <a href={e.url} target="_blank" rel="noreferrer">
                            {e.title}
                          </a>
                          <small>
                            {e.published_at
                              ? `Опубликовано ${sourceDate(e.published_at)}`
                              : `Материал прочитан ${sourceDate(e.observed_at)}`}
                          </small>
                          <p>{e.excerpt}</p>
                        </blockquote>
                      ))}
                    </article>
                  ))}
              </details>
            </>
          )}
          <CompanySources sources={profile.columnSources[column] || []} />
        </div>
      )}
    </Modal>
  );
}
