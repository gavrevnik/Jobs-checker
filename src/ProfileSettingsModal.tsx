import { useState } from 'react';
import { Modal } from './components';
import { api } from './api';
import {
  dimensions,
  dimensionIds,
  roleFamilies,
  scenarioSchema,
  type SelectionConfig,
} from '../shared/selection-profile';

const split = (s: string) =>
  s
    .split(/[,\n]/)
    .map((v) => v.trim())
    .filter(Boolean);
export function ProfileSettingsModal({
  config,
  close,
  saved,
}: {
  config: SelectionConfig;
  close: () => void;
  saved: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => structuredClone(config));
  const [tab, setTab] = useState<'core' | 'scenarios' | 'history'>('core');
  const [selected, setSelected] = useState(
    config.activeScenarioId || config.scenarios[0]?.id || '',
  );
  const [history, setHistory] = useState<SelectionConfig[]>([]);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const core = (patch: Partial<SelectionConfig['core']>) =>
    setDraft((v) => ({ ...v, core: { ...v.core, ...patch } }));
  const scenario = draft.scenarios.find((s) => s.id === selected);
  const changeScenario = (patch: Partial<NonNullable<typeof scenario>>) =>
    setDraft((v) => ({
      ...v,
      scenarios: v.scenarios.map((s) => (s.id === selected ? { ...s, ...patch } : s)),
    }));
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/selection', 'PATCH', {
        expectedVersion: config.version,
        core: draft.core,
        scenarios: draft.scenarios,
        activeScenarioId: draft.activeScenarioId,
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
    <Modal title="Мой профиль" close={close} wide>
      <form className="selection-settings" onSubmit={save}>
        <p className="selection-intro">
          Одно профессиональное ядро для всех компаний. География и условия оформления задаются
          отдельно.
        </p>
        <div className="selection-tabs" role="tablist" aria-label="Настройки профиля">
          {(
            [
              ['core', 'Профессиональное ядро'],
              ['scenarios', 'Доступность'],
              ['history', 'История'],
            ] as const
          ).map(([id, title]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={tab === id ? 'active' : ''}
              onClick={() => {
                setTab(id);
                if (id === 'history')
                  void api<{ versions: SelectionConfig[] }>('/selection/history')
                    .then((r) => setHistory(r.versions))
                    .catch((e) => setError(e.message));
              }}
            >
              {title}
            </button>
          ))}
        </div>
        {tab === 'core' && (
          <div className="selection-fields">
            <label>
              Название профиля
              <input
                value={draft.core.name}
                onChange={(e) => core({ name: e.target.value })}
                required
                maxLength={100}
              />
            </label>
            <label>
              Уровень
              <select
                value={draft.core.seniority}
                onChange={(e) => core({ seniority: e.target.value as typeof draft.core.seniority })}
              >
                {Object.entries({
                  any: 'Любой',
                  middle_plus: 'Middle+ · Senior · Lead',
                  senior: 'Senior',
                  lead: 'Lead',
                  middle: 'Middle',
                  junior: 'Junior',
                  intern: 'Стажировка',
                }).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="full">
              <legend>Подходящие направления</legend>
              <div className="selection-checks">
                {Object.entries(roleFamilies).map(([id, label]) => (
                  <label key={id}>
                    <input
                      type="checkbox"
                      checked={draft.core.roleFamilies.includes(id as keyof typeof roleFamilies)}
                      onChange={(e) =>
                        core({
                          roleFamilies: e.target.checked
                            ? [...draft.core.roleFamilies, id as keyof typeof roleFamilies]
                            : draft.core.roleFamilies.filter((x) => x !== id),
                        })
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="full">
              Опыт, желаемая работа и приоритеты
              <textarea
                rows={9}
                value={draft.core.notes}
                maxLength={10000}
                onChange={(e) => core({ notes: e.target.value })}
              />
            </label>
            <label className="selection-check full">
              <input
                type="checkbox"
                checked={draft.core.preferMatureTeam}
                onChange={(e) => core({ preferMatureTeam: e.target.checked })}
              />
              В Target прежде всего зрелая среда и сильные коллеги
            </label>
            <details className="full">
              <summary>Поисковые слова и веса оценки</summary>
              <div className="selection-fields">
                <label className="full">
                  Поисковые слова · через запятую
                  <textarea
                    rows={3}
                    defaultValue={draft.core.keywords.join(', ')}
                    onChange={(e) => core({ keywords: split(e.target.value) })}
                  />
                </label>
                <label className="full">
                  Исключения · через запятую
                  <input
                    defaultValue={draft.core.exclude.join(', ')}
                    onChange={(e) => core({ exclude: split(e.target.value) })}
                  />
                </label>
                {dimensionIds.map((id) => (
                  <label key={id}>
                    {dimensions[id].label}
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={draft.core.weights[id]}
                      onChange={(e) =>
                        core({ weights: { ...draft.core.weights, [id]: Number(e.target.value) } })
                      }
                    />
                  </label>
                ))}
                <p>Сумма: {Object.values(draft.core.weights).reduce((a, b) => a + b, 0)} из 100.</p>
              </div>
            </details>
          </div>
        )}
        {tab === 'scenarios' && (
          <>
            <p className="selection-intro">
              Сценарий меняет отбор вакансий и вопросы об условиях. Балл аналитической среды от
              географии не зависит.
            </p>
            <div className="selection-scenario-picker">
              <select
                aria-label="Сценарий для редактирования"
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
              >
                <option value="">Выберите сценарий</option>
                {draft.scenarios.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.enabled ? '' : ' · выключен'}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  const s = scenarioSchema.parse({
                    id: crypto.randomUUID(),
                    name: 'Новый сценарий',
                  });
                  setDraft((v) => ({ ...v, scenarios: [...v.scenarios, s] }));
                  setSelected(s.id);
                }}
              >
                Добавить
              </button>
            </div>
            {scenario && (
              <div className="selection-fields" key={scenario.id}>
                <label className="full">
                  Название
                  <input
                    required
                    value={scenario.name}
                    maxLength={100}
                    onChange={(e) => changeScenario({ name: e.target.value })}
                  />
                </label>
                <label className="full">
                  Страны или города · через запятую
                  <input
                    defaultValue={scenario.locations.join(', ')}
                    onChange={(e) => changeScenario({ locations: split(e.target.value) })}
                  />
                </label>
                <label>
                  Формат
                  <select
                    value={scenario.workMode}
                    onChange={(e) =>
                      changeScenario({ workMode: e.target.value as typeof scenario.workMode })
                    }
                  >
                    {Object.entries({
                      any: 'Любой',
                      remote: 'Удалённо',
                      hybrid: 'Гибрид',
                      onsite: 'Офис',
                    }).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Визовая поддержка
                  <select
                    value={scenario.sponsorship}
                    onChange={(e) =>
                      changeScenario({ sponsorship: e.target.value as typeof scenario.sponsorship })
                    }
                  >
                    <option value="unknown">Уточнить</option>
                    <option value="required">Нужна</option>
                    <option value="not_required">Не нужна</option>
                  </select>
                </label>
                <label>
                  Помощь с релокацией
                  <select
                    value={scenario.relocation}
                    onChange={(e) =>
                      changeScenario({ relocation: e.target.value as typeof scenario.relocation })
                    }
                  >
                    <option value="any">Не обязательна</option>
                    <option value="required">Нужна</option>
                    <option value="not_required">Не нужна</option>
                  </select>
                </label>
                <label>
                  Языки
                  <input
                    defaultValue={scenario.languages.join(', ')}
                    onChange={(e) => changeScenario({ languages: split(e.target.value) })}
                  />
                </label>
                <label>
                  Зарплата от
                  <input
                    type="number"
                    min={0}
                    value={scenario.minSalary ?? ''}
                    onChange={(e) =>
                      changeScenario({ minSalary: e.target.value ? Number(e.target.value) : null })
                    }
                  />
                </label>
                <label>
                  Валюта и период
                  <div className="selection-inline">
                    <select
                      aria-label="Валюта"
                      value={scenario.currency}
                      onChange={(e) =>
                        changeScenario({ currency: e.target.value as typeof scenario.currency })
                      }
                    >
                      {['EUR', 'USD', 'GBP', 'MDL', 'RON'].map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                    <select
                      aria-label="Период зарплаты"
                      value={scenario.salaryPeriod}
                      onChange={(e) =>
                        changeScenario({
                          salaryPeriod: e.target.value as typeof scenario.salaryPeriod,
                        })
                      }
                    >
                      <option value="year">В год</option>
                      <option value="month">В месяц</option>
                      <option value="hour">В час</option>
                    </select>
                  </div>
                </label>
                <label className="full">
                  Дополнительные условия
                  <textarea
                    rows={3}
                    value={scenario.notes}
                    onChange={(e) => changeScenario({ notes: e.target.value })}
                  />
                </label>
                <label className="selection-check full">
                  <input
                    type="checkbox"
                    checked={scenario.enabled}
                    onChange={(e) => {
                      changeScenario({ enabled: e.target.checked });
                      if (!e.target.checked && draft.activeScenarioId === scenario.id)
                        setDraft((v) => ({ ...v, activeScenarioId: '' }));
                    }}
                  />
                  Сценарий включён
                </label>
                <small className="full">
                  В запросе к модели можно указать: «Используй сценарий {scenario.name}».
                  Выключенные сценарии сохраняются для истории.
                </small>
              </div>
            )}
          </>
        )}
        {tab === 'history' && (
          <div className="selection-history">
            <p>
              Исходные профили сохранены в «Дополнительно». Каждое изменение ядра и сценариев
              сохраняет предыдущую версию.
            </p>
            {history.map((v) => (
              <details key={v.version}>
                <summary>
                  {new Date(v.updatedAt).toLocaleString('ru-RU')} · {v.core.name} · версия ядра{' '}
                  {v.coreVersion}
                </summary>
                <p>{v.core.notes}</p>
                <p>
                  {v.scenarios
                    .map((s) => `${s.name}: ${s.locations.join(', ') || 'любая география'}`)
                    .join('; ')}
                </p>
              </details>
            ))}
          </div>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="selection-footer">
          <span>Оценки по изменённому ядру потребуют пересмотра.</span>
          <button className="button primary" disabled={busy} type="submit">
            {busy ? 'Сохраняю…' : 'Сохранить'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
