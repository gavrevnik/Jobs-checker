import { expect, it } from 'vitest';
import { Store } from '../server/store';
import { CompanyResearch } from '../server/company-research';
import { companyInformationRows } from '../src/company-information-table';

it('renders a single business row and merges evidence despite different collection reasoning', () => {
  const s = new Store(':memory:');
  try {
    const company = s.saveCompany({ name: 'Facts', description: 'B2B subscription software.' });
    const research = new CompanyResearch(s);
    for (const slug of ['one', 'two'])
      research.manual(company.id, {
        criterion_id: 'B04',
        value: 'B2B subscription software.',
        scope: {},
        confidence: 'high',
        reasoning: `System audit ${slug}`,
        evidence: [
          {
            url: `https://example.test/${slug}`,
            title: slug,
            source_type: 'official',
            observed_at: '2026-10-20',
            excerpt: `Different collection excerpt ${slug}`,
          },
        ],
      });
    const rows = companyInformationRows(research.profile(company.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].facts).toEqual(['B2B subscription software.']);
    expect(rows[0].sources).toHaveLength(2);
    expect(JSON.stringify(rows)).not.toContain('System audit');
    expect(JSON.stringify(rows)).not.toContain('Different collection excerpt');
  } finally {
    s.db.close();
  }
});

it('keeps opposing scoped answers, historical dates and source qualifications', () => {
  const s = new Store(':memory:');
  try {
    const company = s.saveCompany({ name: 'Scoped' });
    const research = new CompanyResearch(s);
    for (const country of ['ES', 'GB'])
      research.manual(company.id, {
        criterion_id: 'A04',
        value: country === 'ES',
        scope: { country, role: 'Senior Analyst' },
        confidence: 'high',
        reasoning: country === 'ES' ? 'Sponsorship offered.' : 'No sponsorship.',
        evidence: [
          {
            url: `https://example.test/${country}`,
            title: country,
            source_type: 'job',
            observed_at: '2026-10-20',
            published_at: '2020-01-01',
            excerpt: 'Role conditions',
          },
        ],
      });
    const rows = companyInformationRows(research.profile(company.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].facts).toHaveLength(2);
    expect(rows[0].facts.some((f) => f.includes('Испания') && f.includes('Да.'))).toBe(true);
    expect(rows[0].facts.some((f) => f.includes('Великобритания') && f.includes('Нет.'))).toBe(
      true,
    );
    expect(rows[0].sources.every((s) => s.note.includes('2020-01-01'))).toBe(true);
  } finally {
    s.db.close();
  }
});

it('merges repeated country lists and leaves collection boilerplate out of facts', () => {
  const s = new Store(':memory:');
  try {
    const c = s.saveCompany({ name: 'Lists' });
    const research = new CompanyResearch(s);
    for (const reasoning of ['Source checked with API', 'Copied from previous research'])
      research.manual(c.id, {
        criterion_id: 'A02_HQ',
        value: ['ES'],
        confidence: 'high',
        scope: {},
        reasoning,
        evidence: [
          {
            url: 'https://example.test/hq',
            title: 'HQ',
            source_type: 'official',
            observed_at: '2026-10-20',
            excerpt: reasoning,
          },
        ],
      });
    const rows = companyInformationRows(research.profile(c.id));
    expect(rows[0].facts).toEqual(['Испания']);
    expect(rows[0].sources).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain('API');
  } finally {
    s.db.close();
  }
});

it('prefers the substantive business answer over a paraphrased card and retains work eligibility limits', () => {
  const s = new Store(':memory:');
  try {
    const c = s.saveCompany({
      name: 'Compact',
      description: 'Another paraphrase of our marketplace.',
    });
    const research = new CompanyResearch(s);
    const evidence = [
      {
        url: 'https://example.test/careers',
        title: 'Careers',
        source_type: 'official',
        observed_at: '2026-10-20',
        excerpt: 'Limited eligibility',
      },
    ];
    research.manual(c.id, {
      criterion_id: 'B04',
      value: 'Marketplace connecting guests and hosts.',
      confidence: 'high',
      scope: {},
      reasoning: 'Company description',
      evidence,
    });
    research.manual(c.id, {
      criterion_id: 'A05',
      value: { modes: ['remote'], eligible_countries: [] },
      confidence: 'high',
      scope: {},
      reasoning:
        'Удалённо только в странах, где разрешено оформление. Worldwide-допуск не подтверждён.',
      evidence,
    });
    const rows = companyInformationRows(research.profile(c.id));
    expect(rows.find((r) => r.label === 'Бизнес-модель')!.facts).toEqual([
      'Marketplace connecting guests and hosts.',
    ]);
    expect(rows.find((r) => r.label === 'Формат работы')!.facts[0]).toContain('только в странах');
    expect(rows.find((r) => r.label === 'Формат работы')!.facts[0]).toContain(
      'Worldwide-допуск не подтверждён',
    );
  } finally {
    s.db.close();
  }
});

it('does not collapse a percentage into an absolute number during deduplication', () => {
  const s = new Store(':memory:');
  try {
    const c = s.saveCompany({ name: 'Metrics' });
    const research = new CompanyResearch(s);
    for (const value of ['10% пользователей.', '10 пользователей.'])
      research.manual(c.id, {
        criterion_id: 'B06',
        value,
        confidence: 'high',
        scope: {},
        reasoning: 'Distinct metrics',
        evidence: [
          {
            url: 'https://example.test/metrics',
            title: 'Metrics',
            source_type: 'official',
            observed_at: '2026-10-20',
            excerpt: value,
          },
        ],
      });
    expect(companyInformationRows(research.profile(c.id))[0].facts).toHaveLength(2);
  } finally {
    s.db.close();
  }
});
