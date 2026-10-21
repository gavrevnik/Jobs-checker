import { expect, it } from 'vitest';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../server/store';
import { retiredComparisonFieldsKey } from '../server/research-migration';
import { CompanyResearch } from '../server/company-research';

it('backs up and removes only retired company facts and copies, preserves job salary/location and runs once', () => {
  const dir = mkdtempSync(join(tmpdir(), 'retired-company-fields-'));
  const path = join(dir, 'fixture.sqlite');
  let store = new Store(path);
  try {
    const company = store.saveCompany({
      name: 'Preserved company',
      notes: 'CRM notes',
      location: 'Madrid',
    });
    store.addJob({
      company: company.name,
      title: 'Senior Data Analyst',
      location: 'Barcelona',
      salaryMin: 65000,
      currency: 'EUR',
      stage: 'applied',
      notes: 'Job notes',
    });
    const before = store.state();
    const stamp = new Date().toISOString();
    const observations = ['A02', 'A06', 'T01'].map((criterion_id) => ({
      criterion_id,
      value:
        criterion_id === 'A02'
          ? ['ES']
          : criterion_id === 'A06'
            ? {
                min: 60000,
                max: 80000,
                currency: 'EUR',
                period: 'year',
                component: 'base',
                basis: 'published',
              }
            : ['BigQuery'],
      scope: {},
      confidence: 'high',
      reasoning: 'Fixture',
      evidence: [
        {
          url: 'https://example.test/policy',
          title: 'Policy',
          source_type: 'official',
          observed_at: stamp,
          excerpt: 'Fixture statement',
        },
      ],
    }));
    for (const o of observations) {
      store.db
        .prepare('INSERT INTO company_research_observations VALUES (?,?,?,?,?,?)')
        .run(o.criterion_id, company.id, 'old-run', o.criterion_id, JSON.stringify(o), stamp);
      store.db
        .prepare('INSERT INTO company_research_reviews VALUES (?,?,?,?)')
        .run('review-' + o.criterion_id, o.criterion_id, JSON.stringify({ verified: true }), stamp);
    }
    const doc = {
      schema_version: '1.0',
      generated_at: stamp,
      research_mode: 'external_research',
      companies: [
        {
          identity: { name: company.name, company_id: company.id },
          observations,
          job_urls: [],
          red_flags: [],
          notes: 'Keep run notes',
        },
      ],
    };
    store.db
      .prepare('INSERT INTO company_research_runs VALUES (?,?,?,?)')
      .run(
        'old-run',
        'original-import-digest',
        JSON.stringify({ companies: [{ companyId: company.id }], document: doc }),
        stamp,
      );
    store.db
      .prepare('INSERT INTO company_research_previews VALUES (?,?,?,?,?)')
      .run('old-preview', 'old-hash', 'old-state', JSON.stringify(doc), Date.now() + 60000);
    store.db
      .prepare('INSERT INTO company_research_scores VALUES (?,?)')
      .run(company.id, JSON.stringify({ oldCriteria: observations }));
    store.db.prepare('DELETE FROM settings WHERE key=?').run(retiredComparisonFieldsKey);
    store.db.close();
    store = new Store(path);
    expect(store.state()).toEqual(before);
    expect(
      store.db
        .prepare('SELECT id FROM company_research_observations')
        .all()
        .map((r) => r.id),
    ).toEqual(['T01']);
    expect(
      store.db
        .prepare('SELECT observation_id FROM company_research_reviews')
        .all()
        .map((r) => r.observation_id),
    ).toEqual(['T01']);
    expect(store.db.prepare('SELECT count(*) AS n FROM company_research_previews').get()?.n).toBe(
      0,
    );
    expect(store.db.prepare('SELECT count(*) AS n FROM company_research_scores').get()?.n).toBe(0);
    const run = store.db.prepare('SELECT digest,data FROM company_research_runs').get()!;
    expect(run.digest).toBe('original-import-digest');
    const history = JSON.parse(String(run.data));
    expect(
      history.document.companies[0].observations.map(
        (o: { criterion_id: string }) => o.criterion_id,
      ),
    ).toEqual(['T01']);
    expect(history.document.companies[0].notes).toBe('Keep run notes');
    expect(history.removedCriteria).toEqual(['A02', 'A06']);
    const backups = join(dir, 'backups/company-research');
    const snapshot = readdirSync(backups).find((f) => f.endsWith('.sqlite'))!;
    const backup = new DatabaseSync(join(backups, snapshot), { readOnly: true });
    try {
      expect(backup.prepare('PRAGMA integrity_check').get()?.integrity_check).toBe('ok');
      expect(
        backup.prepare('SELECT count(*) AS n FROM company_research_observations').get()?.n,
      ).toBe(3);
    } finally {
      backup.close();
    }
    const profile = new CompanyResearch(store).profile(company.id);
    expect(profile).not.toHaveProperty('countries');
    expect(profile.criteria.some((c) => ['A02', 'A06'].includes(c.criterion.id))).toBe(false);
    expect(profile.scores.T.pass).toBe(1);
    expect(profile.jobs[0].salaryMin).toBe(65000);
    expect(profile.jobs[0].location).toBe('Barcelona');
    store.db.close();
    store = new Store(path);
    expect(readdirSync(backups).filter((f) => f.endsWith('.sqlite'))).toHaveLength(1);
    expect(store.db.prepare('SELECT count(*) AS n FROM company_research_scores').get()?.n).toBe(1);
  } finally {
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
