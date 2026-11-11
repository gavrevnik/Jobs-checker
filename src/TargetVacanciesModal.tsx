import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Modal } from './components';
import { api } from './api';
import { shortSentences } from './company-presentation';
import type { ComparisonProfile } from './company-comparison';
import type { Company } from '../shared/model';
import { availabilityLabels } from '../shared/target-vacancies';
import { CompanyHiringLinks } from './CompanyHiringLinks';

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
              <strong className="target-open">Подтверждены {data.open}</strong>
              <strong className="target-closed">Закрытые {data.closed}</strong>
              <span>Не подтверждены {data.unverified}</span>
              <span>Устарели {data.stale}</span>
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
              Подтверждены — найдены на официальном Careers или ATS за последние 30 дней. Свежие
              результаты агрегаторов остаются кандидатами с неподтверждённой открытостью. Устаревшие
              — без свежих наблюдений. Закрытые — по официальной проверке или двум отсутствиям в
              полном снимке официальной доски. Архив в ATS — личный этап воронки.
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
                          href={job.applicationUrl || job.url}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Сайт вакансии: ${job.title}`}
                        >
                          <ExternalLink size={15} />
                        </a>
                      )}
                    </div>
                    <small>
                      {job.discoveryAssessment &&
                        (job.discoveryAssessment.category === 'practice'
                          ? 'Для тренировки · '
                          : 'Целевая роль · ')}
                      {job.source === 'himalayas' && 'Himalayas · '}
                      {job.location || '—'} ·{' '}
                      {job.targetLevel === 'review' ? 'Уровень уточнить' : job.targetLevel} ·{' '}
                      <span className={job.availability.state === 'open' ? 'target-open' : ''}>
                        {availabilityLabels[job.availability.state]}
                      </span>{' '}
                      · наблюдение {checkedDate(job.availability.checkedAt)}
                      {job.availability.verifiedAt && (
                        <> · официальная проверка {checkedDate(job.availability.verifiedAt)}</>
                      )}
                      {job.availability.verificationUrl && (
                        <>
                          {' '}
                          ·{' '}
                          <a
                            href={job.availability.verificationUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Основание
                          </a>
                        </>
                      )}
                    </small>
                    {job.scenarioFit.status !== 'not_selected' && (
                      <p className="scenario-job-status">
                        {job.scenarioFit.label}
                        {[...job.scenarioFit.blockers, ...job.scenarioFit.questions].length
                          ? ': ' +
                            [...job.scenarioFit.blockers, ...job.scenarioFit.questions].join('; ')
                          : ''}
                      </p>
                    )}
                    <p>{shortSentences(job.description, 2, 350) || '—'}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p>—</p>
            )}
            <section className="checked-sources" aria-labelledby="checked-sources-title">
              <h3 id="checked-sources-title">Список проверенных источников</h3>
              <p className="target-vacancies-help">
                Последние сохранённые проверки компании. Результаты относятся к фильтрам и дате
                запуска; 0 результатов не означает, что вакансий нигде нет.
              </p>
              {data.checkedSources.length ? (
                <table>
                  <thead>
                    <tr>
                      <th>Источник</th>
                      <th>Результат</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.checkedSources.map((source) => (
                      <tr key={source.id}>
                        <td>
                          {source.url ? (
                            <a href={source.url} target="_blank" rel="noreferrer">
                              {source.name}
                            </a>
                          ) : (
                            source.name
                          )}
                          <small>{checkedDate(source.checkedAt)}</small>
                        </td>
                        <td className={source.error ? 'source-check-error' : ''}>
                          {source.result}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p>Проверки источников для этой компании ещё не сохранены.</p>
              )}
            </section>
            {company && <CompanyHiringLinks company={company} />}
          </>
        )}
      </div>
    </Modal>
  );
}
