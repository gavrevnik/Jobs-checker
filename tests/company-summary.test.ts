import { expect, it } from 'vitest';
import { Store } from '../server/store';
import { CompanyResearch } from '../server/company-research';
import { companyInformation, companySummaryText } from '../src/company-summary';

function setup() {
  const store = new Store(':memory:');
  const company = store.saveCompany({ name: 'Summary fixture', notes: 'PRIVATE CRM NOTE' });
  return { store, company, research: new CompanyResearch(store) };
}
it('omits empty sections, audit records, unknown placeholders and private notes', () => {
  const { store, company, research } = setup();
  try {
    const text = companySummaryText(research.profile(company.id));
    expect(text).toBe('');
    expect(companyInformation(research.profile(company.id))).toEqual([]);
    expect(text).not.toContain('PRIVATE CRM NOTE');
    expect(text).not.toContain('Неизвестно');
  } finally {
    store.db.close();
  }
});
it('keeps role/country restrictions, false and pending claims readable', () => {
  const { store, company, research } = setup();
  const add = (
    criterion_id: string,
    value: unknown,
    scope: Record<string, string>,
    excerpt: string,
    verified = false,
  ) => {
    research.manual(company.id, {
      criterion_id,
      value,
      confidence: 'high',
      scope,
      reasoning: 'Проверенное содержание источника; не переносить на другие роли.',
      evidence: [
        {
          url: scope.job_url || 'https://summary.example/policy',
          title: 'Primary source',
          source_type: scope.job_url ? 'job' : 'official',
          observed_at: new Date().toISOString(),
          excerpt,
        },
      ],
    });
    const o = research.profile(company.id).observations[0];
    if (verified) research.review(o.id, { verified: true });
  };
  try {
    add(
      'A04',
      true,
      { country: 'ES', role: 'Product Analyst', job_url: 'https://summary.example/es' },
      'Sponsorship для этой испанской роли.',
      true,
    );
    add(
      'A04',
      false,
      { country: 'GB', role: 'IC2 Analyst', job_url: 'https://summary.example/uk' },
      'Для этой британской роли sponsorship не предоставляется.',
    );
    add('T01', ['Snowflake'], {}, 'Требуемый опыт; использование командой не подтверждено.');
    add('AN01', null, {}, 'UNKNOWN SHOULD NOT APPEAR');
    add('AN05', 'REJECTED SHOULD NOT APPEAR', {}, 'Incorrect old statement');
    research.review(research.profile(company.id).observations[0].id, {
      verified: false,
      rejected: true,
    });
    const text = companySummaryText(research.profile(company.id, 'ES'));
    expect(text).toContain('Испания · Product Analyst: Да.');
    expect(text).toContain('Великобритания · IC2 Analyst: Нет.');
    expect(text).toContain('ресерч, не проверено');
    expect(text).toContain('Требуемый опыт; использование командой не подтверждено.');
    expect(text).not.toContain('UNKNOWN SHOULD NOT APPEAR');
    expect(text).not.toContain('REJECTED SHOULD NOT APPEAR');
    expect(text).not.toContain('criterion_id');
  } finally {
    store.db.close();
  }
});
it('deduplicates repeated facts, retains historical warnings, and shows distributed headquarters', () => {
  const { store, company, research } = setup();
  try {
    for (let i = 0; i < 2; i++)
      research.manual(company.id, {
        criterion_id: 'T01',
        value: ['Redshift'],
        confidence: 'high',
        scope: { context: 'official_job_page_available; checked ' + i },
        reasoning: 'Known stack',
        evidence: [
          {
            url: 'https://summary.example/stack',
            title: 'Stack',
            source_type: 'official',
            observed_at: '2020-01-01',
            published_at: '2020-01-01',
            excerpt: 'Known stack',
          },
        ],
      });
    research.review(research.profile(company.id).observations[0].id, { verified: true });
    research.manual(company.id, {
      criterion_id: 'A02_HQ',
      value: null,
      confidence: 'medium',
      scope: { context: 'distributed_headquarters' },
      reasoning: 'Distributed',
      evidence: [
        {
          url: 'https://summary.example/hq',
          title: 'HQ',
          source_type: 'official',
          observed_at: new Date().toISOString(),
          excerpt: 'Distributed Team',
        },
      ],
    });
    research.review(research.profile(company.id).observations[0].id, { verified: true });
    const text = companySummaryText(research.profile(company.id));
    expect(text.match(/Big Data:/g)).toHaveLength(1);
    expect(text).toContain('устаревшие данные');
    expect(text).toContain('Распределённая команда');
  } finally {
    store.db.close();
  }
});
it('enriches filled answers with qualifications, card details and all duplicate sources', () => {
  const { store, company, research } = setup();
  try {
    store.saveCompany(
      {
        ...company,
        description: 'Consumer marketplace',
        size: '200 people',
        dataDrivenEvidence: 'Legacy analytical practice',
        evidenceUrls: ['https://summary.example/legacy'],
      },
      company.id,
    );
    for (const url of ['https://summary.example/one', 'https://summary.example/two']) {
      research.manual(company.id, {
        criterion_id: 'T01',
        value: ['Snowflake'],
        confidence: 'high',
        scope: { country: 'ES', context: 'source:' + url },
        reasoning: 'Snowflake требуется как опыт; внедрение компанией не подтверждено.',
        evidence: [
          {
            url,
            title: 'Job requirements',
            source_type: 'job',
            observed_at: new Date().toISOString(),
            excerpt: 'Experience with Snowflake or similar.',
          },
        ],
      });
    }
    research.manual(company.id, {
      criterion_id: 'AN03',
      value: 'Embedded analysts',
      confidence: 'medium',
      scope: {},
      reasoning: 'Прямое подтверждение в указанном scope. Только для growth-команды.',
      evidence: [
        {
          url: 'https://summary.example/team',
          title: 'Team',
          source_type: 'official',
          observed_at: new Date().toISOString(),
          excerpt: 'Analysts work in growth squads.',
        },
      ],
    });
    const sections = companyInformation(research.profile(company.id));
    const items = sections.flatMap((s) => s.items);
    const stack = items.filter((i) => i.label === 'Big Data');
    expect(stack).toHaveLength(1);
    expect(stack[0].scope).toBe('Испания');
    expect(stack[0].sources.map((s) => s.url).sort()).toEqual([
      'https://summary.example/one',
      'https://summary.example/two',
    ]);
    expect(stack[0].observationIds).toHaveLength(2);
    expect(stack[0].body).toContain('внедрение компанией не подтверждено');
    expect(items.some((i) => i.body.includes('Только для growth-команды.'))).toBe(true);
    expect(items.some((i) => i.body === 'Consumer marketplace')).toBe(true);
    expect(items.some((i) => i.body === '200 people')).toBe(true);
    expect(items.find((i) => i.id === 'data-driven')?.sources[0].url).toBe(
      'https://summary.example/legacy',
    );
    expect(companySummaryText(research.profile(company.id))).not.toContain('source:');
    expect(sections.map((s) => s.id)).not.toContain('P');
  } finally {
    store.db.close();
  }
});
it('keeps opposing role answers separate and marks employee reports even for verified risk sources', () => {
  const { store, company, research } = setup();
  try {
    for (const value of [true, false])
      research.manual(company.id, {
        criterion_id: 'A04',
        value,
        confidence: 'high',
        scope: { country: 'ES', role: 'Analyst' },
        reasoning: value ? 'Sponsorship offered' : 'Sponsorship unavailable',
        evidence: [
          {
            url: 'https://summary.example/' + value,
            title: 'Job',
            source_type: 'job',
            observed_at: new Date().toISOString(),
            excerpt: value ? 'Visa offered' : 'No visa',
          },
        ],
      });
    const profile = research.profile(company.id);
    const answers = companyInformation(profile).flatMap((s) => s.items);
    expect(answers).toHaveLength(2);
    expect(answers.some((i) => i.body.startsWith('Да.'))).toBe(true);
    expect(answers.some((i) => i.body.startsWith('Нет.'))).toBe(true);
    const source = {
      url: 'https://summary.example/review',
      title: 'Employee review',
      source_type: 'employee_report' as const,
      observed_at: new Date().toISOString(),
      excerpt: 'Long hours',
    };
    const risks = companyInformation({
      ...profile,
      flags: [
        {
          id: 'risk',
          title: 'Long hours',
          description: 'One employee reports overtime',
          scope: { country: 'ES' },
          severity: 'medium',
          confidence: 'low',
          verification: 'verified_source',
          occurred_at: '2023-01-01',
          evidence: [source],
        },
      ],
    });
    const risk = risks.find((s) => s.id === 'risks')!.items[0];
    expect(risk.notice).toContain('отзыв, не установленное условие компании');
    expect(risk.notice).toContain('2023-01-01');
    expect(risk.notice).toContain('низкая уверенность');
    expect(risk.sources).toEqual([source]);
  } finally {
    store.db.close();
  }
});
