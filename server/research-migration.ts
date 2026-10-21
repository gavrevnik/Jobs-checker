import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export const retiredComparisonFieldsKey = 'company-research:retired-comparison-fields-v1';
// Run before opening the application Store. Existing files get a verified WAL-aware snapshot once.
export function backupBeforeResearchMigration(path: string) {
  if (path === ':memory:' || !existsSync(path)) return;
  const db = new DatabaseSync(path, { readOnly: true });
  let migrated: boolean;
  try {
    migrated =
      Number(
        db
          .prepare(
            "SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name IN ('company_research_registry','company_research_scores')",
          )
          .get()?.n,
      ) === 2;
    if (migrated) {
      const hasSettings = db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='settings'")
        .get();
      migrated =
        !!hasSettings &&
        !!db.prepare('SELECT 1 FROM settings WHERE key=?').get(retiredComparisonFieldsKey);
    }
  } finally {
    db.close();
  }
  if (migrated) return;
  const radar = fileURLToPath(new URL('../../personal-radar/', import.meta.url));
  const python = existsSync(resolve(radar, '.venv/bin/python'))
    ? resolve(radar, '.venv/bin/python')
    : 'python3';
  const result = spawnSync(
    python,
    [
      '-c',
      'import sys; from catalog_sync.core import backup_database; backup_database(sys.argv[1], sys.argv[2])',
      resolve(path),
      resolve(dirname(path), 'backups/company-research'),
    ],
    { cwd: radar, encoding: 'utf8', timeout: 60000 },
  );
  if (result.status !== 0)
    throw new Error(
      'Не удалось создать проверенный WAL-aware backup перед discovery migration. База не изменена.',
    );
}

// A user-requested one-time removal. The startup guard above backs up the old WAL database first.
export function retireComparisonFields(db: DatabaseSync) {
  if (db.prepare('SELECT 1 FROM settings WHERE key=?').get(retiredComparisonFieldsKey)) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
      DELETE FROM company_research_reviews WHERE observation_id IN (
        SELECT id FROM company_research_observations WHERE json_extract(data,'$.criterion_id') IN ('A02','A06')
      );
      DELETE FROM company_research_observations WHERE json_extract(data,'$.criterion_id') IN ('A02','A06');
      DELETE FROM company_research_scores;
      DELETE FROM company_research_previews;
    `);
    // Keep run IDs, original import digests, unrelated facts and provenance. Remove the retired
    // structured values from the stored import documents as well as from operational facts.
    const update = db.prepare('UPDATE company_research_runs SET data=? WHERE id=?');
    for (const row of db.prepare('SELECT id,data FROM company_research_runs').all()) {
      const run = JSON.parse(String(row.data));
      let changed = false;
      for (const company of run.document?.companies || []) {
        const previous = company.observations || [];
        company.observations = previous.filter(
          (o: { criterion_id: string }) => !['A02', 'A06'].includes(o.criterion_id),
        );
        changed ||= previous.length !== company.observations.length;
      }
      if (changed) {
        run.removedCriteria = [...new Set([...(run.removedCriteria || []), 'A02', 'A06'])];
        update.run(JSON.stringify(run), row.id);
      }
    }
    db.prepare('INSERT INTO settings (key,value) VALUES (?,?)').run(
      retiredComparisonFieldsKey,
      new Date().toISOString(),
    );
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
export const researchSql = `
 CREATE TABLE IF NOT EXISTS company_research_registry (version TEXT PRIMARY KEY, data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS company_research_scores (company_id TEXT PRIMARY KEY, data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS company_research_runs (id TEXT PRIMARY KEY, digest TEXT UNIQUE NOT NULL, data TEXT NOT NULL, at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS company_research_observations (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, run_id TEXT NOT NULL, digest TEXT NOT NULL, data TEXT NOT NULL, at TEXT NOT NULL, UNIQUE(company_id,digest));
 CREATE INDEX IF NOT EXISTS company_research_by_company ON company_research_observations(company_id);
 CREATE TABLE IF NOT EXISTS company_research_reviews (id TEXT PRIMARY KEY, observation_id TEXT NOT NULL, data TEXT NOT NULL, at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS company_research_flags (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, run_id TEXT NOT NULL, digest TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(company_id,digest));
 CREATE TABLE IF NOT EXISTS company_research_identity (company_id TEXT PRIMARY KEY, data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS company_research_preferences (company_id TEXT PRIMARY KEY, data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS company_research_previews (id TEXT PRIMARY KEY, digest TEXT NOT NULL, state_digest TEXT NOT NULL, data TEXT NOT NULL, expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS company_research_paid_grants (id TEXT PRIMARY KEY, data TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS company_research_paid_ledger (id TEXT PRIMARY KEY, grant_id TEXT NOT NULL, data TEXT NOT NULL);
`;
