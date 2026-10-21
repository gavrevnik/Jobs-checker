import { it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store';
// Existing synthetic WAL database, never the user's SCOUT_DB.
it('backs up an existing WAL database before additive migration, preserves payloads and runs once', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jobs-research-migration-')),
    path = join(dir, 'fixture.sqlite');
  const old = new DatabaseSync(path);
  let store: Store | undefined;
  try {
    old.exec('PRAGMA journal_mode=WAL; CREATE TABLE preserved (id TEXT,data TEXT);');
    old.prepare('INSERT INTO preserved VALUES (?,?)').run('original', 'Personal notes fixture');
    store = new Store(path);
    expect(store.db.prepare('SELECT data FROM preserved').get()?.data).toBe(
      'Personal notes fixture',
    );
    const backups = join(dir, 'backups/company-research'),
      files = readdirSync(backups);
    const snapshot = files.find((f) => f.endsWith('.sqlite'))!;
    expect(snapshot).toBeTruthy();
    expect(files.filter((f) => f.endsWith('.sqlite'))).toHaveLength(1);
    const copied = new DatabaseSync(join(backups, snapshot), { readOnly: true });
    try {
      expect(copied.prepare('PRAGMA integrity_check').get()?.integrity_check).toBe('ok');
      expect(copied.prepare('SELECT data FROM preserved').get()?.data).toBe(
        'Personal notes fixture',
      );
      expect(
        copied.prepare("SELECT 1 FROM sqlite_master WHERE name='company_research_registry'").get(),
      ).toBeUndefined();
    } finally {
      copied.close();
    }
    const metadata = JSON.parse(
      readFileSync(join(backups, snapshot.replace(/\.sqlite$/, '.json')), 'utf8'),
    );
    expect(metadata.tables.preserved.rows).toBe(1);
    store.db.close();
    store = undefined;
    store = new Store(path);
    expect(readdirSync(backups).filter((f) => f.endsWith('.sqlite'))).toHaveLength(1);
  } finally {
    store?.db.close();
    old.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it('backs up an existing research database before adding persisted scores, then reopens without another backup', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jobs-score-migration-'));
  const path = join(dir, 'fixture.sqlite');
  const old = new DatabaseSync(path);
  let store: Store | undefined;
  try {
    old.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE company_research_registry (version TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE preserved (data TEXT);
      INSERT INTO preserved VALUES ('Existing research fixture');`);
    store = new Store(path);
    expect(
      store.db.prepare("SELECT 1 FROM sqlite_master WHERE name='company_research_scores'").get(),
    ).toBeTruthy();
    const backups = join(dir, 'backups/company-research');
    const snapshot = readdirSync(backups).find((f) => f.endsWith('.sqlite'))!;
    const copy = new DatabaseSync(join(backups, snapshot), { readOnly: true });
    try {
      expect(copy.prepare('PRAGMA integrity_check').get()?.integrity_check).toBe('ok');
      expect(copy.prepare('SELECT data FROM preserved').get()?.data).toBe(
        'Existing research fixture',
      );
      expect(
        copy.prepare("SELECT 1 FROM sqlite_master WHERE name='company_research_scores'").get(),
      ).toBeUndefined();
    } finally {
      copy.close();
    }
    store.db.close();
    store = new Store(path);
    expect(readdirSync(backups).filter((f) => f.endsWith('.sqlite'))).toHaveLength(1);
  } finally {
    store?.db.close();
    old.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
