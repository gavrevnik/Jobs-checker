import { describe, expect, it } from 'vitest';
import { CompanyResearch } from '../server/company-research';
import { Store } from '../server/store';
import {
  comparisonHiringOffices,
  comparisonHiringOfficeMatches,
  comparisonHiringTags,
} from '../src/company-comparison';

describe('Comparison hiring filters', () => {
  it('uses open target jobs for formats and verified current facts for team languages', () => {
    const store = new Store(':memory:');
    try {
      const company = store.saveCompany({ name: 'Hiring tags' });
      const research = new CompanyResearch(store);
      const stamp = new Date().toISOString();
      store.importData({
        jobs: [
          {
            company: company.name,
            title: 'Senior Data Analyst',
            seniority: 'senior',
            url: 'https://example.test/open',
            workMode: 'hybrid',
            lastSeenAt: stamp,
          },
          {
            company: company.name,
            title: 'Senior Product Analyst',
            seniority: 'senior',
            url: 'https://example.test/closed',
            workMode: 'onsite',
            stage: 'archived',
            lastSeenAt: stamp,
          },
          {
            company: company.name,
            title: 'Senior Product Analyst',
            seniority: 'senior',
            url: 'https://example.test/stale',
            workMode: 'onsite',
            lastSeenAt: '2020-01-01T00:00:00Z',
          },
          {
            company: company.name,
            title: 'Senior Software Engineer',
            seniority: 'senior',
            url: 'https://example.test/other',
            workMode: 'onsite',
            lastSeenAt: stamp,
          },
        ],
      });
      const add = (
        criterion_id: string,
        value: unknown,
        scope = {},
        verified = true,
        date = stamp,
      ) => {
        const profile = research.manual(company.id, {
          criterion_id,
          value,
          scope,
          confidence: 'high',
          reasoning: 'Explicit job conditions',
          evidence: [
            {
              url: 'https://example.test/conditions',
              title: 'Conditions',
              source_type: 'official',
              observed_at: date,
              excerpt: 'Explicit work format and team language requirements.',
            },
          ],
        });
        if (verified) research.review(profile.observations[0].id, { verified: true });
      };
      add('A01', ['English', 'en', 'русский']);
      add('A01', ['es'], {}, false);
      add('A01', ['fr'], {}, true, '2020-01-01T00:00:00Z');
      add(
        'A05',
        { modes: ['remote'], eligible_countries: [] },
        { job_url: 'https://example.test/open/' },
      );
      add(
        'A05',
        { modes: ['onsite'], eligible_countries: [] },
        { job_url: 'https://example.test/closed' },
      );
      add('A05', { modes: ['onsite'], eligible_countries: ['FR'] }, { country: 'FR' });
      expect(comparisonHiringTags(research.profile(company.id))).toEqual({
        modes: ['hybrid', 'remote'],
        languages: ['ENG', 'RU'],
        benefits: [],
      });
      for (const job of store.list<{ id: string }>('jobs'))
        store.updateJob(job.id, { stage: 'archived' });
      expect(comparisonHiringTags(research.profile(company.id)).modes).toEqual([]);
    } finally {
      store.db.close();
    }
  });

  it('counts companies once per open city and excludes archived, stale and non-target jobs', () => {
    const store = new Store(':memory:');
    try {
      const first = store.saveCompany({ name: 'First' });
      const second = store.saveCompany({ name: 'Second' });
      const recent = new Date().toISOString();
      const add = (company: string, location: string, extra = {}) =>
        store.importData({
          jobs: [
            {
              company,
              title: 'Senior Product Analyst',
              seniority: 'senior',
              location,
              lastSeenAt: recent,
              ...extra,
            },
          ],
        });
      add('First', 'Barcelona', { url: 'https://example.test/one' });
      add('First', 'Barcelona', { url: 'https://example.test/two' });
      add('Second', 'Barcelona');
      add('Second', 'Berlin');
      add('First', 'Paris', { stage: 'archived' });
      add('First', 'Madrid', { lastSeenAt: '2020-01-01T00:00:00Z' });
      add('First', 'Lisbon', { title: 'Senior Software Engineer' });
      const research = new CompanyResearch(store);
      const profiles = [research.profile(first.id), research.profile(second.id)];
      const offices = comparisonHiringOffices(profiles);
      expect(offices.map((o) => [o.name, o.count])).toEqual([
        ['Barcelona', 2],
        ['Berlin', 1],
      ]);
      const berlin = offices.find((o) => o.name === 'Berlin')!.id;
      expect(comparisonHiringOfficeMatches(profiles[0], berlin)).toBe(false);
      expect(comparisonHiringOfficeMatches(profiles[1], berlin)).toBe(true);
      expect(comparisonHiringOfficeMatches(profiles[0], '')).toBe(true);
      const paris = profiles[0].targetVacancies.offices.find((o) => o.name === 'Paris')!.id;
      expect(comparisonHiringOfficeMatches(profiles[0], paris)).toBe(false);
      expect(comparisonHiringOffices(profiles.slice(0, 1)).map((o) => o.count)).toEqual([1]);
    } finally {
      store.db.close();
    }
  });
});
