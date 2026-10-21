import type { DatabaseSync } from 'node:sqlite';
import {
  initialSelection,
  effectiveProfile,
  selectionInputSchema,
  type SelectionConfig,
} from '../shared/selection-profile.js';
import type { Profile } from '../shared/model.js';

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
  read(): SelectionConfig {
    const row = this.db
      .prepare('SELECT data FROM selection_profile_versions ORDER BY version DESC LIMIT 1')
      .get();
    return row ? JSON.parse(String(row.data)) : initialSelection(this.profiles());
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
    const old = this.read();
    if (expectedVersion !== old.version)
      throw new Error('Профиль уже изменён. Обновите страницу и повторите правку.');
    // Disabling is reversible. Scenario IDs may be referenced by sources and historical runs.
    if (old.scenarios.some((s) => !value.scenarios.some((next) => next.id === s.id)))
      throw new Error('Выключите ненужный сценарий: его ID нужен для истории');
    return this.insert({
      ...value,
      version: expectedVersion + 1,
      coreVersion:
        old.coreVersion + (JSON.stringify(old.core) === JSON.stringify(value.core) ? 0 : 1),
      updatedAt: new Date().toISOString(),
    });
  }
  profile(id?: string) {
    const config = this.read();
    // A legacy empty profile still resolves to the professional core. Original rows remain intact.
    const legacy = this.profiles().find((p) => p.id === id);
    if (legacy && !config.scenarios.some((s) => s.id === id || s.legacyProfileId === id))
      return legacy.keywords.length || legacy.notes ? legacy : effectiveProfile(config, 'all');
    return effectiveProfile(config, id);
  }
  history() {
    return this.db
      .prepare('SELECT data FROM selection_profile_versions ORDER BY version DESC')
      .all()
      .map((r) => JSON.parse(String(r.data)) as SelectionConfig);
  }
}
