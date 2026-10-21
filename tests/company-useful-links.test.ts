import { expect, it } from 'vitest';
import { Store } from '../server/store';
import { CompanyResearch } from '../server/company-research';
import { companyUsefulLinks, sourceUrl } from '../src/company-useful-links';

it('combines saved identities, every criterion, risks and historical jobs without fabricating employer profiles', () => {
  const s = new Store(':memory:');
  try {
    const company = s.saveCompany({
      name: 'Links',
      website: 'https://links.example/',
      sourceLinks: [
        { kind: 'blog', label: 'Технический блог', url: 'https://links.example/engineering/' },
        { kind: 'profile', label: 'Профиль Indeed', url: 'https://indeed.com/cmp/links' },
      ],
    });
    const research = new CompanyResearch(s);
    research.manual(company.id, {
      criterion_id: 'B08',
      value: ['SaaS'],
      confidence: 'high',
      scope: {},
      reasoning: 'Fixture',
      evidence: [
        {
          url: 'https://links.example/engineering/article?utm_source=mail',
          title: 'Read article',
          source_type: 'engineering',
          observed_at: '2026-10-20',
          excerpt: 'A used article outside AN/T criteria.',
        },
      ],
    });
    s.addJob({
      company: company.name,
      title: 'Senior Data Analyst',
      url: 'https://links.example/job',
      stage: 'archived',
    });
    const links = companyUsefulLinks(research.profile(company.id));
    const blog = links.find((l) => l.label === 'Технический блог')!;
    expect(blog.children.map((l) => l.url)).toEqual(['https://links.example/engineering/article']);
    expect(links.some((l) => l.url.includes('utm_source'))).toBe(false);
    expect(links.some((l) => l.url === 'https://indeed.com/cmp/links')).toBe(true);
    expect(links.some((l) => l.url === 'https://links.example/job')).toBe(true);
    expect(links.some((l) => l.url.includes('adzuna'))).toBe(false);
    s.saveCompany(
      { ...company, description: 'Edited normally', sourceLinks: undefined },
      company.id,
    );
    expect(s.get<any>('companies', company.id).sourceLinks).toEqual(company.sourceLinks);
    const backup = s.state();
    const copy = new Store(':memory:');
    try {
      copy.importData(backup);
      expect(copy.list<any>('companies')[0].sourceLinks).toEqual(company.sourceLinks);
    } finally {
      copy.db.close();
    }
  } finally {
    s.db.close();
  }
});

it('keeps an article whose parent was not saved and rejects unsafe links', () => {
  const s = new Store(':memory:');
  try {
    const company = s.saveCompany({
      name: 'Orphan',
      sourceLinks: [
        {
          label: 'Article',
          kind: 'article',
          url: 'https://example.test/a',
          parentUrl: 'https://example.test/blog',
        },
      ],
    });
    expect(
      companyUsefulLinks(new CompanyResearch(s).profile(company.id)).map((l) => l.url),
    ).toContain('https://example.test/a');
    expect(() =>
      s.saveCompany({
        name: 'Unsafe',
        sourceLinks: [{ label: 'Bad', kind: 'other', url: 'javascript:alert(1)' }],
      }),
    ).toThrow();
    expect(() =>
      s.saveCompany({
        name: 'Unsafe',
        sourceLinks: [{ label: 'Bad', kind: 'other', url: 'https://user:password@example.test/' }],
      }),
    ).toThrow();
  } finally {
    s.db.close();
  }
  expect(sourceUrl('http://127.0.0.1:4317/api/state')).toBe('');
  expect(sourceUrl('http://jobs-checker.localhost/api/state')).toBe('');
  expect(sourceUrl('https://user:password@example.test/')).toBe('');
});
