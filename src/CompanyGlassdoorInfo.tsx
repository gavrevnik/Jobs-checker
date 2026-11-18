import type { CompanyGlassdoorEntry } from '../shared/company-glassdoor';
import { External } from './components';

const assignmentFormats = {
  take_home: 'Домашнее задание',
  live: 'Задание на интервью',
  unspecified: 'Задание',
};
const sourceLabels = {
  apify: 'Glassdoor через Apify',
  public_web: 'Glassdoor · веб-поиск',
  browser: 'Glassdoor · браузер',
};

export function CompanyGlassdoorInfo({ entries }: { entries?: CompanyGlassdoorEntry[] }) {
  if (!entries?.length) return null;
  return (
    <section className="company-glassdoor-info" aria-labelledby="company-glassdoor-title">
      <h3 id="company-glassdoor-title">Glassdoor · {entries.length}</h3>
      {[...entries]
        .sort((a, b) => (b.publishedOn ?? '').localeCompare(a.publishedOn ?? ''))
        .map((entry) => (
          <details key={entry.id}>
            <summary>
              {entry.role || 'Роль не указана'} ·{' '}
              {entry.kind === 'interview' ? 'Рассказ кандидата' : 'Отзыв сотрудника'}
            </summary>
            <p className="muted">
              {[
                entry.location,
                entry.kind === 'interview' && entry.interviewOn && `Интервью ${entry.interviewOn}`,
                entry.publishedOn && `Опубликовано ${entry.publishedOn}`,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
            {entry.summary && <p className="preserve-lines">{entry.summary}</p>}
            {entry.kind === 'interview' && !!entry.questions?.length && (
              <div>
                <h4>Вопросы</h4>
                <ul>
                  {entry.questions.map((question, index) => (
                    <li key={index}>
                      {question.text}
                      {question.wording === 'paraphrased' && ' (пересказ)'}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {entry.kind === 'interview' &&
              entry.assignments?.map((assignment, index) => (
                <div key={index}>
                  <h4>
                    {assignmentFormats[assignment.format]}
                    {assignment.timeLimit && ` · ${assignment.timeLimit}`}
                  </h4>
                  <p className="preserve-lines">{assignment.details}</p>
                </div>
              ))}
            {entry.sources.map((source, index) => (
              <External key={index} href={source.url}>
                {sourceLabels[source.via]} · {source.checkedOn}
              </External>
            ))}
          </details>
        ))}
    </section>
  );
}
