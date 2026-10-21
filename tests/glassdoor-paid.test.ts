import { afterEach, describe, expect, it, vi } from 'vitest';
import { Store } from '../server/store';
import { ResearchPaidGate, type PaidOperation } from '../server/research-paid';
import { glassdoorAdapters } from '../server/glassdoor-paid';
import { GLASSDOOR_ACTOR, GLASSDOOR_ACTOR_ID } from '@personal-radar/connectors/apify/glassdoor';

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
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    if (String(_url).includes('/actor-runs/') || init?.method === 'POST')
      return Response.json({
        data: {
          id: 'run123',
          actId: GLASSDOOR_ACTOR_ID,
          defaultDatasetId: 'dataset123',
          status: 'RUNNING',
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
    setPrice: (value: number) => {
      price = value;
    },
  };
}
describe('manual Glassdoor through shared connector and durable paid gate', () => {
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
      datasetRead: 'disabled',
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
