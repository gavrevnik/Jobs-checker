import type { DatabaseSync } from 'node:sqlite';
import { isDeepStrictEqual } from 'node:util';
import {
  initialSelection,
  effectiveProfile,
  selectionInputSchema,
  type SelectionConfig,
} from '../shared/selection-profile.js';
import type { Profile } from '../shared/model.js';
import { RadarSelection, selectionSourceKey } from './radar-selection.js';

export const selectionSql = `
 CREATE TABLE IF NOT EXISTS selection_profile_versions (version INTEGER PRIMARY KEY, data TEXT NOT NULL, at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS company_fit_assessments (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, data TEXT NOT NULL, at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS company_fit_by_company ON company_fit_assessments(company_id);
 CREATE TABLE IF NOT EXISTS company_queue_history (id INTEGER PRIMARY KEY, company_id TEXT NOT NULL, data TEXT NOT NULL, at TEXT NOT NULL);
`;
export class SelectionStore {
  constructor(
    private db: DatabaseSync,
    private profiles: () => Profile[],
  ) {}
  private radar() {
    const row = this.db.prepare('SELECT value FROM settings WHERE key=?').get(selectionSourceKey);
    return row ? new RadarSelection(String(row.value)) : undefined;
  }
  private latest(): SelectionConfig {
    const row = this.db
      .prepare('SELECT data FROM selection_profile_versions ORDER BY version DESC LIMIT 1')
      .get();
    return row ? JSON.parse(String(row.data)) : initialSelection(this.profiles());
  }
  read(): SelectionConfig {
    const radar = this.radar();
    return radar ? this.project(radar) : this.latest();
  }
  private project(
    radar: RadarSelection,
    record?: ReturnType<RadarSelection['read']>,
  ): SelectionConfig {
    for (let attempt = 0; attempt < 3; attempt++) {
      const old = this.latest();
      const { core, scenarios, activeScenarioId } = (record ?? radar.read()).metadata.selection;
      const { expectedVersion: _, ...value } = selectionInputSchema.parse({
        expectedVersion: old.version,
        core,
        scenarios: scenarios.map((scenario) => ({
          ...scenario,
          legacyProfileId: old.scenarios.find((s) => s.id === scenario.id)?.legacyProfileId ?? '',
        })),
        activeScenarioId,
      });
      this.preserveScenarios(old, value.scenarios);
      if (
        isDeepStrictEqual(value, {
          core: old.core,
          scenarios: old.scenarios,
          activeScenarioId: old.activeScenarioId,
        })
      )
        return old;
      const next = this.next(old, value);
      const inserted = this.db
        .prepare('INSERT OR IGNORE INTO selection_profile_versions VALUES (?,?,?)')
        .run(next.version, JSON.stringify(next), next.updatedAt);
      if (inserted.changes) return next;
      record = undefined;
    }
    throw new Error('Профиль изменился во время чтения. Повторите запрос.');
  }
  initialize() {
    if (!this.db.prepare('SELECT 1 FROM selection_profile_versions LIMIT 1').get())
      this.insert(initialSelection(this.profiles()));
  }
  private insert(value: SelectionConfig) {
    this.db
      .prepare('INSERT INTO selection_profile_versions VALUES (?,?,?)')
      .run(value.version, JSON.stringify(value), value.updatedAt);
    return value;
  }
  save(input: unknown) {
    const { expectedVersion, ...value } = selectionInputSchema.parse(input);
    const radar = this.radar();
    const record = radar?.read();
    const old = radar ? this.project(radar, record) : this.latest();
    if (expectedVersion !== old.version)
      throw new Error('Профиль уже изменён. Обновите страницу и повторите правку.');
    this.preserveScenarios(old, value.scenarios);
    if (radar && record) {
      radar.save(record, expectedVersion, value);
      return this.project(radar);
    }
    return this.insert(this.next(old, value));
  }
  private preserveScenarios(old: SelectionConfig, scenarios: SelectionConfig['scenarios']) {
    // Disabling is reversible. Scenario IDs may be referenced by sources and historical runs.
    if (old.scenarios.some((s) => !scenarios.some((next) => next.id === s.id)))
      throw new Error('Выключите ненужный сценарий: его ID нужен для истории');
  }
  private next(
    old: SelectionConfig,
    value: Pick<SelectionConfig, 'core' | 'scenarios' | 'activeScenarioId'>,
  ): SelectionConfig {
    return {
      ...value,
      version: old.version + 1,
      coreVersion: old.coreVersion + (isDeepStrictEqual(old.core, value.core) ? 0 : 1),
      updatedAt: new Date().toISOString(),
    };
  }
  profile(id?: string) {
    const config = this.read();
    // A legacy empty profile still resolves to the professional core. Original rows remain intact.
    const legacy = this.profiles().find((p) => p.id === id);
    if (legacy && !config.scenarios.some((s) => s.id === id || s.legacyProfileId === id))
      return !this.radar() && (legacy.keywords.length || legacy.notes)
        ? legacy
        : effectiveProfile(config, 'all');
    return effectiveProfile(config, id);
  }
  history() {
    return this.db
      .prepare('SELECT data FROM selection_profile_versions ORDER BY version DESC')
      .all()
      .map((r) => JSON.parse(String(r.data)) as SelectionConfig);
  }
}
