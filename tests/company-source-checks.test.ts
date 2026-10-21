import { describe, it, expect } from 'vitest';
import { companySourceChecks } from '../shared/company-source-checks';
import { sourceSchema, type Source } from '../shared/model';
import type { SourceRun } from '../shared/source-tools';
import { Store } from '../server/store';
import { CompanyResearch } from '../server/company-research';
import { comparisonScoreMatches } from '../src/company-comparison';

const source = {
  ...sourceSchema.parse({ name: 'Company board', provider: 'lever', board: 'fixture' }),
  id: 'board',
  companyId: 'co',
} as Source;
const run = (overrides: Partial<SourceRun> = {}): SourceRun => ({
  id: 'run',
  at: '2026-10-21T10:00:00Z',
  provider: 'lever',
  sourceId: 'board',
  kind: 'monitor',
  query: '',
  received: 10,
  matched: 2,
  added: 2,
  cached: false,
  error: '',
  requests: 1,
  ...overrides,
});
describe('Company source checks', () => {
  it('shows zero results without requiring a saved job; excludes unrelated and global feed runs', () => {
    const checks = companySourceChecks(
      'co',
      [source],
      [
        run({ received: 0, matched: 0 }),
        run({ sourceId: 'discovery:jobicy' }),
        run({ sourceId: 'other', companyId: 'elsewhere' }),
      ],
      [],
    );
    expect(checks).toHaveLength(1);
    expect(checks[0].result).toContain('Получено 0');
    expect(checks[0].error).toBe(false);
  });
  it('keeps the latest error instead of hiding it behind an older success', () => {
    const checks = companySourceChecks(
      'co',
      [source],
      [run(), run({ at: '2026-10-21T11:00:00Z', error: 'HTTP 503' })],
      [],
    );
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ error: true, result: 'Ошибка: HTTP 503' });
  });
  it('retains explicit company attribution after a source was removed, and labels cached counts', () => {
    expect(
      companySourceChecks(
        'co',
        [],
        [run({ companyId: 'co', sourceName: 'Original board', cached: true })],
        [],
      )[0].result,
    ).toContain('из кэша');
    expect(
      companySourceChecks('co', [], [run({ companyId: 'co', sourceName: 'Original board' })], [])[0]
        .name,
    ).toContain('Original board');
  });
  it('includes manual API/web checks with zero and errors, not research-only blog pages', () => {
    const check = {
      name: 'Official API',
      kind: 'api' as const,
      observed_at: '2026-10-21',
      description: 'Целевых ролей нет',
      columns: ['target_vacancies' as const],
      outcome: 'empty' as const,
    };
    const checks = companySourceChecks(
      'co',
      [],
      [],
      [
        check,
        { ...check, name: 'Careers', kind: 'web_page', outcome: 'error', description: 'HTTP 502' },
        { ...check, name: 'Blog', columns: ['analytics_culture'] },
      ],
    );
    expect(checks).toHaveLength(2);
    expect(checks.find((c) => c.name === 'Official API')?.result).toContain('0 результатов');
    expect(checks.find((c) => c.name === 'Careers')?.error).toBe(true);
  });
  it('returns old company attempts after more than 100 unrelated runs, through the profile API model', () => {
    const store = new Store(':memory:');
    try {
      const company = store.saveCompany({ name: 'Company' });
      store.put('sources', { ...source, companyId: company.id });
      const { id: _id, at: _at, ...attempt } = run({ received: 0, matched: 0 });
      store.recordRun(attempt);
      for (let i = 0; i < 105; i++) store.recordRun({ ...attempt, sourceId: 'unrelated' });
      expect(store.runs().some((r) => r.sourceId === source.id)).toBe(false);
      const profile = new CompanyResearch(store).profile(company.id);
      expect(profile.targetVacancies.checkedSources).toHaveLength(1);
      expect(profile.targetVacancies.checkedSources[0].result).toContain('Получено 0');
      expect(profile.targetVacancies.total).toBe(0);
    } finally {
      store.db.close();
    }
  });
});
describe('Minimum relevance score', () => {
  it('uses the displayed score strictly above the boundary and excludes unknowns only when active', () => {
    expect(comparisonScoreMatches(80, '80')).toBe(false);
    expect(comparisonScoreMatches(81, '80')).toBe(true);
    expect(comparisonScoreMatches(null, '0')).toBe(false);
    expect(comparisonScoreMatches(0, '')).toBe(true);
    expect(comparisonScoreMatches(null, '')).toBe(true);
  });
});
