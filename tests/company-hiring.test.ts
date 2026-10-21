import { expect, it } from 'vitest';
import { companySchema } from '../shared/model';
import { companyHiringLinks, companyHiringSchema } from '../shared/company-hiring';
import { Store } from '../server/store';

const base = {
  checkedAt: '2026-10-19T12:00:00Z',
  evidenceUrls: ['https://fixture.example/about'],
  evidence: 'Official website links to this company profile.',
  verificationMethod: 'official_site' as const,
};
const hiring = () =>
  companyHiringSchema.parse({
    checkedAt: base.checkedAt,
    careers: { ...base, url: 'https://fixture.example/careers', status: 'confirmed' },
    linkedin: {
      ...base,
      profileUrl: 'https://es.linkedin.com/company/fixture/jobs/?tracking=1',
      identityStatus: 'slug_only',
    },
  });

it('keeps old companies compatible and shows only confirmed identity links with a truthful LinkedIn fallback', () => {
  expect(companyHiringLinks(companySchema.parse({ name: 'Old' }))).toEqual([]);
  const data = hiring();
  expect(data.linkedin?.profileUrl).toBe('https://www.linkedin.com/company/fixture/');
  expect(companyHiringLinks({ hiringSources: data })).toEqual([
    { label: 'Careers', url: 'https://fixture.example/careers' },
    { label: 'LinkedIn Jobs', url: 'https://www.linkedin.com/company/fixture/jobs/' },
  ]);
  data.linkedin!.externalCompanyId = '12345';
  expect(companyHiringLinks({ hiringSources: data })[1].url).toBe(
    'https://www.linkedin.com/jobs/search/?f_C=12345',
  );
  data.linkedin!.identityStatus = 'needs_review';
  data.careers!.status = 'needs_review';
  expect(companyHiringLinks({ hiringSources: data })).toEqual([]);
});

it('rejects unrelated LinkedIn URLs, executable Careers URLs and fabricated non-numeric company IDs', () => {
  const data = hiring();
  for (const profileUrl of [
    'https://linkedin.com.evil.example/company/fixture',
    'https://www.linkedin.com/in/person/',
    'https://www.linkedin.com/jobs/search/?f_C=12',
  ])
    expect(() =>
      companyHiringSchema.parse({ ...data, linkedin: { ...data.linkedin, profileUrl } }),
    ).toThrow();
  expect(() =>
    companyHiringSchema.parse({
      ...data,
      careers: { ...data.careers, url: 'javascript:alert(1)' },
    }),
  ).toThrow();
  expect(() =>
    companyHiringSchema.parse({
      ...data,
      linkedin: { ...data.linkedin, externalCompanyId: 'fixture' },
    }),
  ).toThrow();
});

it('preserves hiring identity through edits and export/import, and prevents linking it to a second company', () => {
  const store = new Store(':memory:'),
    copy = new Store(':memory:');
  try {
    const company = store.saveCompany({
      name: 'Fixture',
      hiringSources: hiring(),
      notes: 'Personal note',
    });
    store.db
      .prepare("UPDATE companies SET data=json_set(data,'$.radarId',?) WHERE id=?")
      .run('company:fixture', company.id);
    store.saveCompany({ name: company.name, notes: company.notes }, company.id);
    expect(store.get<typeof company>('companies', company.id)?.hiringSources).toEqual(hiring());
    expect(store.get<typeof company & { radarId: string }>('companies', company.id)?.radarId).toBe(
      'company:fixture',
    );
    expect(() => store.saveCompany({ name: 'Wrong employer', hiringSources: hiring() })).toThrow(
      'LinkedIn-профиль',
    );
    const exportData = store.state();
    copy.importData(exportData);
    expect(copy.list<typeof company>('companies')[0]).toMatchObject({
      hiringSources: hiring(),
      notes: 'Personal note',
    });
    const other = hiring();
    other.linkedin!.profileUrl = 'https://www.linkedin.com/company/other/';
    other.linkedin!.externalCompanyId = '123';
    const existing = hiring();
    existing.linkedin!.externalCompanyId = '123';
    store.saveCompany({ ...company, hiringSources: existing }, company.id);
    expect(() => store.saveCompany({ name: 'Another', hiringSources: other })).toThrow(
      'LinkedIn-профиль',
    );
  } finally {
    store.db.close();
    copy.db.close();
  }
});
