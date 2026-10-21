import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../server/store';
import { CompanyResearch } from '../server/company-research';
import { dimensionIds } from '../shared/selection-profile';
import {
  cultureAssessmentSchema,
  cultureEvidenceAge,
  scoreCultureLayer,
  validateCultureEvidence,
} from '../shared/company-culture-fit';

const stores: Store[] = [];
afterEach(() => stores.splice(0).forEach((s) => s.db.close()));
function fixture() {
  const s = new Store(':memory:');
  stores.push(s);
  const research = new CompanyResearch(s),
    company = s.saveCompany({ name: 'Culture fixture' });
  function fact(
    criterion_id: string,
    value: unknown,
    published_at = '2020-01-01T00:00:00Z',
    scope = { context: 'Growth' },
  ) {
    const result = research.manual(company.id, {
      criterion_id,
      value,
      scope,
      confidence: 'high',
      reasoning: 'Published practice',
      evidence: [
        {
          url: 'https://example.test/' + criterion_id,
          title: 'Case study',
          source_type: 'engineering',
          observed_at: '2026-10-21T00:00:00Z',
          ...(published_at ? { published_at } : {}),
          excerpt: 'Evidence of a specific practice',
        },
      ],
    });
    const o = result.observations[0];
    research.review(o.id, { verified: true });
    return research.observations(company.id).find((x) => x.id === o.id)!;
  }
  const methods = fact('AN04', true),
    influence = fact('AN01', true);
  const layer = {
    summary: { text: 'Historical practice', evidenceIds: [methods.id] },
    dimensions: dimensionIds.map((id) => ({
      id,
      rating: id === 'experimentation' ? 4 : id === 'influence' ? 2 : null,
      reason: 'Explicit practice',
      evidenceIds:
        id === 'experimentation' ? [methods.id] : id === 'influence' ? [influence.id] : [],
      basis: ['experimentation', 'influence'].includes(id) ? 'historical' : 'unknown',
    })),
    strengths: [],
    gaps: ['Current peers unknown'],
    nextStep: 'Ask about review',
  };
  const input = cultureAssessmentSchema.parse({
    kind: 'culture_team',
    methodologyVersion: 2,
    profileVersion: s.selection.read().coreVersion,
    business: { text: '', evidenceIds: [] },
    company: layer,
    teams: [
      {
        ...layer,
        id: 'growth',
        name: 'Growth',
        scope: { context: 'Growth' },
        dimensions: layer.dimensions.map((d) =>
          d.id === 'experimentation' ? { ...d, rating: 2 } : d,
        ),
      },
    ],
  });
  return { s, research, company, methods, influence, input };
}
const now = Date.parse('2026-10-21T00:00:00Z');
describe('Independent culture research', () => {
  it('keeps failed research readable without inventing a score or evidence', () => {
    const { input, s } = fixture();
    const empty = {
      ...input.company,
      summary: { text: '', evidenceIds: [] },
      dimensions: input.company.dimensions.map((d) => ({
        ...d,
        rating: null,
        basis: 'unknown' as const,
        evidenceIds: [],
      })),
    };
    const result = scoreCultureLayer(empty, [], s.selection.read().core.weights, now);
    expect(result.score).toBeNull();
    expect(result.coverage).toBe(0);
    expect(result.confidence).toBe(0);
    expect(result.summary).toContain('Недостаточно проверенных данных');
    expect(result.gaps).toEqual(empty.gaps);
    expect(result.nextStep).toBe(empty.nextStep);
    expect(result.needsReview).toBe(false);
  });
  it('preserves historical expertise while confidence decays, faster for teams', () => {
    const { input, methods, influence, s } = fixture();
    const old = scoreCultureLayer(
      input.company,
      [methods, influence],
      s.selection.read().core.weights,
      now,
    );
    const later = scoreCultureLayer(
      input.company,
      [methods, influence],
      s.selection.read().core.weights,
      now + 365 * 86400000,
    );
    expect(old.score).toBe(75);
    expect(later.score).toBe(75);
    expect(later.confidence).toBeLessThan(old.confidence);
    expect(cultureEvidenceAge(methods, true, now).confidence).toBeLessThan(
      cultureEvidenceAge(methods, false, now).confidence,
    );
    expect(old.components.find((d) => d.id === 'peers')?.rating).toBeNull();
    expect(
      cultureEvidenceAge(
        {
          ...methods,
          evidence: methods.evidence.map((e) => ({
            ...e,
            observed_at: new Date(now).toISOString(),
          })),
        },
        false,
        now,
      ).confidence,
    ).toBeLessThan(30);
  });
  it('caps undated confidence and rejects historical ratings without publication dates', () => {
    const { input, methods, influence } = fixture();
    const undated = {
      ...methods,
      evidence: methods.evidence.map(({ published_at: _, ...e }) => e),
    };
    expect(cultureEvidenceAge(undated, false, now).confidence).toBe(55);
    expect(() => validateCultureEvidence(input, [undated, influence], now)).toThrow(
      'исходная дата',
    );
  });
  it('invalidates only the affected component on withdrawal or contradiction', () => {
    const { input, methods, influence, s } = fixture();
    const weights = s.selection.read().core.weights;
    for (const observations of [
      [{ ...methods, rejected: true }, influence],
      [methods, influence, { ...methods, id: 'conflict', value: false }],
    ]) {
      const fit = scoreCultureLayer(input.company, observations, weights, now);
      expect(fit.components.find((d) => d.id === 'experimentation')?.rating).toBeNull();
      expect(fit.components.find((d) => d.id === 'influence')?.rating).toBe(2);
      expect(fit.needsReview).toBe(true);
    }
  });
  it('rejects job evidence even when reviewed and does not accept another team', () => {
    const { input, methods, influence } = fixture();
    expect(() =>
      validateCultureEvidence(
        input,
        [
          {
            ...methods,
            evidence: methods.evidence.map((e) => ({ ...e, source_type: 'job' as const })),
          },
          influence,
        ],
        now,
      ),
    ).toThrow('вне вакансий');
    expect(() =>
      validateCultureEvidence(input, [{ ...methods, scope: { context: 'Risk' } }, influence], now),
    ).toThrow('другой команде');
  });
  it('does not let unrelated fresh facts raise a dimension confidence', () => {
    const { input, methods, influence } = fixture();
    input.company.dimensions
      .find((d) => d.id === 'experimentation')!
      .evidenceIds.push(influence.id);
    expect(() => validateCultureEvidence(input, [methods, influence], now)).toThrow('составляющей');
  });
  it('appends history, keeps company and team scores independent, and planning is read-only', () => {
    const { input, research, company, s } = fixture();
    const before = s.state();
    research.assessCulture(company.id, input);
    const first = research.assessmentHistory(company.id);
    const p = research.assessCulture(company.id, {
      ...input,
      company: { ...input.company, nextStep: 'Confirm present team' },
    });
    expect(p.fit.score).toBe(75);
    expect(p.fit.culture?.teams[0].score).toBe(50);
    expect(research.assessmentHistory(company.id)).toHaveLength(2);
    expect(research.assessmentHistory(company.id)[1]).toEqual(first[0]);
    const count = s.db.prepare('SELECT count(*) AS n FROM company_fit_assessments').get();
    expect(research.culturePlan(company.id).mode).toBe('culture_team');
    expect(s.db.prepare('SELECT count(*) AS n FROM company_fit_assessments').get()).toEqual(count);
    expect(s.state().jobs).toEqual(before.jobs);
  });
});
