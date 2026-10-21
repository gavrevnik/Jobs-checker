import { expect, it } from 'vitest';
import { Store } from '../server/store';
import { CompanyResearch } from '../server/company-research';
import { legacyCompanyResearch } from '../shared/legacy-company-research';

it('migrates linked legacy facts additively, preserves provenance and CRM, and is idempotent', () => {
  const store = new Store(':memory:');
  try {
    const company = store.saveCompany({
      name: 'Legacy fixture',
      website: 'https://legacy.example',
      location: 'Barcelona',
      description: 'Saved description',
      checkedAt: '2020-01-01',
      size: '1,000 employees',
      dataDrivenScore: 9,
      dataDrivenEvidence: 'Old assessment',
      notes: 'Keep private notes',
      status: 'contacted',
      workModes: ['remote'],
    });
    const blank = store.saveCompany({ name: 'Empty fixture' });
    store.addJob({
      company: company.name,
      title: 'Product Analyst',
      url: 'https://legacy.example/jobs/1',
      workMode: 'remote',
      salaryMin: 5000,
      currency: 'EUR',
      salaryPeriod: 'month',
      stage: 'applied',
      notes: 'Keep job notes',
    });
    const before = store.state();
    const doc = legacyCompanyResearch(before.companies, before.jobs, '2026-10-14T12:00:00Z');
    const research = new CompanyResearch(store);
    const migrated = doc.companies.find((c) => c.identity.company_id === company.id)!;
    expect(migrated.observations.some((o) => o.criterion_id === 'B02')).toBe(false);
    expect(migrated.notes).toContain('1,000 employees');
    const preview = research.preview(doc);
    expect(preview.summary.existingCompanies).toBe(2);
    const result = research.apply({ previewId: preview.previewId, confirmed: true });
    expect(result.companies.map((c: { companyId: string }) => c.companyId).sort()).toEqual(
      [company.id, blank.id].sort(),
    );
    const profile = research.profile(company.id);
    expect(profile.confirmed).toHaveLength(0);
    expect(profile.headquarters.countries).toEqual([]);
    expect(profile.scores.A.pass).toBe(0);
    expect(profile.observations.every((o) => o.verifiedAt === null)).toBe(true);
    expect(
      profile.observations.find((o) => o.criterion_id === 'B04')!.evidence[0].observed_at,
    ).toBe('2020-01-01');
    expect(profile.observations.some((o) => ['A02', 'A06'].includes(o.criterion_id))).toBe(false);
    expect(store.state().companies).toEqual(before.companies);
    expect(store.state().jobs).toEqual(before.jobs);
    expect(
      research.apply({ previewId: research.preview(doc).previewId, confirmed: true })
        .alreadyImported,
    ).toBe(true);
  } finally {
    store.db.close();
  }
});
