import 'dotenv/config';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import { importPublicCases, parsePublicCasesMarkdown } from '../server/public-cases-import.js';

const { values } = parseArgs({
  options: {
    file: { type: 'string' },
    db: { type: 'string' },
    execute: { type: 'boolean', default: false },
  },
});
if (!values.file) throw new Error('Укажите --file <исследование.md> [--db <база>] [--execute]');
const path = resolve(values.db || process.env.SCOUT_DB || '../data/jobs-checker/scout.sqlite');
const sections = parsePublicCasesMarkdown(readFileSync(values.file, 'utf8'), basename(values.file));
// Dry runs only open the existing database read-only; they cannot create an empty live file.
const read = new DatabaseSync(path, { readOnly: true });
try {
  const preview = importPublicCases(read, sections);
  console.log(JSON.stringify({ execute: false, companies: preview }, null, 2));
  if (values.execute && preview.some((p) => p.added)) {
    const folder = join(dirname(path), 'backups', 'public-cases');
    mkdirSync(folder, { recursive: true });
    const backupPath = join(
      folder,
      `before-import-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`,
    );
    // SQLite creates a consistent snapshot including committed WAL pages. Unlike a file
    // copy, this remains safe while the local application is running.
    read.prepare('VACUUM INTO ?').run(backupPath);
    const check = new DatabaseSync(backupPath, { readOnly: true });
    try {
      if (check.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok')
        throw new Error('Проверка резервной копии не пройдена; импорт отменён');
    } finally {
      check.close();
    }
    const db = new DatabaseSync(path);
    try {
      db.exec('PRAGMA busy_timeout=5000');
      console.log(
        JSON.stringify(
          { execute: true, backupPath, companies: importPublicCases(db, sections, true) },
          null,
          2,
        ),
      );
    } finally {
      db.close();
    }
  }
} finally {
  read.close();
}
