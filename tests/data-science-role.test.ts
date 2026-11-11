import { describe, expect, it } from 'vitest';
import { Store } from '../server/store';
import { SourceTools } from '../server/source-tools';
import { CompanyResearch } from '../server/company-research';
import { coreSchema } from '../shared/selection-profile';
import { jobSchema, type Job } from '../shared/model';
import { acceptsJob, searchSchema } from '../shared/source-tools';
import { targetLevel } from '../shared/target-vacancies';
import { analyticalDataScientist } from '../shared/data-science-role';

// Condensed public responsibilities, not company-name allowlists or private CRM/research notes.
const analytical = [
  {
    company: 'Monzo',
    title: 'Senior Data Scientist',
    location: 'Barcelona',
    seniority: 'senior',
    description: `Your day-to-day
Guide product teams to measure success and run A/B experiments.
Work with finance to understand lifetime value and how product features affect user profitability.
You should apply if:
You know SQL and Python.`,
  },
  {
    company: 'Monzo',
    title: 'Senior Data Scientist',
    location: 'London',
    seniority: 'senior',
    description: `Your day-to-day
Analyze user engagement and run large-scale A/B experiments.
Inform product strategy and work with engineers on tracking.
The interview process:
Case study.`,
  },
  {
    company: 'Monzo',
    title: 'Lead Data Scientist',
    location: 'London',
    seniority: 'lead',
    description: `What you’ll be working on:
Develop and execute best practices for experimentation enabling data informed decisions.
Work closely with leaders in product, engineering, design and research to build and iterate on product ideas.
You should apply if:
You enjoy mentoring.`,
  },
  {
    company: 'Monzo',
    title: 'Staff Data Scientist',
    location: 'Barcelona',
    seniority: 'lead',
    description: `You’ll play a key role by...
Establish measurement strategies and metric maps connecting customer behaviour and business outcomes.
Partner with product leaders to influence strategy and investment decisions.
Coach data scientists and analytics engineers.
We’d love to hear from you if:
You have deep expertise.`,
  },
  {
    company: 'Expedia Group',
    title: 'Data Scientist III - Analytics',
    location: 'Madrid',
    description: `In this role, you will:
Extract and combine data to support model building and analytics.
Work with commercial stakeholders and Machine Learning teams to design tactical actions.
Analyze elasticity curves and price profitability to guide revenue optimization.
Experience and Qualifications:
You understand Machine Learning algorithms.`,
  },
  {
    company: 'Flix',
    title: 'Senior Data Scientist – Marketing Measurement & Causal Inference',
    location: 'Lisbon',
    seniority: 'senior',
    description: `<h2>About the Role</h2><ul>
<li>Design geo experiments and synthetic control frameworks.</li>
<li>Apply causal inference to measure incremental bookings and revenue.</li>
<li>Translate findings into recommendations for marketing teams and senior management.</li>
</ul><h2>About You</h2><p>Python, SQL, PyMC.</p>`,
  },
];
const engineering = [
  {
    title: 'Staff Data Scientist, Growth Data Products',
    description: `Your mission
Design, deploy and monitor production machine learning pipelines for bidding and targeting.
Champion A/B test design and causal inference.
Translate growth strategies into technical roadmaps for marketing stakeholders.`,
  },
  {
    title: 'Senior Data Scientist - Product Insights',
    description: `Responsibilities:
Own ML and GenAI systems end-to-end in production.
Build feature stores and maintain model serving infrastructure.
Run A/B tests and measure conversion for product teams.`,
  },
  {
    title: 'Data Scientist - Analytics',
    description: `Responsibilities:
Build ETL and data ingestion pipelines.
Maintain data warehouses and operate data pipelines.
Measure retention and advise product stakeholders.`,
  },
  {
    title: 'Data Scientist',
    description: `Our company runs experiments and shapes product strategy with analytics.
Your responsibilities:
Train deep neural ranking models and implement two-tower architectures.
Deploy ML models to production.
Requirements:
Experience with SQL, A/B tests and stakeholder recommendations.`,
  },
  {
    title: 'Data Scientist - Analytics',
    description: `Responsibilities: Build ETL pipelines and maintain data warehouses.
Requirements: Design experiments and advise product teams.`,
  },
  {
    title: 'Data Scientist - Product Insights',
    description: `Your mission
Train and deploy prediction models in production for the product team.
Evaluate conversion through A/B tests and advise business stakeholders.`,
  },
];

function configure(store: Store) {
  const config = store.selection.read();
  store.selection.save({
    expectedVersion: config.version,
    core: coreSchema.parse({
      name: 'Product analytics',
      seniority: 'middle_plus',
      roleFamilies: ['product_analytics', 'data_analytics', 'decision_science', 'analytics_lead'],
    }),
    scenarios: [],
    activeScenarioId: '',
  });
  return store.selection.profile('all');
}

