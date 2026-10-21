import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Modal } from './components';
import { api } from './api';
import { shortSentences } from './company-presentation';
import type { ComparisonProfile } from './company-comparison';
import type { Company } from '../shared/model';
import { CompanyHiringLinks } from './CompanyHiringLinks';

const states = {
  open: 'Открыта',
  closed: 'Архив / снята с публикации',
  stale: 'Требует перепроверки',
  unverified: 'Не проверена',
};
const checkedDate = (value: string) =>
  value && Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }).format(
        new Date(value),
      )
    : '—';
export function TargetVacanciesModal({
  companyId,
  name,
  close,
  onJob,
  onJobs,
}: {
  companyId: string;
  name: string;
  close: () => void;
  onJob: (id: string) => void;
  onJobs: (companyId: string, ids: string[]) => void;
}) {
  const [data, setData] = useState<ComparisonProfile['targetVacancies'] | null>(null);
  const [error, setError] = useState('');
  const [company, setCompany] = useState<Company | null>(null);
  useEffect(() => {
    let active = true;
    void api<ComparisonProfile>(`/company-research/${encodeURIComponent(companyId)}`)
      .then((p) => {
        if (active) {
          setData(p.targetVacancies);
          setCompany(p.company);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [companyId]);
  return (
    <Modal title={`${name} · Целевые вакансии`} close={close} wide>
      <div className="target-vacancies-modal">
        {error ? (
          <p role="alert">{error}</p>
        ) : !data ? (
          <p role="status">Загрузка…</p>
        ) : (
          <>
            <div className="target-vacancies-heading">
              <span>Всего найдено {data.total}</span>
              <strong className="target-open">Открытые {data.open}</strong>
              <button
                className="button"
                disabled={!data.jobIds.length}
                onClick={() => {
                  close();
                  onJobs(companyId, data.jobIds);
                }}
              >
                Показать в ATS
              </button>
            </div>
            <p className="target-vacancies-help">
              Middle / Senior Product Analyst и Data Analyst · все сохранённые даты. «Открыта» —
              публикация проверена за последние 30 дней; старые и непроверенные записи сохранены
              отдельно.
            </p>
            {data.jobs.length ? (
              <ul className="target-vacancy-list">
                {data.jobs.map((job) => (
                  <li key={job.id}>
                    <div className="target-vacancy-title">
                      <button
                        className="comparison-name"
                        onClick={() => {
                          close();
                          onJob(job.id);
                        }}
                      >
                        {job.title}
                      </button>
                      {job.url && (
                        <a
                          href={job.url}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Сайт вакансии: ${job.title}`}
                        >
                          <ExternalLink size={15} />
                        </a>
                      )}
                    </div>
                    <small>
                      {job.location || '—'} · {job.targetLevel} ·{' '}
                      <span className={job.availability.state === 'open' ? 'target-open' : ''}>
                        {states[job.availability.state]}
                      </span>{' '}
                      · проверено {checkedDate(job.availability.checkedAt)}
                    </small>
                    <p>{shortSentences(job.description, 2, 350) || '—'}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p>—</p>
            )}
            {company && <CompanyHiringLinks company={company} />}
          </>
        )}
      </div>
    </Modal>
  );
}
