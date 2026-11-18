import { z } from 'zod';
import {
  GLASSDOOR_ACTORS,
  SCRAPIFIER_INTERVIEWS_ACTOR,
  type GlassdoorActor,
  glassdoorRequestSchema,
  scrapifierRequestSchema,
  quoteGlassdoor,
  startGlassdoor,
  readGlassdoorRun,
  readGlassdoorDataset,
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
  const request = (operation: PaidOperation, actor: GlassdoorActor) => {
    if (
      operation.actor !== actor ||
      operation.provider !== 'apify' ||
      operation.companyIds.length !== 1
    )
      throw new Error('Glassdoor: один запуск — одна компания');
    if (actor === SCRAPIFIER_INTERVIEWS_ACTOR) {
      const parameters = z
        .strictObject({ companyUrl: z.string(), jobTitle: z.string() })
        .parse(operation.parameters);
      return scrapifierRequestSchema.parse({
        ...parameters,
        command: operation.operation,
        maxItems: operation.volume,
      });
    }
    const parameters = z
      .strictObject({ companyUrl: z.string(), startDate: z.iso.date().optional() })
      .parse(operation.parameters);
    return glassdoorRequestSchema.parse({
      ...parameters,
      command: operation.operation,
      maxItems: operation.volume,
    });
  };
  const paidRequest = (operation: PaidOperation, actor: GlassdoorActor) => {
    if (operation.maxCostUsd > cap())
      throw new Error('Бюджет превышает JOBS_GLASSDOOR_MAX_RUN_USD');
    return request(operation, actor);
  };
  const savedRun = (data: unknown) =>
    z
      .object({
        runId: z.string().regex(/^[a-zA-Z0-9]{1,40}$/),
        datasetId: z
          .string()
          .regex(/^[a-zA-Z0-9]{1,40}$/)
          .nullable(),
        status: z.string(),
      })
      .parse(data);
  const materials = (
    operation: PaidOperation,
    runId: string,
    normalized: ReturnType<typeof normalizeGlassdoorExport>,
    provenance: string,
  ) => ({
    ...normalized,
    companyId: operation.companyIds[0],
    criterionId: operation.operation === 'reviews' ? 'P01' : 'P07_INTERVIEW',
    actor: operation.actor,
    runId,
    processedAt: new Date().toISOString(),
    provenance,
  });
  const adapterFor = (actor: GlassdoorActor): PaidAdapter => ({
    status: () => ({
      configured: Boolean(env.APIFY_TOKEN?.trim()),
      missing: env.APIFY_TOKEN?.trim() ? [] : ['APIFY_TOKEN'],
      commands: GLASSDOOR_ACTORS[actor].commands,
      selection: GLASSDOOR_ACTORS[actor].selection,
      interviewRoleFilter: GLASSDOOR_ACTORS[actor].interviewRoleFilter,
      description: GLASSDOOR_ACTORS[actor].description,
      maxRunUsd: cap(),
      maxItems: 200,
      oneCompanyPerRun: true,
      datasetRead: 'bounded',
      explicitRequestOnly: true,
      quotaWarning: 'Apify account credits may be shared with Personal Radar and Activity Checker.',
    }),
    quote: (operation) => quoteGlassdoor(paidRequest(operation, actor), fetcher, actor),
    execute: async (operation) => {
      const input = paidRequest(operation, actor);
      const run = await startGlassdoor(
        input,
        env.APIFY_TOKEN ?? '',
        operation.hardBudgetUsd,
        fetcher,
        actor,
      );
      return { costUsd: run.costUsd, data: run, status: 'submitted' };
    },
    refresh: async (data, waitForFinish) => {
      const run = await readGlassdoorRun(
        savedRun(data).runId,
        env.APIFY_TOKEN ?? '',
        fetcher,
        waitForFinish,
        actor,
      );
      return { costUsd: run.costUsd, data: run, status: 'submitted' };
    },
    collect: async (operation, data) => {
      const run = savedRun(data);
      if (run.status !== 'SUCCEEDED' || !run.datasetId)
        throw new Error('После успешного запуска Apify нужен сохранённый dataset ID');
      const result = await readGlassdoorDataset(
        run.datasetId,
        request(operation, actor),
        env.APIFY_TOKEN ?? '',
        fetcher,
        actor,
      );
      return materials(operation, run.runId, result, 'apify_dataset_api');
    },
    normalize: (operation, data, rows) => {
      return materials(
        operation,
        savedRun(data).runId,
        normalizeGlassdoorExport(request(operation, actor), rows, actor),
        'user_supplied_export; not fetched or verified against the remote dataset',
      );
    },
  });
  const actors = Object.keys(GLASSDOOR_ACTORS) as GlassdoorActor[];
  return Object.fromEntries(actors.map((actor) => [actor, adapterFor(actor)]));
}
