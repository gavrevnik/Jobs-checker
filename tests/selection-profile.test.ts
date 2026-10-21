import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store';
import { CompanyResearch } from '../server/company-research';
import { coreSchema, dimensionIds, scenarioSchema } from '../shared/selection-profile';
import { acceptsJob, searchSchema } from '../shared/source-tools';
import { jobSchema, type Profile } from '../shared/model';
import { companyFit, fitAssessmentSchema, validateFitEvidence } from '../shared/company-fit';
import { cultureAssessmentSchema, validateCultureEvidence } from '../shared/company-culture-fit';
import { targetLevel } from '../shared/target-vacancies';

const stores: Store[] = [];
afterEach(() => stores.splice(0).forEach((s) => s.db.close()));
function setup() {
  const s = new Store(':memory:');
  stores.push(s);
  return s;
}
function configure(s: Store) {
  const old = s.selection.read();
  return s.selection.save({
    expectedVersion: old.version,
    core: coreSchema.parse({
      name: 'Senior Product Analyst',
      seniority: 'middle_plus',
      keywords: ['SQL', 'product analyst'],
      roleFamilies: ['product_analytics', 'data_analytics', 'decision_science', 'analytics_lead'],
    }),
    scenarios: [
      scenarioSchema.parse({
        id: 'es',
        name: 'Испания',
        locations: ['Spain'],
        sponsorship: 'required',
      }),
      scenarioSchema.parse({ id: 'fr', name: 'Франция', locations: ['France'] }),
    ],
    activeScenarioId: '',
  });
}
function fact(
  s: Store,
  criterion_id: string,
  value: unknown,
  scope = {},
  source_type = 'official',
) {
  const research = new CompanyResearch(s),
    company = s.saveCompany({ name: 'Fixture' });
  const result = research.manual(company.id, {
    criterion_id,
    value,
    scope: source_type === 'job' ? { ...scope, job_url: 'https://example.test/source' } : scope,
    confidence: 'high',
    reasoning: 'Конкретный пример в источнике',
    evidence: [
      {
        url: 'https://example.test/source',
        title: 'Источник',
        source_type,
        observed_at: new Date().toISOString(),
        excerpt: 'A concrete description of the practice.',
      },
    ],
  });
  research.review(result.observations[0].id, { verified: true });
  return {
    research,
    company,
    observation: research.observations(company.id).find((o) => o.id === result.observations[0].id)!,
  };
}
describe('Professional core and scenarios', () => {
  it('backs up an existing database and preserves original profiles, source IDs, jobs and research history', () => {
    const dir = mkdtempSync(join(tmpdir(), 'selection-migration-')),
      path = join(dir, 'old.sqlite');
    let s = new Store(path);
    try {
      s.db.prepare('UPDATE profiles SET data=?').run(
        JSON.stringify({
          id: s.list<Profile>('profiles')[0].id,
          name: 'Old profile without notes',
          keywords: [],
          exclude: [],
          locations: [],
          workMode: 'any',
          seniority: 'any',
          minSalary: null,
          currency: 'EUR',
          salaryPeriod: 'year',
        }),
      );
      const profile = s.saveProfile({
        name: 'Испания · Senior Product Analyst',
        locations: ['Spain'],
        seniority: 'middle_plus',
        keywords: ['SQL'],
        notes: 'Candidate experience',
      });
      const board = s.saveSource({
        provider: 'ashby',
        name: 'Fixture board',
        board: 'fixture',
        profileId: profile.id,
        monitoring: true,
      });
      const job = s.addJob({
        company: 'Fixture',
        title: 'Senior Product Analyst',
        notes: 'Do not lose',
        stage: 'interview',
      }).job;
      const { research, company } = fact(s, 'AN01', true);
      const original = {
        profiles: s.list('profiles'),
        sources: s.list('sources'),
        jobs: s.list('jobs'),
        history: research.history(),
        observations: research.observations(company.id),
      };
      // Synthetic pre-migration file. Never use the user's database in this test.
      s.db.exec('DROP TABLE selection_profile_versions');
      s.db.close();
      s = new Store(path);
      expect(s.list('profiles')).toEqual(original.profiles);
      expect(s.list('sources')).toEqual(original.sources);
      expect(s.list('jobs')).toEqual(original.jobs);
      expect(new CompanyResearch(s).history()).toEqual(original.history);
      expect(new CompanyResearch(s).observations(company.id)).toEqual(original.observations);
      expect(s.selection.profile(profile.id).locations).toEqual(['Spain']);
      expect(s.get('sources', board.id)).toBeTruthy();
      expect(s.get('jobs', job.id)).toBeTruthy();
      expect(readdirSync(join(dir, 'backups/company-selection')).length).toBeGreaterThan(0);
      const before = readdirSync(join(dir, 'backups/company-selection'));
      s.db.close();
      s = new Store(path);
      expect(readdirSync(join(dir, 'backups/company-selection'))).toEqual(before);
    } finally {
      s.db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('keeps quality version stable when only the scenario changes and rejects stale overwrites/removal', () => {
    const s = setup(),
      first = configure(s);
    const next = s.selection.save({
      expectedVersion: first.version,
      core: first.core,
      scenarios: first.scenarios,
      activeScenarioId: 'es',
    });
    expect(next.coreVersion).toBe(first.coreVersion);
    expect(next.version).toBe(first.version + 1);
    expect(() =>
      s.selection.save({
        expectedVersion: first.version,
        core: first.core,
        scenarios: first.scenarios,
        activeScenarioId: 'fr',
      }),
    ).toThrow('уже изменён');
    expect(() =>
      s.selection.save({
        expectedVersion: next.version,
        core: next.core,
        scenarios: [],
        activeScenarioId: '',
      }),
    ).toThrow('Выключите');
    const changed = s.selection.save({
      expectedVersion: next.version,
      core: { ...next.core, notes: 'Strong peers' },
      scenarios: next.scenarios,
      activeScenarioId: 'es',
    });
    expect(changed.coreVersion).toBe(first.coreVersion + 1);
    expect(s.selection.history()).toHaveLength(4);
  });
  it('uses the same roles across search and comparison, normalizes cities and keeps unknown grades for review', () => {
    const s = setup();
    configure(s);
    const p = s.selection.profile('fr');
    for (const title of [
      'Principal Data Analyst',
      'Product Analytics Chapter Lead',
      'Senior Data Scientist — Insights',
      'Decision Scientist',
      'Senior Product Analyst',
    ]) {
      const job = jobSchema.parse({
        title,
        company: 'Fixture',
        location: 'Paris',
        description: 'SQL',
      });
      expect(acceptsJob(job, searchSchema.parse({}), p), title).toBe(true);
      expect(targetLevel(job, p), title).not.toBeNull();
    }
    expect(targetLevel(jobSchema.parse({ title: 'Product Analyst', company: 'Fixture' }), p)).toBe(
      'review',
    );
    expect(
      acceptsJob(
        jobSchema.parse({
          title: 'Senior Data Engineer',
          company: 'Fixture',
          location: 'Paris',
          description: 'SQL',
        }),
        searchSchema.parse({}),
        p,
      ),
    ).toBe(false);
    expect(
      acceptsJob(
        jobSchema.parse({
          title: 'Senior Product Analyst',
          company: 'Fixture',
          location: 'Berlin',
        }),
        searchSchema.parse({}),
        p,
      ),
    ).toBe(false);
    expect(
      acceptsJob(
        jobSchema.parse({
          title: 'Senior Product Analyst',
          company: 'Fixture',
          location: 'Remote',
        }),
        searchSchema.parse({}),
        p,
      ),
    ).toBe(true);
  });
});
describe('Evidence-backed company quality', () => {
  it('does not convert unknown, a warehouse name or public expertise into a maturity score', () => {
    const s = setup(),
      config = configure(s);
    const { research, company } = fact(s, 'T01', ['Snowflake']);
    fact(s, 'AN08', true);
    let result = companyFit(research.observations(company.id), config);
    expect(result.score).toBeNull();
    expect(result.coverage).toBe(0);
    fact(s, 'AN04', true, {}, 'job');
    result = companyFit(research.observations(company.id), config);
    expect(result.score).toBe(50);
    expect(result.coverage).toBe(25);
    expect(result.range).toEqual([13, 88]);
    expect(result.suggestedQueue).toBe('Research');
    expect(result.components.find((d) => d.id === 'experimentation')?.basis).toBe(
      'role_requirement',
    );
  });
  it('validates source membership, scope and the job-only cap; appends assessments and invalidates revoked evidence', () => {
    const s = setup(),
      config = configure(s);
    const { research, company, observation } = fact(s, 'AN04', true, {}, 'job');
    const input = {
      profileVersion: config.coreVersion,
      scope: observation.scope,
      business: { text: '', evidenceIds: [] },
      analytics: {
        text: 'В роли заявлены эксперименты; процесс review нужно уточнить.',
        evidenceIds: [observation.id],
      },
      dimensions: dimensionIds.map((id) => ({
        id,
        rating: id === 'experimentation' ? 2 : null,
        reason: 'Изучить команду',
        evidenceIds: id === 'experimentation' ? [observation.id] : [],
        basis: id === 'experimentation' ? 'role_requirement' : 'unknown',
      })),
      strengths: [],
      gaps: ['Неизвестны коллеги'],
      nextStep: 'Обсудить review экспериментов',
    };
    const valid = fitAssessmentSchema.parse(input);
    research.assess(company.id, valid);
    expect(research.profile(company.id).fit.score).toBe(50);
    expect(research.assessmentHistory(company.id)).toHaveLength(1);
    expect(() =>
      research.assess(company.id, {
        ...valid,
        dimensions: valid.dimensions.map((d) =>
          d.id === 'experimentation' ? { ...d, rating: 4, basis: 'practice' } : d,
        ),
      }),
    ).toThrow('Одни вакансии');
    expect(() =>
      research.assess(company.id, {
        ...valid,
        business: { text: 'Unsupported', evidenceIds: ['foreign'] },
      }),
    ).toThrow('Основание');
    const scoped = { ...observation, scope: { country: 'ES' } };
    expect(() => validateFitEvidence(valid, [scoped])).toThrow('разным');
    research.review(observation.id, { verified: false, rejected: true });
    expect(research.profile(company.id).fit).toMatchObject({
      outdated: true,
      score: null,
      previousScore: 50,
    });
    expect(research.assessmentHistory(company.id)).toHaveLength(1);
  });
  it('keeps user queues and practice goals separate from generated recommendations and CRM', () => {
    const s = setup(),
      { research, company } = fact(s, 'AN01', true);
    const before = s.get('companies', company.id);
    research.preferences(company.id, {
      priority: 'Practice',
      notes: 'Keep',
      practiceGoal: 'Product sense in English',
      practiceHours: 3,
    });
    research.preferences(company.id, { priority: 'Target', notes: 'Keep' });
    expect(research.profile(company.id).preferences).toMatchObject({
      priority: 'Target',
      practiceGoal: 'Product sense in English',
      practiceHours: 3,
    });
    expect(s.get('companies', company.id)).toEqual(before);
    expect(s.db.prepare('SELECT count(*) n FROM company_queue_history').get()?.n).toBe(2);
  });
  it('recommends Target only with strong peers and methods, and retires a score on conflicting evidence', () => {
    const s = setup(),
      config = configure(s);
    const influence = fact(s, 'AN01', true);
    const methods = fact(s, 'AN04', true);
    const peers = fact(s, 'AN03', 'Есть регулярное взаимное review с опытными аналитиками.');
    const refs = {
      influence: influence.observation.id,
      experimentation: methods.observation.id,
      peers: peers.observation.id,
    };
    const input = fitAssessmentSchema.parse({
      profileVersion: config.coreVersion,
      scope: {},
      business: { text: '', evidenceIds: [] },
      analytics: { text: '', evidenceIds: [] },
      dimensions: dimensionIds.map((id) => ({
        id,
        rating: id in refs ? 4 : null,
        reason: id in refs ? 'Проверенный процесс с обратной связью' : 'Не исследовано',
        evidenceIds: id in refs ? [refs[id as keyof typeof refs]] : [],
        basis: id in refs ? 'practice' : 'unknown',
      })),
      strengths: [],
      gaps: [],
      nextStep: 'Проверить конкретную вакансию',
    });
    influence.research.assess(influence.company.id, input);
    expect(influence.research.profile(influence.company.id).fit).toMatchObject({
      score: 100,
      coverage: 75,
      suggestedQueue: 'Target',
      provisional: false,
    });
    fact(s, 'AN04', false);
    expect(influence.research.profile(influence.company.id).fit).toMatchObject({
      score: null,
      outdated: true,
      suggestedQueue: 'Research',
    });
    expect(() => influence.research.assess(influence.company.id, input)).toThrow('противоречие');
  });
  it('keeps team evidence scoped when validating and loading a culture assessment', () => {
    const s = setup(),
      config = configure(s);
    const { research, company, observation } = fact(s, 'AN04', true, {
      context: 'Growth',
      country: 'ES',
    });
    const layer = {
      summary: { text: '', evidenceIds: [] },
      dimensions: dimensionIds.map((id) => ({
        id,
        rating: id === 'experimentation' ? 2 : null,
        reason: 'Описание практики',
        evidenceIds: id === 'experimentation' ? [observation.id] : [],
        basis: id === 'experimentation' ? 'practice' : 'unknown',
      })),
      strengths: [],
      gaps: [],
      nextStep: 'Уточнить команду',
    };
    const input = cultureAssessmentSchema.parse({
      kind: 'culture_team',
      methodologyVersion: 2,
      profileVersion: config.coreVersion,
      business: { text: '', evidenceIds: [] },
      company: layer,
      teams: [{ ...layer, id: 'growth', name: 'Growth', scope: observation.scope }],
    });
    const result = research.assessCulture(company.id, input);
    expect(result.fit).toMatchObject({
      score: 50,
      scope: { context: 'Компания · подтверждённая экспертиза' },
      culture: { teams: [{ id: 'growth', score: 50, scope: observation.scope }] },
    });
    expect(() =>
      validateCultureEvidence(input, [{ ...observation, scope: { context: 'Payments' } }]),
    ).toThrow('другой команде');
    expect(() => validateCultureEvidence(input, [{ ...observation, scope: {} }])).toThrow(
      'прямого свидетельства',
    );
  });
  it.each(['legacy', 'culture'] as const)(
    'preserves the previous numeric result after changing profile weights (%s)',
    (format) => {
      const s = setup(),
        config = configure(s);
      const influence = fact(s, 'AN01', true),
        methods = fact(s, 'AN04', true);
      const input = {
        profileVersion: config.coreVersion,
        scope: {},
        business: { text: '', evidenceIds: [] },
        analytics: { text: '', evidenceIds: [] },
        dimensions: dimensionIds.map((id) => ({
          id,
          rating: id === 'influence' ? 4 : id === 'experimentation' ? 2 : null,
          evidenceIds:
            id === 'influence'
              ? [influence.observation.id]
              : id === 'experimentation'
                ? [methods.observation.id]
                : [],
          reason: 'Описание основания',
          basis: ['influence', 'experimentation'].includes(id) ? 'practice' : 'unknown',
        })),
        strengths: [],
        gaps: [],
        nextStep: 'Уточнить команду',
      };
      if (format === 'culture') {
        const { scope: _scope, analytics, business, profileVersion, ...layer } = input;
        influence.research.assessCulture(influence.company.id, {
          kind: 'culture_team',
          methodologyVersion: 2,
          profileVersion,
          business,
          company: { ...layer, summary: analytics },
          teams: [],
        });
      } else {
        influence.research.assess(influence.company.id, input);
        // Older assessments omitted their weights; recover them from profile history.
        const old = influence.research.assessmentHistory(influence.company.id)[0];
        const { weights: _weights, ...legacy } = old;
        s.db
          .prepare('UPDATE company_fit_assessments SET data=? WHERE id=?')
          .run(JSON.stringify(legacy), old.id);
      }
      expect(influence.research.profile(influence.company.id).fit.score).toBe(75);
      s.selection.save({
        expectedVersion: config.version,
        core: {
          ...config.core,
          weights: { ...config.core.weights, influence: 40, experimentation: 10 },
        },
        scenarios: config.scenarios,
        activeScenarioId: '',
      });
      expect(influence.research.profile(influence.company.id).fit).toMatchObject({
        score: null,
        previousScore: 75,
        outdated: true,
      });
    },
  );
});
