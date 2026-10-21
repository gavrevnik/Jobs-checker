import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { digest } from './company-research.js';
import type { Store } from './store.js';
const operationSchema = z.strictObject({
  provider: z.literal('apify'),
  actor: z.string().min(1).max(200),
  operation: z.string().min(1).max(100),
  companyIds: z.array(z.string().min(1)).min(1).max(20),
  volume: z.number().int().min(1).max(1000),
  parameters: z.record(z.string(), z.json()),
  maxCostUsd: z.number().positive().max(1000),
});
export type PaidOperation = z.infer<typeof operationSchema>;
export type PaidAdapter = {
  quote: (operation: PaidOperation) => Promise<{ upperBoundUsd: number; pricingAt: string }>;
  execute: (
    operation: PaidOperation & { hardBudgetUsd: number },
  ) => Promise<{ costUsd: number; data: unknown }>;
};
// Only a provider with a real, enforceable hard spending cap may be registered.
// No paid adapter is installed by this module; browser/import/discovery never calls Actors.
export class ResearchPaidGate {
  constructor(
    private store: Store,
    private adapters: Record<string, PaidAdapter> = {},
  ) {}
  plan() {
    return { execute: false, availableActors: Object.keys(this.adapters), requests: 0, costUsd: 0 };
  }
  async authorize(input: unknown) {
    const { operation, confirmed } = z
      .strictObject({ operation: operationSchema, confirmed: z.literal(true) })
      .parse(input);
    void confirmed;
    const adapter = this.adapters[operation.actor];
    if (!adapter) throw new Error('Paid Actor не подключён; выполнение заблокировано');
    if (operation.companyIds.some((id) => !this.store.get('companies', id)))
      throw new Error('Неизвестная компания');
    const quote = await adapter.quote(operation);
    if (
      !Number.isFinite(quote.upperBoundUsd) ||
      quote.upperBoundUsd < 0 ||
      quote.upperBoundUsd > operation.maxCostUsd ||
      !Number.isFinite(Date.parse(quote.pricingAt)) ||
      Date.parse(quote.pricingAt) < Date.now() - 3600000 ||
      Date.parse(quote.pricingAt) > Date.now() + 60000
    )
      throw new Error('Нет актуальной верхней границы расходов в пределах бюджета');
    const id = randomUUID();
    this.store.db.prepare('INSERT INTO company_research_paid_grants(id,data) VALUES (?,?)').run(
      id,
      JSON.stringify({
        operation,
        digest: digest(operation),
        quote,
        expiresAt: Date.now() + 3600000,
      }),
    );
    return { grantId: id, operation, quote };
  }
  async execute(input: unknown) {
    const { operation, grantId } = z
      .strictObject({ operation: operationSchema, grantId: z.string().uuid() })
      .parse(input);
    const adapter = this.adapters[operation.actor];
    const ledgerId = randomUUID();
    const grant = this.store.transaction(() => {
      const row = this.store.db
        .prepare('SELECT * FROM company_research_paid_grants WHERE id=?')
        .get(grantId);
      if (!row || row.used)
        throw new Error('Требуется отдельное одноразовое согласие на этот запуск');
      const grant = JSON.parse(row.data as string);
      if (grant.expiresAt < Date.now() || grant.digest !== digest(operation))
        throw new Error('Согласие истекло или параметры отличаются');
      if (!adapter) throw new Error('Paid Actor не подключён');
      this.store.db
        .prepare('UPDATE company_research_paid_grants SET used=1 WHERE id=? AND used=0')
        .run(grantId);
      this.store.db.prepare('INSERT INTO company_research_paid_ledger VALUES (?,?,?)').run(
        ledgerId,
        grantId,
        JSON.stringify({
          status: 'reserved',
          reservedUsd: operation.maxCostUsd,
          at: new Date().toISOString(),
          operation,
        }),
      );
      return grant;
    });
    try {
      // Adapter must enforce this cap at provider level, including Actor start, polling and dataset retrieval.
      const result = await adapter.execute({
        ...operation,
        hardBudgetUsd: Math.min(operation.maxCostUsd, grant.quote.upperBoundUsd),
      });
      if (
        !Number.isFinite(result.costUsd) ||
        result.costUsd < 0 ||
        result.costUsd > Math.min(operation.maxCostUsd, grant.quote.upperBoundUsd)
      )
        throw new Error('Провайдер нарушил hard budget; проверить расходы перед новым согласием');
      this.store.db.prepare('UPDATE company_research_paid_ledger SET data=? WHERE id=?').run(
        JSON.stringify({
          status: 'completed',
          costUsd: result.costUsd,
          at: new Date().toISOString(),
          operation,
        }),
        ledgerId,
      );
      return result;
    } catch (error) {
      this.store.db.prepare('UPDATE company_research_paid_ledger SET data=? WHERE id=?').run(
        JSON.stringify({
          status: 'unknown_or_failed',
          reservedUsd: operation.maxCostUsd,
          at: new Date().toISOString(),
          operation,
        }),
        ledgerId,
      );
      throw error;
    }
  }
}
