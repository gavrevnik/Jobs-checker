import { useEffect, useState } from 'react';
import { api } from './api';
import { Modal } from './components';
import { sourceDate } from './CompanySources';
import { companyInterviewDetails } from '../shared/company-interviews';
import type { ComparisonProfile } from './company-comparison';

export function CompanyInterviewModal({
  companyId,
  name,
  close,
}: {
  companyId: string;
  name: string;
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
  const details = profile && companyInterviewDetails(profile.observations, profile.jobs);
  return (
    <Modal title={`${name} · Интервью`} close={close} wide>
      <div className="company-column-details company-interview-details">
        {error ? (
          <p role="alert">{error}</p>
        ) : !details ? (
          <p>Загрузка…</p>
        ) : details.length ? (
          details.map((d) => (
            <article key={d.id} className="information-item">
              <h3>{d.role}</h3>
              {d.scope !== d.role && <p className="information-scope">{d.scope}</p>}
              <p className="information-answer">{d.text}</p>
              <p className="information-notice">{d.notice}</p>
              {d.sources.map((s, i) => (
                <p key={i}>
                  <a href={s.url} target="_blank" rel="noreferrer">
                    {s.title} ↗
                  </a>
                  <small>Источник: {sourceDate(s.published_at || s.observed_at)}</small>
                </p>
              ))}
            </article>
          ))
        ) : (
          <p>Детали интервью пока не опубликованы.</p>
        )}
      </div>
    </Modal>
  );
}
