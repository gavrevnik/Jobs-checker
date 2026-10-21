import { useState } from 'react';
import { Modal } from './components';
import { api } from './api';
import type { FitAssessment } from '../shared/company-fit';
import type { CultureAssessment } from '../shared/company-culture-fit';
import type { ComparisonProfile } from './company-comparison';

export function CompanyScoreModal({
  company,
  close,
  saved,
}: {
  company: ComparisonProfile;
  close: () => void;
  saved: () => Promise<void>;
}) {
  const fit = company.fit;
  const [layerId, setLayerId] = useState('company');
  const layer =
    fit.culture &&
    (layerId === 'company' ? fit.culture.company : fit.culture.teams.find((t) => t.id === layerId));
  const view = layer || fit;
  const viewScope = fit.culture?.teams.find((t) => t.id === layerId)?.scope || fit.scope;
  const provisional =
    layer && layerId !== 'company'
      ? layer.confidence < 60 || layer.coverage < 60 || layer.needsReview
      : fit.provisional;
  const [history, setHistory] = useState<(FitAssessment | CultureAssessment)[] | null>(null);
  const [plan, setPlan] = useState<{ questions: string[]; sourceQueries: string[] } | null>(null);
  async function loadResearch(kind: 'history' | 'plan') {
    try {
      setError('');
      const result = await api(
        `/company-research/${company.company.id}/${kind === 'history' ? 'assessments' : 'culture-plan'}`,
      );
      if (kind === 'history') setHistory(result.assessments);
      else setPlan(result);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const [queue, setQueue] = useState<string>(company.preferences.priority);
  const [goal, setGoal] = useState<string>(company.preferences.practiceGoal || '');
  const [reflection, setReflection] = useState<string>(
    company.preferences.practiceReflection || '',
  );
  const [hours, setHours] = useState<string>(company.preferences.practiceHours?.toString() || '');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(`/company-research/${company.company.id}/preferences`, 'PATCH', {
        priority: queue,
        notes: company.preferences.notes,
        practiceGoal: goal,
        practiceReflection: reflection,
        practiceHours: hours ? Number(hours) : null,
      });
      await saved();
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={`${company.company.name} · Оценка`} close={close} wide>
      <div className="company-score-modal">
        {fit.culture && (
          <>
            <div className="culture-layer-tabs" role="group" aria-label="Компания и команды">
              <button
                className={layerId === 'company' ? 'button primary' : 'button'}
                onClick={() => setLayerId('company')}
              >
                Компания
              </button>
              {fit.culture.teams.map((t) => (
                <button
                  key={t.id}
                  className={layerId === t.id ? 'button primary' : 'button'}
                  onClick={() => setLayerId(t.id)}
                >
                  {t.name}
                </button>
              ))}
            </div>
            <p className="score-scope">
              В таблице — балл компании. Команды оценены отдельно: их условия и коллеги могут
              различаться.
            </p>
            {!fit.culture.teams.length && <p>Конкретная команда пока не исследована.</p>}
          </>
        )}
        <div className="score-summary">
          <strong>
            {fit.outdated || view.score === null ? '—' : view.score}
            <small> / 100</small>
          </strong>
          <div>
            <h3>Насколько интересна аналитическая среда</h3>
            <p>
              {fit.outdated
                ? 'Оценка требует обновления'
                : provisional
                  ? 'Предварительная оценка'
                  : 'Оценка по профессиональному профилю'}{' '}
              · изучено {view.coverage}%
            </p>
          </div>
        </div>
        {layer && (
          <p className="score-scope">
            Уверенность в актуальности: {layer.confidenceLabel.toLowerCase()} · {layer.confidence} /
            100. {layer.summary}
          </p>
        )}
        {fit.outdated && (
          <p className="score-caution">
            Профиль или основания изменились. Прежний результат {fit.previousScore ?? '—'}/100
            сохранён в истории и не участвует в текущем ранжировании.
          </p>
        )}
        <p className="score-scope">
          {viewScope.role ||
            (viewScope.context?.startsWith('source:')
              ? 'Разбор опубликованного кейса · применимость к команде уточнить'
              : viewScope.context) ||
            'Компания в целом · применимость к конкретной команде нужно уточнить'}
          {viewScope.country ? ` · ${viewScope.country}` : ''}
        </p>
        <div className="score-breakdown">
          {view.components.map((d) => (
            <div className="score-component" key={d.id}>
              <div className="score-component-title">
                <strong>{d.label}</strong>
                <span>
                  {d.rating === null ? 'Неизвестно' : `${d.rating} / 4`}
                  <small> · вес {d.weight}%</small>
                </span>
              </div>
              <div className="score-track">
                <span style={{ width: `${(d.rating ?? 0) * 25}%` }} />
              </div>
              <p>{d.reason}</p>
              {'confidence' in d && (
                <small className="score-evidence-age">
                  {d.temporal === 'historical'
                    ? 'Историческая практика'
                    : d.temporal === 'recent'
                      ? 'Есть публикация за последний год'
                      : d.temporal === 'undated'
                        ? 'Дата практики не указана'
                        : 'Нет оснований'}{' '}
                  · уверенность {d.confidence}/100
                </small>
              )}
              {!!d.evidenceIds.length && (
                <details>
                  <summary>
                    {d.basis === 'role_requirement'
                      ? 'Основания · требования вакансии'
                      : 'Основания'}
                  </summary>
                  {[
                    ...new Map(
                      d.evidenceIds
                        .flatMap(
                          (id) => company.observations.find((o) => o.id === id)?.evidence || [],
                        )
                        .map((e) => [e.url, e]),
                    ).values(),
                  ].map((e) => (
                    <p key={e.url}>
                      <a href={e.url} target="_blank" rel="noreferrer">
                        {e.title}
                      </a>
                      <small>
                        {' '}
                        ·{' '}
                        {e.published_at
                          ? `опубликовано ${e.published_at.slice(0, 10)}`
                          : 'дата публикации не указана'}{' '}
                        · прочитано {e.observed_at.slice(0, 10)}
                      </small>
                    </p>
                  ))}
                </details>
              )}
            </div>
          ))}
        </div>
        <div className="score-next">
          <strong>Что проверить дальше</strong>
          <p>{view.nextStep}</p>
          <small>{fit.suggestionReason}</small>
        </div>
        <details className="score-method">
          <summary>Ресерч «Культура и команда» и история</summary>
          <p>
            Отдельный разбор кейсов, методов, совместной работы и поддержки аналитиков вне вакансий.
            План использует сохранённые факты; сам по себе внешний поиск не запускает.
          </p>
          <button className="button" onClick={() => loadResearch('plan')}>
            Показать план исследования
          </button>{' '}
          <button className="button" onClick={() => loadResearch('history')}>
            Показать историю оценок
          </button>
          {plan && (
            <>
              <ul>
                {plan.questions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
              <details>
                <summary>Поисковые запросы</summary>
                <ul>
                  {plan.sourceQueries.map((q) => (
                    <li key={q}>{q}</li>
                  ))}
                </ul>
              </details>
            </>
          )}
          {history && (
            <ul>
              {history.map((h) => {
                const modern = 'company' in h;
                const ds = modern ? h.company.dimensions : h.dimensions;
                const coverage = h.weights
                  ? ds.reduce((sum, d) => sum + (d.rating === null ? 0 : h.weights![d.id]), 0)
                  : 0;
                const score = coverage
                  ? Math.round(
                      (100 *
                        ds.reduce((sum, d) => sum + ((d.rating ?? 0) * h.weights![d.id]) / 4, 0)) /
                        coverage,
                    )
                  : null;
                return (
                  <li key={h.id}>
                    <details>
                      <summary>
                        {h.createdAt.slice(0, 10)} ·{' '}
                        {modern ? 'Компания и команды' : 'Прежняя оценка'} · {score ?? '—'}/100
                      </summary>
                      <p>{modern ? h.company.summary.text : h.analytics.text}</p>
                      <small>
                        Профиль версии {h.profileVersion}. Результат на момент сохранения; методики
                        могут отличаться.
                      </small>
                      <ul>
                        {ds.map((d) => (
                          <li key={d.id}>
                            {fit.components.find((c) => c.id === d.id)?.label}:{' '}
                            {d.rating === null ? 'неизвестно' : `${d.rating}/4`} · {d.reason}
                          </li>
                        ))}
                      </ul>
                    </details>
                  </li>
                );
              })}
            </ul>
          )}
        </details>
        <form onSubmit={save} className="score-queue-form">
          <label>
            Моя очередь
            <select value={queue} onChange={(e) => setQueue(e.target.value)}>
              <option value="Unassigned">Пока не выбрана</option>
              <option value="Target">Target · хочу работать здесь</option>
              <option value="Practice">Практика интервью</option>
              <option value="Secondary">Резерв</option>
            </select>
          </label>
          {queue === 'Practice' && (
            <>
              <label>
                Что хочу потренировать
                <input
                  value={goal}
                  maxLength={300}
                  onChange={(e) => setGoal(e.target.value)}
                  placeholder="Например, product sense на английском"
                />
              </label>
              <label>
                Лимит подготовки и интервью · часов
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                />
              </label>
              <label>
                Итог практики и следующий шаг
                <textarea
                  rows={3}
                  maxLength={2000}
                  value={reflection}
                  onChange={(e) => setReflection(e.target.value)}
                />
              </label>
              <p>
                Очередь для подготовки. Желание принять оффер и «средний» балл компании не
                обязательны.
              </p>
            </>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <button className="button primary" disabled={busy}>
            {busy ? 'Сохраняю…' : 'Сохранить очередь'}
          </button>
        </form>
        <details className="score-method">
          <summary>Как считается балл</summary>
          <p>
            Шесть составляющих оцениваются от 0 до 4: неблагоприятная практика → эпизодическая →
            базовая → устойчивый процесс → сильная системная практика. Сумма с учётом весов
            приводится к 100 по изученной части. Неизвестное не считается нулём.
          </p>
          <p>
            При текущих пробелах возможный полный результат: {view.range[0]}–{view.range[1]}. Это
            границы при неизвестных данных, не вероятность. Высокий предварительный балл — повод
            исследовать компанию.
          </p>
          <p>
            Рекомендация Target требует балла от 80, покрытия от 60% и, при вашем приоритете зрелой
            среды, уровня не ниже 3 по методам и коллегам. В новом разборе также нужна уверенность
            от 60 в целом и по этим двум составляющим. Вакансии не используются как основания
            культуры. Личная очередь всегда задаётся вами.
          </p>
          <p>
            География, оформление и совпадение с конкретной ролью проверяются отдельно. Старые
            сигналы без содержательного разбора дают только предварительную оценку; название
            инструмента, бренд и количество публикаций не добавляют баллы.
          </p>
          {fit.culture && (
            <p>
              Исторический кейс сохраняет балл доказанной экспертизы. Уверенность снижается с
              возрастом публикации: вдвое за три года для компании и за год для команды; повторное
              чтение не обновляет дату практики. Источник без даты даёт не более 55/100. Это
              ориентир для проверки, не вероятность. Репутация компании не переносится на команду;
              отсутствие вакансий не снижает балл.
            </p>
          )}
        </details>
      </div>
    </Modal>
  );
}
