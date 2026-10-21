import { z } from 'zod';
import {
  GLASSDOOR_ACTOR,
  glassdoorRequestSchema,
  quoteGlassdoor,
  startGlassdoor,
  readGlassdoorRun,
  normalizeGlassdoorExport,
} from '@personal-radar/connectors/apify/glassdoor';
import type { PaidAdapter, PaidOperation } from './research-paid.js';

export function glassdoorAdapters(
  env: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = fetch,
): Record<string, PaidAdapter> {
  const cap = () => {
    const value = Number(env.JOBS_GLASSDOOR_MAX_RUN_USD ?? '1');
    if (!Number.isFinite(value) || value <= 0 || value > 10)
      throw new Error('JOBS_GLASSDOOR_MAX_RUN_USD должен быть > 0 и <= 10');
    return value;
  };
  const request = (operation: PaidOperation) => {
    if (
      operation.actor !== GLASSDOOR_ACTOR ||
      operation.provider !== 'apify' ||
      operation.companyIds.length !== 1
    )
      throw new Error('Glassdoor: один запуск — одна компания');
    if (operation.maxCostUsd > cap())
      throw new Error('Бюджет превышает JOBS_GLASSDOOR_MAX_RUN_USD');
    const parameters = z
      .strictObject({ companyUrl: z.string(), startDate: z.iso.date().optional() })
      .parse(operation.parameters);
    return glassdoorRequestSchema.parse({
      ...parameters,
      command: operation.operation,
      maxItems: operation.volume,
    });
  };
  const savedRun = (data: unknown) =>
    z.object({ runId: z.string().regex(/^[a-zA-Z0-9]{1,40}$/), checkedAt: z.string() }).parse(data);
  return {
    [GLASSDOOR_ACTOR]: {
      status: () => ({
        configured: Boolean(env.APIFY_TOKEN?.trim()),
        missing: env.APIFY_TOKEN?.trim() ? [] : ['APIFY_TOKEN'],
        commands: ['reviews', 'interviews'],
        maxRunUsd: cap(),
        maxItems: 200,
        oneCompanyPerRun: true,
        datasetRead: 'disabled',
        explicitRequestOnly: true,
        quotaWarning:
          'Apify account credits may be shared with Personal Radar and Activity Checker.',
      }),
      quote: (operation) => quoteGlassdoor(request(operation), fetcher),
      execute: async (operation) => {
        const input = request(operation);
        const run = await startGlassdoor(
          input,
          env.APIFY_TOKEN ?? '',
          operation.hardBudgetUsd,
          fetcher,
        );
        return { costUsd: run.costUsd, data: run, status: 'submitted' };
      },
      refresh: async (data) => {
        const run = await readGlassdoorRun(savedRun(data).runId, env.APIFY_TOKEN ?? '', fetcher);
        return { costUsd: run.costUsd, data: run, status: 'submitted' };
      },
      normalize: (operation, data, rows) => {
        // An offline export remains usable if the administrator later lowers the spending cap.
        const parameters = z
          .strictObject({ companyUrl: z.string(), startDate: z.iso.date().optional() })
          .parse(operation.parameters);
        const input = glassdoorRequestSchema.parse({
          ...parameters,
          command: operation.operation,
          maxItems: operation.volume,
        });
        const run = savedRun(data);
        return {
          ...normalizeGlassdoorExport(input, rows),
          companyId: operation.companyIds[0],
          criterionId: operation.operation === 'reviews' ? 'P01' : 'P07_INTERVIEW',
          actor: GLASSDOOR_ACTOR,
          runId: run.runId,
          processedAt: new Date().toISOString(),
          provenance: 'user_supplied_export; not fetched or verified against the remote dataset',
        };
      },
    },
  };
}
