import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Modal } from './components';
import { api } from './api';
import { shortSentences } from './company-presentation';
import type { ComparisonProfile } from './company-comparison';
import { stageLabels, type Company } from '../shared/model';
import { availabilityLabels } from '../shared/target-vacancies';
import { jobReviewCategory, pipelineSection } from '../shared/job-pipeline';
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
  onPipeline,
}: {
  companyId: string;
  name: string;
  close: () => void;
  onJob: (id: string) => void;
  onJobs: (companyId: string, ids: string[]) => void;
  onPipeline: (companyId: string) => void;
}) {
  const [data, setData] = useState<ComparisonProfile['targetVacancies'] | null>(null);
  const [error, setError] = useState('');
  const [company, setCompany] = useState<Company | null>(null);
  const [view, setView] = useState<'working' | 'history' | 'review'>('working');
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
  const working = data?.workingJobs ?? [];
  const history = (data?.historyJobs ?? []).filter(
    (job) => pipelineSection(job, job.availability) === 'history',
  );
  const review = (data?.historyJobs ?? []).filter(
    (job) => pipelineSection(job, job.availability) === 'review',
  );
  const views = [
    {
      id: 'working',
      jobs: working,
      label: 'В воронке',
      help: 'Вакансии прошли оценку, их открытость подтверждена. Этап можно изменить в карточке или в воронке.',
      empty: 'Открытых вакансий для воронки пока нет.',
    },
    {
      id: 'history',
      jobs: history,
      label: 'История',
      help: 'Закрытые и архивные вакансии компании.',
      empty: 'В истории пока нет вакансий.',
    },
    {
      id: 'review',
      jobs: review,
      label: 'На проверке',
      help: 'Вакансии, для которых ещё нужно оценить релевантность или подтвердить открытость.',
      empty: 'На проверке пока нет вакансий.',
    },
  ] as const;
  const current = views.find((item) => item.id === view) ?? views[0];
  const jobs = current.jobs;
  return (
    <Modal title={`${name} · Вакансии`} close={close} wide>
      <div className="target-vacancies-modal">
        {error ? (
          <p role="alert">{error}</p>
        ) : !data ? (
          <p role="status">Загрузка…</p>
        ) : (
          <>
            <div className="target-vacancies-heading">
              {views.map((item) => (
                <button
                  className={`button ${view === item.id ? 'primary' : 'secondary'}`}
                  key={item.id}
                  aria-pressed={view === item.id}
                  onClick={() => setView(item.id)}
                >
                  {item.label} ({item.jobs.length})
                </button>
              ))}
              <button
                className="text-link"
                disabled={!data.workingOpen}
                onClick={() => {
                  close();
                  onPipeline(companyId);
                }}
              >
                В воронку
              </button>
              <button
                className="button"
                disabled={!jobs.length}
                onClick={() => {
                  close();
                  onJobs(
                    companyId,
                    jobs.flatMap((job) => job.atsJobIds),
                  );
                }}
              >
                Показать в ATS
              </button>
            </div>
            <p className="target-vacancies-help">{current.help}</p>
            {jobs.length ? (
              <ul className="target-vacancy-list">
                {jobs.map((job) => {
                  const category = jobReviewCategory(job);
                  return (
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
                        {category === 'practice' && 'Для тренировки · '}
                        {category === 'target' && 'Целевая роль · '}
                        {category === 'uncertain' && 'Нужна оценка · '}
                        {stageLabels[job.stage]} · {job.source === 'himalayas' && 'Himalayas · '}
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
                  );
                })}
              </ul>
            ) : (
              <p>{current.empty}</p>
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
