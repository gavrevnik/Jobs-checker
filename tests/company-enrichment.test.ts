import { afterEach, expect, it } from 'vitest';
import { Store } from '../server/store';
import { CompanyResearch } from '../server/company-research';
import { companyResearchTags } from '../shared/company-signals';
import { companyInfrastructure } from '../src/company-infrastructure';
import { companyInterviewDetails, extractInterviewSection } from '../shared/company-interviews';
import { companyInformation, companySummaryText } from '../src/company-summary';
import { observationSchema } from '../shared/company-research';
const stores: Store[] = [];
afterEach(() => stores.splice(0).forEach((s) => s.db.close()));
function fixture() {
  const store = new Store(':memory:');
  stores.push(store);
  const company = store.saveCompany({ name: 'Enrichment' });
  const research = new CompanyResearch(store);
  const add = (criterion_id: string, value: unknown, verified = true, scope = {}) => {
    const p = research.manual(company.id, {
      criterion_id,
      value,
      confidence: 'high',
      scope,
      reasoning: 'Scoped analysis from saved primary material.',
      evidence: [
        {
          url: 'https://example.test/role',
          title: 'Source',
          source_type: 'official',
          observed_at: new Date().toISOString(),
          excerpt: 'The team operates monitored pipelines and governed metrics.',
        },
      ],
    });
    if (verified) research.review(p.observations[0].id, { verified: true });
    return p.observations[0].id;
  };
  return { store, company, research, add, profile: () => research.profile(company.id) };
}
const process = `Our product team.\n\nHIRING PROCESS\n\n1. Screening call with Talent Manager (30min)\n\n2. Technical interview with Hiring Manager (1 hr)\n\n3. Take-home assignment and live review (1 hr)\n\n4. Culture fit interviews and meet the team\n\n5. Reference check and offer\n\nDIVERSITY, EQUITY, INCLUSION\nFooter should not appear`;
it('retains stage, durations and assignment from a real section and ignores hiring boilerplate', () => {
  const text = extractInterviewSection(process);
  expect(text).toContain('Take-home assignment');
  expect(text).toContain('30min');
  expect(text).not.toContain('Footer');
  expect(
    extractInterviewSection('HIRING PROCESS\nA take-home assignment with a written brief.'),
  ).toContain('take-home assignment');
  expect(
    extractInterviewSection('Please ask for accommodation during the interview process.'),
  ).toBe('');
  expect(
    extractInterviewSection('HIRING PROCESS\nWe never ask for payments. Contact our recruiter.'),
  ).toBe('');
  expect(
    extractInterviewSection(
      'Nice to have: experience interviewing candidates and reviewing assignments.',
    ),
  ).toBe('');
});
it('keeps raw process details role-specific and unverified, shares them with full information, deduplicates URLs', () => {
  const f = fixture();
  f.store.addJob({
    company: f.company.name,
    title: 'Senior Product Analyst',
    url: 'https://example.test/role',
    description: process,
  });
  f.store.addJob({
    company: f.company.name,
    title: 'Senior Data Analyst',
    url: 'https://example.test/other',
    description: 'No process details.',
  });
  const p = f.profile(),
    details = companyInterviewDetails(p.observations, p.jobs);
  expect(details).toHaveLength(1);
  expect(details[0].role).toBe('Senior Product Analyst');
  expect(details[0].notice).toContain('не проверено');
  expect(companySummaryText(p)).toContain('Take-home assignment');
  expect(companyInterviewDetails([], [...p.jobs, ...p.jobs])).toHaveLength(1);
  f.add(
    'P07_INTERVIEW',
    {
      summary: 'Role-specific published process',
      stages: [{ title: 'Technical interview', details: 'SQL', duration: '60 minutes' }],
      assignment: { kind: 'none', details: 'No take-home assignment' },
    },
    false,
    { role: 'Senior Product Analyst', job_url: 'https://example.test/role' },
  );
  const next = f.profile(),
    reviewed = companyInterviewDetails(next.observations, next.jobs);
  expect(reviewed).toHaveLength(1);
  expect(reviewed[0].notice).toContain('Не проверено');
  expect(reviewed[0].text).toContain('не предусмотрено');
  expect(companySummaryText(next).match(/Role-specific published process/g)).toHaveLength(1);
});
it('preserves structured interview facts on import, rejects empty processes, hides rejected records', () => {
  const f = fixture();
  const id = f.add('P07_INTERVIEW', {
    summary: 'Three steps',
    stages: [
      { title: 'Intro', details: 'Meet recruiter', duration: '30 min' },
      { title: 'Case', details: 'Discuss product metrics' },
    ],
    assignment: { kind: 'live', details: 'SQL task', duration: '45 min' },
  });
  expect(companyInterviewDetails(f.profile().observations)[0].text).toContain('45 min');
  const invalid = {
    ...f.profile().observations[0],
    value: { summary: 'Equal opportunity employer', stages: [] },
  };
  const {
    id: _,
    companyId,
    runId,
    importedAt,
    manual,
    verifiedAt,
    rejected,
    reviewNote,
    ...input
  } = invalid;
  expect(observationSchema.safeParse(input).success).toBe(false);
  f.research.review(id, { verified: false, rejected: true });
  expect(companyInterviewDetails(f.profile().observations)).toEqual([]);
});
it('keeps assessments explicit and scoped, never infers maturity from stack or pending facts', () => {
  const f = fixture();
  f.add('T08_INFRA', { summary: 'A warehouse.', tags: ['Snowflake', 'dbt'] });
  expect(
    companyResearchTags(f.profile().observations).infrastructure.every((t) => !t.assessment),
  ).toBe(true);
  const scope = { country: 'ES', role: 'Analytics Platform', job_url: 'https://example.test/role' };
  f.add(
    'T08_INFRA',
    {
      summary: 'Governed metrics and monitored pipelines are operating; heavy queries are capped.',
      tags: ['Контроль compute'],
      assessments: [
        {
          label: 'Развитая инфра',
          basis:
            'Operating metrics ownership, quality checks and monitoring; applies to this platform.',
        },
      ],
    },
    true,
    scope,
  );
  f.add(
    'T08_INFRA',
    {
      summary: 'Unreviewed hypothesis',
      tags: [],
      assessments: [{ label: 'Начальный этап', basis: 'Pending claim' }],
    },
    false,
  );
  const p = f.profile(),
    tags = companyResearchTags(p.observations).infrastructure;
  const assessment = tags.find((t) => t.assessment)!;
  expect(assessment.label).toBe('Развитая инфра');
  expect(assessment.details).toContain('Оценка анализа');
  expect(assessment.details).toContain('Operating metrics ownership');
  expect(assessment.scope).toContain('ES');
  expect(tags.some((t) => t.label === 'Начальный этап')).toBe(false);
  expect(
    companyInfrastructure(p.observations).summaries.some((s) => s.text.includes('heavy queries')),
  ).toBe(true);
  expect(companySummaryText(p)).toContain('Оценка анализа: Развитая инфра');
});
it('stores extra descriptive answers without adding scored criteria and exposes every filled answer', () => {
  const f = fixture(),
    before = f.profile().scores;
  f.add(
    'P03_PUBLIC',
    'Requests enter a backlog; analyst and PM prioritise during quarterly planning.',
  );
  f.add('AN02', 'Embedded in Growth; reports to Head of Analytics.');
  f.add('A03', ['Barcelona manager', 'Seattle colleagues']);
  f.add('B04', 'B2B retention and renewals; own renewal-risk metrics.');
  f.add('B08', ['ES', 'IT']);
  f.add('AN08', true);
  const p = f.profile(),
    text = companySummaryText(p);
  expect(text).toContain('Requests enter a backlog');
  expect(text).toContain('Head of Analytics');
  expect(text).toContain('Seattle colleagues');
  expect(text).toContain('renewal-risk');
  expect(p.scores.P).toEqual(before.P);
  expect(
    companyInformation(p)
      .flatMap((s) => s.items)
      .some((i) => i.label.includes('Работа с задачами')),
  ).toBe(true);
});
