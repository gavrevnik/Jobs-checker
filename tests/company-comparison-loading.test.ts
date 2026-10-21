import { afterEach, describe, expect, it, vi } from 'vitest';
import { Store } from '../server/store';
import { CompanyResearch } from '../server/company-research';
import * as scoring from '../shared/company-research';

const stores: Store[] = [];
const setup = () => {
  const store = new Store(':memory:');
  stores.push(store);
  return { store, research: new CompanyResearch(store) };
};
const observation = (criterion_id: string, value: unknown, scope = {}) => ({
  criterion_id,
  value,
  scope,
  confidence: 'high',
  reasoning: 'Fixture reasoning',
  evidence: [
    {
      url: 'https://example.test/policy',
      title: 'Policy',
      source_type: 'official',
      observed_at: new Date().toISOString(),
      excerpt: 'Verified fixture statement',
    },
  ],
});
afterEach(() => {
  stores.splice(0).forEach((s) => s.db.close());
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('Comparison loading and stored scoring', () => {
  it('reads shared jobs, sources, observations and history once for the whole list', () => {
    const { store, research } = setup();
    for (const name of ['Alpha', 'Beta', 'Gamma']) store.saveCompany({ name });
    const list = vi.spyOn(store, 'list');
    const observations = vi.spyOn(store, 'observations');
    const history = vi.spyOn(research, 'history');
    expect(research.list().companies).toHaveLength(3);
    for (const table of ['companies', 'jobs', 'sources'])
      expect(list.mock.calls.filter(([name]) => name === table)).toHaveLength(1);
    expect(observations).toHaveBeenCalledTimes(1);
    expect(history).toHaveBeenCalledTimes(1);
  });

  it('reuses persisted scores across country/profile reads and instances until evidence changes or explicit recalculation', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-10T12:00:00Z'));
    const { store, research } = setup();
    const company = store.saveCompany({ name: 'Fixture' });
    const added = research.manual(company.id, observation('A04', true));
    research.review(added.observations[0].id, { verified: true });
    const before = research.profile(company.id);
    expect(before.scores.A.pass).toBe(1);
    const summarize = vi.spyOn(scoring, 'summarize');
    vi.setSystemTime(new Date('2028-01-10T12:00:00Z'));
    const reloaded = new CompanyResearch(store);
    const profile = store.list<{ id: string }>('profiles')[0];
    for (const country of ['', 'ES', 'DE', 'FR']) {
      const result = reloaded.list(country, profile.id).companies[0];
      expect(result.scores.A.pass).toBe(1);
      expect(result.scoresCalculatedAt).toBe(before.scoresCalculatedAt);
    }
    reloaded.preferences(company.id, { priority: 'Target', notes: 'Personal note' });
    store.importData({
      jobs: [
        {
          company: company.name,
          title: 'Senior Data Analyst',
          seniority: 'senior',
          location: 'Barcelona',
          lastSeenAt: new Date().toISOString(),
        },
      ],
    });
    expect(reloaded.profile(company.id).targetVacancies.open).toBe(1);
    expect(summarize).not.toHaveBeenCalled();

    reloaded.recalculateScores([company.id]);
    expect(summarize).toHaveBeenCalled();
    const after = reloaded.profile(company.id);
    expect(after.scores.A.pass).toBe(0);
    expect(after.scoresCalculatedAt).toBe('2028-01-10T12:00:00.000Z');
    summarize.mockClear();
    const fresh = reloaded.manual(company.id, observation('T01', ['BigQuery']));
    reloaded.review(fresh.observations[0].id, { verified: true });
    expect(reloaded.profile(company.id).scores.T.pass).toBe(1);
    expect(summarize).toHaveBeenCalled();
  });

  it('keeps country-specific scoring identical to the existing scope rules without calculating on country selection', () => {
    const { store, research } = setup();
    const company = store.saveCompany({ name: 'Scoped fixture' });
    for (const input of [
      observation('A04', true, { country: 'ES' }),
      observation('A04', false, { country: 'DE' }),
      observation('A02_OFFICES', ['ES', 'FR']),
      observation('A05', { modes: ['hybrid'], eligible_countries: ['DE'] }),
      observation('T01', ['BigQuery']),
      observation('A02_HQ', ['US']),
    ]) {
      const added = research.manual(company.id, input);
      research.review(added.observations[0].id, { verified: true });
    }
    const observations = research.profile(company.id).observations;
    for (const country of ['', 'ES', 'DE', 'FR', 'IT', 'US']) {
      const expected = scoring.summarize(observations, country);
      const spy = vi.spyOn(scoring, 'summarize');
      const actual = research.profile(company.id, country);
      expect(actual.scores).toEqual(expected.scores);
      expect(actual.criteria).toEqual(expected.criteria);
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });

  it('validates all company IDs before replacing snapshots and refreshes only selected companies', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-10T12:00:00Z'));
    const { store, research } = setup();
    const first = store.saveCompany({ name: 'First' });
    const second = store.saveCompany({ name: 'Second' });
    const before = research.list().companies;
    vi.setSystemTime(new Date('2026-01-11T12:00:00Z'));
    expect(() => research.recalculateScores([first.id, 'missing'])).toThrow('Компания не найдена');
    expect(research.list().companies.map((c) => c.scoresCalculatedAt)).toEqual(
      before.map((c) => c.scoresCalculatedAt),
    );
    research.recalculateScores([first.id]);
    expect(research.profile(first.id).scoresCalculatedAt).toBe('2026-01-11T12:00:00.000Z');
    expect(research.profile(second.id).scoresCalculatedAt).toBe('2026-01-10T12:00:00.000Z');
  });
});
