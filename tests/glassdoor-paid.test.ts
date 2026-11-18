import assert from 'node:assert/strict';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Store } from '../server/store';
import { ResearchPaidGate, type PaidOperation } from '../server/research-paid';
import { glassdoorAdapters } from '../server/glassdoor-paid';
import {
  GLASSDOOR_ACTOR,
  GLASSDOOR_ACTOR_ID,
  SCRAPIFIER_INTERVIEWS_ACTOR,
} from '@personal-radar/connectors/apify/glassdoor';

const stores: Store[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.db.close();
  vi.restoreAllMocks();
});
function setup(token = 'fake-test-token') {
  const store = new Store(':memory:');
  stores.push(store);
  const company = store.saveCompany({ name: 'Fixture' });
  let price = 0.00475;
  let runStatus = 'RUNNING';
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    if (String(_url).includes('/datasets/'))
      return Response.json([
        {
          id: 1234,
          employer: { id: 123 },
          jobTitle: { text: 'Product Analyst' },
          processDescription: 'SQL case and a product experiment',
          userQuestions: [{ question: 'Choose a primary metric' }],
        },
      ]);
    if (String(_url).includes('/actor-runs/') || init?.method === 'POST')
      return Response.json({
        data: {
          id: 'run123',
          actId: GLASSDOOR_ACTOR_ID,
          defaultDatasetId: 'dataset123',
          status: runStatus,
        },
      });
    return Response.json({
      data: {
        id: GLASSDOOR_ACTOR_ID,
        pricingInfos: [
          {
            startedAt: '2026-01-01T00:00:00Z',
            pricingModel: 'PAY_PER_EVENT',
            pricingPerEvent: {
              actorChargeEvents: {
                'apify-default-dataset-item': { eventPriceUsd: price },
                'apify-actor-start': { eventPriceUsd: 0.005 },
              },
            },
          },
        ],
      },
    });
  });
  const gate = new ResearchPaidGate(store, glassdoorAdapters({ APIFY_TOKEN: token }, fetcher));
  const operation: PaidOperation = {
    provider: 'apify',
    actor: GLASSDOOR_ACTOR,
    operation: 'reviews',
    companyIds: [company.id],
    volume: 50,
    parameters: {
      companyUrl: 'https://www.glassdoor.com/Reviews/Fixture-E123.htm',
      startDate: '2026-10-01',
    },
    maxCostUsd: 0.3,
  };
  return {
    store,
    gate,
    operation,
    fetcher,
    setRunStatus: (value: string) => {
      runStatus = value;
    },
    setPrice: (value: number) => {
      price = value;
    },
  };
}
describe('manual Glassdoor through shared connector and durable paid gate', () => {
  it('binds Scrapifier role and hard cap to one launch, then normalizes the paid result', async () => {
    const { gate, operation, fetcher } = setup();
    const actorId = 'JDhTpcIIRIJEr3Wi8';
    const requested = {
      ...operation,
      actor: SCRAPIFIER_INTERVIEWS_ACTOR,
      operation: 'interviews',
      volume: 10,
      maxCostUsd: 0.03,
      readResults: true as const,
      parameters: {
        companyUrl: 'https://www.glassdoor.com/Interview/Fixture-E123.htm',
        jobTitle: 'Product Analyst',
      },
    };
    fetcher.mockImplementation(async (url, init) => {
      const path = new URL(String(url));
      if (init?.method === 'POST') {
        assert.equal(path.pathname, `/v2/acts/${actorId}/runs`);
        assert.equal(path.searchParams.get('maxTotalChargeUsd'), '0.03');
        expect(JSON.parse(String(init.body))).toMatchObject({
          startUrls: [{ url: requested.parameters.companyUrl }],
          companyNames: [],
          jobTitle: 'Product Analyst',
          maxInterviewsPerCompany: 10,
          includeQuestions: true,
        });
        return Response.json({
          data: {
            id: 'run123',
            actId: actorId,
            defaultDatasetId: 'dataset123',
            status: 'SUCCEEDED',
            usageTotalUsd: 0.003,
            chargedEventCounts: { 'apify-default-dataset-item': 1 },
          },
        });
      }
      if (path.pathname === '/v2/datasets/dataset123/items') {
        assert.equal(path.searchParams.get('limit'), '10');
        assert.match(path.searchParams.get('fields') ?? '', /interviewId,employerId/);
        return Response.json([
          {
            interviewId: 456,
            employerId: 123,
            jobTitle: 'Product Analyst',
            processDescription: 'An experiment case.',
            questions: [{ question: 'How would you configure the experiment?' }],
          },
        ]);
      }
      assert.equal(path.pathname, `/v2/acts/${actorId}`);
      return Response.json({
        data: {
          id: actorId,
          pricingInfos: [
            {
              startedAt: '2026-01-01T00:00:00Z',
              pricingModel: 'PAY_PER_EVENT',
              pricingPerEvent: {
                actorChargeEvents: {
                  'apify-default-dataset-item': {
                    eventTieredPricingUsd: {
                      FREE: { tieredEventPriceUsd: 0.003 },
                      BRONZE: { tieredEventPriceUsd: 0.00264 },
                    },
                  },
                },
              },
            },
          ],
        },
      });
    });
    await expect(
      gate.quote({ operation: { ...requested, parameters: operation.parameters } }),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    expect(await gate.quote({ operation: requested })).toMatchObject({
      quote: { startUsd: 0, upperBoundUsd: 0.03 },
    });
    const grant = await gate.authorize({ operation: requested, confirmed: true });
    await expect(
      gate.execute({
        operation: {
          ...requested,
          parameters: { ...requested.parameters, jobTitle: 'Data Analyst' },
        },
        grantId: grant.grantId,
      }),
    ).rejects.toThrow('отличаются');
    const result = await gate.execute({ operation: requested, grantId: grant.grantId });
    expect(result).toMatchObject({
      costUsd: 0.003,
      data: { chargedResults: 1 },
      collection: {
        status: 'ready',
        result: {
          actor: SCRAPIFIER_INTERVIEWS_ACTOR,
          materials: [
            {
              recordId: '456',
              employerId: '123',
              role: 'Product Analyst',
              questions: ['How would you configure the experiment?'],
            },
          ],
        },
      },
    });
    assert.equal(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST').length, 1);
  });
  it('concurrent execution consumes a grant once and retains unexpected billing for review', async () => {
    const { gate, operation, fetcher } = setup();
    const grant = await gate.authorize({ operation, confirmed: true });
    const attempts = await Promise.allSettled([
      gate.execute({ operation, grantId: grant.grantId }),
      gate.execute({ operation, grantId: grant.grantId }),
    ]);
    expect(attempts.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    const entry = gate.history().runs[0];
    fetcher.mockResolvedValueOnce(
      Response.json({
        data: {
          id: 'run123',
          actId: GLASSDOOR_ACTOR_ID,
          defaultDatasetId: 'dataset123',
          status: 'FAILED',
          usageTotalUsd: 2,
        },
      }),
    );
    await expect(gate.refresh(entry.ledgerId)).rejects.toThrow('hard budget');
    expect(gate.history(entry.ledgerId)).toMatchObject({
      status: 'budget_violation',
      costUsd: 2,
      result: { data: { status: 'FAILED', runId: 'run123' } },
    });
  });
  it('an unknown POST consumes consent and leaves recovery history without exposing secrets', async () => {
    const { gate, operation, fetcher } = setup();
    const grant = await gate.authorize({ operation, confirmed: true });
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url, init) => {
      if (init?.method === 'POST') throw new Error('fake-test-token provider echo');
      return original(url, init);
    });
    await expect(gate.execute({ operation, grantId: grant.grantId })).rejects.toThrow('неизвестен');
    await expect(gate.execute({ operation, grantId: grant.grantId })).rejects.toThrow(
      'одноразовое',
    );
    const history = gate.history();
    expect(history.runs[0].status).toBe('unknown_or_failed');
    expect(JSON.stringify(history)).not.toContain('fake-test-token');
    const count = fetcher.mock.calls.length;
    await expect(gate.refresh(history.runs[0].ledgerId)).rejects.toThrow('Нет сохранённого run ID');
    expect(fetcher).toHaveBeenCalledTimes(count);
  });
  it('status/history have no provider requests, quote has only one GET and creates no consent', async () => {
    const { gate, store, operation, fetcher } = setup('');
    expect(gate.plan().adapters[GLASSDOOR_ACTOR]).toMatchObject({
      configured: false,
      missing: ['APIFY_TOKEN'],
      datasetRead: 'bounded',
      maxRunUsd: 1,
    });
    expect(gate.history()).toEqual({ runs: [] });
    expect(fetcher).not.toHaveBeenCalled();
    expect(await gate.quote({ operation })).toMatchObject({ quote: { upperBoundUsd: 0.25 } });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]?.method).toBe('GET');
    expect(store.db.prepare('SELECT count(*) n FROM company_research_paid_grants').get()?.n).toBe(
      0,
    );
  });
  it('persists run links and provisional unknown billing, consumes consent once, normalizes entirely offline', async () => {
    const { gate, operation, fetcher, store } = setup();
    await expect(gate.authorize({ operation })).rejects.toThrow();
    const grant = await gate.authorize({ operation, confirmed: true });
    for (const patch of [
      { volume: 51 },
      { operation: 'interviews' },
      { maxCostUsd: 1 },
      { parameters: { ...operation.parameters, startDate: '2026-01-01' } },
    ]) {
      await expect(
        gate.execute({ operation: { ...operation, ...patch }, grantId: grant.grantId }),
      ).rejects.toThrow();
    }
    const result = await gate.execute({ operation, grantId: grant.grantId });
    expect(result.costUsd).toBeNull();
    expect(gate.history(result.ledgerId)).toMatchObject({
      status: 'submitted',
      hardBudgetUsd: 0.25,
      costUsd: null,
      result: { data: { runId: 'run123', costProvisional: true } },
    });
    await expect(gate.execute({ operation, grantId: grant.grantId })).rejects.toThrow(
      'одноразовое',
    );
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('/datasets/'))).toBe(false);
    const before = fetcher.mock.calls.length;
    expect(
      gate.normalize(result.ledgerId, [{ reviewId: 1, employer: { id: 123 }, pros: 'Good team' }]),
    ).toMatchObject({
      companyId: operation.companyIds[0],
      criterionId: 'P01',
      imported: false,
      materials: [{ verified: false, sourceType: 'employee_report' }],
    });
    expect(fetcher).toHaveBeenCalledTimes(before);
    expect(store.db.prepare('SELECT count(*) n FROM company_research_observations').get()?.n).toBe(
      0,
    );
    await gate.refresh(result.ledgerId);
    expect(fetcher).toHaveBeenCalledTimes(before + 1);
    expect(fetcher.mock.calls.at(-1)?.[1]?.method).toBe('GET');
  });
  it('collects after an authorized launch and reuses the local result across refresh', async () => {
    const { gate, operation, fetcher, setRunStatus } = setup();
    const requested = { ...operation, operation: 'interviews', readResults: true as const };
    const grant = await gate.authorize({ operation: requested, confirmed: true });
    await expect(gate.execute({ operation, grantId: grant.grantId })).rejects.toThrow('отличаются');
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation((url, init) => {
      if (String(url).includes('waitForFinish=20')) setRunStatus('SUCCEEDED');
      return original(url, init);
    });
    const result = await gate.execute({ operation: requested, grantId: grant.grantId });
    expect(result).toMatchObject({
      data: { status: 'SUCCEEDED' },
      collection: {
        status: 'ready',
        cached: false,
        result: {
          provenance: 'apify_dataset_api',
          materials: [
            {
              role: 'Product Analyst',
              questions: ['Choose a primary metric'],
              verified: false,
            },
          ],
        },
      },
    });
    expect(gate.history(result.ledgerId)).not.toHaveProperty('datasetMaterials');
    await gate.refresh(result.ledgerId);
    expect(await gate.collect(result.ledgerId)).toMatchObject({ status: 'ready', cached: true });
    const reads = fetcher.mock.calls.filter(([url]) => String(url).includes('/datasets/'));
    expect(reads).toHaveLength(1);
    const dataset = new URL(String(reads[0][0]));
    expect(dataset.pathname).toBe('/v2/datasets/dataset123/items');
    expect(dataset.searchParams.get('limit')).toBe('50');
    expect(dataset.searchParams.get('fields')?.split(',')).toContain('userQuestions');
    expect(reads[0][1]?.method).toBe('GET');
  });
  it('collects a saved run once after it finishes, without another launch', async () => {
    const { gate, operation, fetcher, setRunStatus } = setup();
    const requested = { ...operation, operation: 'interviews', readResults: true as const };
    const grant = await gate.authorize({ operation: requested, confirmed: true });
    const result = await gate.execute({ operation: requested, grantId: grant.grantId });
    expect(result).toMatchObject({ collection: { status: 'pending' } });
    expect(String(fetcher.mock.calls.at(-1)?.[0])).toContain('waitForFinish=20');
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('/datasets/'))).toBe(false);
    setRunStatus('SUCCEEDED');
    const results = await Promise.all([
      gate.collect(result.ledgerId),
      gate.collect(result.ledgerId),
    ]);
    expect(results).toEqual([expect.objectContaining({ status: 'ready' }), results[0]]);
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes('/datasets/'))).toHaveLength(
      1,
    );
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });
  it('preserves the submitted run when dataset collection fails', async () => {
    const { gate, operation, fetcher, setRunStatus } = setup();
    const requested = { ...operation, operation: 'interviews', readResults: true as const };
    const grant = await gate.authorize({ operation: requested, confirmed: true });
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation((url, init) =>
      String(url).includes('/datasets/')
        ? Promise.resolve(new Response('provider body', { status: 403 }))
        : original(url, init),
    );
    setRunStatus('SUCCEEDED');
    const result = await gate.execute({ operation: requested, grantId: grant.grantId });
    expect(result).toMatchObject({
      collection: { status: 'failed', error: expect.stringContaining('403') },
    });
    expect(gate.history(result.ledgerId)).toMatchObject({
      status: 'submitted',
      result: { data: { runId: 'run123' } },
    });
    fetcher.mockImplementation(original);
    expect(await gate.collect(result.ledgerId)).toMatchObject({ status: 'ready' });
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });
  it('unsupported operations/options, multi-company and ceiling violations fail before HTTP', async () => {
    const { gate, operation, fetcher } = setup();
    for (const patch of [
      { operation: 'jobs' },
      { companyIds: [...operation.companyIds, ...operation.companyIds] },
      { parameters: { ...operation.parameters, painPointAnalysis: true } },
      { maxCostUsd: 1.01 },
      { volume: 201 },
    ]) {
      await expect(gate.quote({ operation: { ...operation, ...patch } })).rejects.toThrow();
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('price rise consumes authorization without starting, and failed/unknown starts cannot retry', async () => {
    const { gate, operation, fetcher, setPrice } = setup();
    const grant = await gate.authorize({ operation, confirmed: true });
    setPrice(0.02);
    await expect(gate.execute({ operation, grantId: grant.grantId })).rejects.toThrow(
      'Тариф изменился',
    );
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
    await expect(gate.execute({ operation, grantId: grant.grantId })).rejects.toThrow(
      'одноразовое',
    );
    expect(gate.history().runs[0]).toMatchObject({ status: 'unknown_or_failed', reservedUsd: 0.3 });
  });
  it('missing token prevents execution and expired consent prevents all provider calls', async () => {
    const { gate, operation, fetcher, store } = setup('');
    const grant = await gate.authorize({ operation, confirmed: true });
    fetcher.mockClear();
    await expect(gate.execute({ operation, grantId: grant.grantId })).rejects.toThrow(
      'APIFY_TOKEN',
    );
    expect(fetcher).not.toHaveBeenCalled();
    const next = await gate.authorize({ operation, confirmed: true });
    const row = store.db
      .prepare('SELECT data FROM company_research_paid_grants WHERE id=?')
      .get(next.grantId)!;
    const data = JSON.parse(row.data as string);
    data.expiresAt = Date.now() - 1;
    store.db
      .prepare('UPDATE company_research_paid_grants SET data=? WHERE id=?')
      .run(JSON.stringify(data), next.grantId);
    fetcher.mockClear();
    await expect(gate.execute({ operation, grantId: next.grantId })).rejects.toThrow('истекло');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