describe('Data Science duties across search and company comparison', () => {
  it('includes all six analytical DS roles with their original titles and grades', () => {
    const store = new Store(':memory:');
    try {
      const profile = configure(store);
      for (const fixture of analytical) {
        const job = jobSchema.parse(fixture);
        expect(acceptsJob(job, searchSchema.parse({}), profile), fixture.title).toBe(true);
        expect(targetLevel(job, profile), fixture.title).not.toBeNull();
        expect(
          acceptsJob({ ...job, company: 'Other employer' }, searchSchema.parse({}), profile),
        ).toBe(true);
      }
      const unknown = jobSchema.parse(analytical[4]);
      expect(unknown.seniority).toBe('unknown');
      expect(targetLevel(unknown, profile)).toBe('review');
    } finally {
      store.db.close();
    }
  });

  it.each(engineering)(
    'excludes engineering duties even with an analytical title: $title',
    (fixture) => {
      const store = new Store(':memory:');
      try {
        const profile = configure(store);
        const job = jobSchema.parse({ company: 'Fixture', seniority: 'senior', ...fixture });
        expect(acceptsJob(job, searchSchema.parse({}), profile)).toBe(false);
        expect(targetLevel(job, profile)).toBeNull();
      } finally {
        store.db.close();
      }
    },
  );

  it.each([
    '',
    'SQL, Python, machine learning, A/B testing.',
    'Requirements: Design experiments and advise product teams. SQL and Python.',
    'We run experiments to guide product decisions. Requirements: Python.',
    'Your responsibilities:\nDo not run experiments or measure retention.\nWork with product stakeholders.',
    'Your responsibilities:\nMonitor model latency and infrastructure uptime.\nSupport engineering stakeholders.',
  ])(
    'does not infer generic DS suitability from sparse, company-wide or requirements-only text',
    (description) => {
      expect(analyticalDataScientist({ title: 'Senior Data Scientist', description })).toBe(false);
    },
  );

  it('does not mistake collaborating with ML/DE colleagues or a skill requirement for engineering ownership', () => {
    const job = {
      title: 'Data Scientist',
      description: `What you'll do:
Analyze elasticity and run experiments to measure profitability.
Work with commercial stakeholders and ML engineers on pricing decisions.
Requirements:
Design and deploy ML systems to production. MLOps and feature stores are a plus.`,
    };
    expect(analyticalDataScientist(job)).toBe(true);
  });

  it('still applies role-family, grade and geography constraints and preserves legacy matching', () => {
    const store = new Store(':memory:');
    try {
      const profile = configure(store),
        job = jobSchema.parse(analytical[0]);
      expect(acceptsJob(job, searchSchema.parse({ locations: ['France'] }), profile)).toBe(false);
      expect(acceptsJob(job, searchSchema.parse({ seniority: 'lead' }), profile)).toBe(false);
      expect(
        acceptsJob(job, searchSchema.parse({}), {
          ...profile,
          selection: { ...profile.selection!, roleFamilies: ['data_analytics'] },
        }),
      ).toBe(false);
      expect(targetLevel(job)).toBeNull();
      expect(
        targetLevel({ title: 'Senior Data Scientist — Insights', seniority: 'senior' }, profile),
      ).toBe('senior');
    } finally {
      store.db.close();
    }
  });

  it('stores only the matching API roles and displays those exact ATS IDs without rewriting source content', async () => {
    const store = new Store(':memory:');
    try {
      configure(store);
      const company = store.saveCompany({ name: 'Fixture DS' });
      const payload = [...analytical, ...engineering].map((f, i) => ({
        id: i + 1,
        title: f.title,
        location: { name: 'Barcelona, Spain' },
        absolute_url: `https://example.test/job/${i + 1}`,
        content: f.description,
      }));
      const mock = async () =>
        new Response(JSON.stringify({ jobs: payload, meta: { total: payload.length } }));
      const tools = new SourceTools(store, mock);
      const board = tools.addBoard({
        provider: 'greenhouse',
        board: 'fixture',
        companyId: company.id,
        name: company.name,
        monitoring: false,
      });
      const run = await tools.search({
        sourceIds: [board.id],
        providers: ['greenhouse'],
        execute: true,
        store: true,
        reviewRequired: false,
        maxRequests: 1,
      });
      expect(run.results[0].matched).toBe(6);
      const profile = new CompanyResearch(store).profile(company.id);
      expect(profile.targetVacancies.contract.version).toBe('2.2');
      expect(profile.targetVacancies.open).toBe(6);
      expect(new Set(profile.targetVacancies.jobIds)).toEqual(
        new Set(store.list<Job>('jobs').map((j) => j.id)),
      );
      expect(profile.targetVacancies.jobs.map((j) => j.title).sort()).toEqual(
        analytical.map((f) => f.title).sort(),
      );
      expect(store.list('jobs')).toHaveLength(6);
    } finally {
      store.db.close();
    }
  });
});
