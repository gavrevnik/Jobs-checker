import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { digest } from './company-research.js';
import type { Store } from './store.js';
import {
  paidOperationSchema as operationSchema,
  type PaidOperation,
} from '../shared/research-paid.js';
export type { PaidOperation } from '../shared/research-paid.js';
export type PaidResult = { costUsd: number | null; data: unknown; status?: 'submitted' };
type PaidCollection =
  | { status: 'ready'; run: unknown; result: unknown; cached: boolean }
  | { status: 'pending' | 'unavailable'; run: unknown };
export type PaidAdapter = {
  status?: () => unknown;
  quote: (operation: PaidOperation) => Promise<{ upperBoundUsd: number; pricingAt: string }>;
  execute: (operation: PaidOperation & { hardBudgetUsd: number }) => Promise<PaidResult>;
  refresh?: (data: unknown, waitForFinish?: boolean) => Promise<PaidResult>;
  collect?: (operation: PaidOperation, data: unknown) => Promise<unknown>;
  normalize?: (operation: PaidOperation, data: unknown, rows: unknown) => unknown;
};
// Only a provider with a real, enforceable hard spending cap may be registered.
// Adapter registration never runs providers; browser/import/discovery never calls Actors.
export class ResearchPaidGate {
  private collecting = new Map<string, Promise<PaidCollection>>();

  constructor(
    private store: Store,
    private adapters: Record<string, PaidAdapter> = {},
  ) {}
  plan() {
    return {
      execute: false,
      availableActors: Object.keys(this.adapters),
      requests: 0,
      costUsd: 0,
      adapters: Object.fromEntries(
        Object.entries(this.adapters).map(([id, a]) => [id, a.status?.() ?? {}]),
      ),
    };
  }
  async quote(input: unknown) {
    const { operation } = z.strictObject({ operation: operationSchema }).parse(input);
    const adapter = this.adapters[operation.actor];
    if (!adapter) throw new Error('Paid Actor не подключён; выполнение заблокировано');
    if (operation.readResults && !adapter.collect)
      throw new Error('Чтение датасета для этого Actor не подключено');
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
    return { operation, quote };
  }
  async authorize(input: unknown) {
    const parsed = z
      .strictObject({ operation: operationSchema, confirmed: z.literal(true) })
      .parse(input);
    const { operation, quote } = await this.quote({ operation: parsed.operation });
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
  history(ledgerId?: string) {
    if (ledgerId) {
      z.string().uuid().parse(ledgerId);
      const row = this.store.db
        .prepare("SELECT id,json_remove(data,'$.datasetMaterials') AS data FROM company_research_paid_ledger WHERE id=?")
        .get(ledgerId);
      if (!row) throw new Error('Запуск не найден');
      return { ledgerId: row.id, ...JSON.parse(row.data as string) };
    }
    return {
      runs: this.store.db
        .prepare("SELECT id,json_remove(data,'$.datasetMaterials') AS data FROM company_research_paid_ledger ORDER BY rowid DESC LIMIT 20")
        .all()
        .map((row) => ({ ledgerId: row.id, ...JSON.parse(row.data as string) })),
    };
  }
  async refresh(ledgerId: string, waitForFinish = false) {
    const entry = this.history(ledgerId);
    const adapter = this.adapters[entry.operation.actor];
    if (!adapter?.refresh || !entry.result)
      throw new Error('Нет сохранённого run ID; проверьте Apify Console, не повторяйте запуск');
    const result = await adapter.refresh(entry.result.data, waitForFinish);
    const data = { ...entry, result, costUsd: result.costUsd, updatedAt: new Date().toISOString() };
    const update = (status: 'budget_violation' | null) =>
      this.store.db
        .prepare(`UPDATE company_research_paid_ledger
          SET data=json_set(data, '$.result',json(?), '$.costUsd',?, '$.updatedAt',?,
            '$.status',COALESCE(?,json_extract(data,'$.status'))) WHERE id=?`)
        .run(JSON.stringify(result), result.costUsd, data.updatedAt, status, ledgerId);
    try {
      this.checkCost(result, entry.hardBudgetUsd);
    } catch (error) {
      update('budget_violation');
      throw error;
    }
    update(null);
    return data;
  }
  async collect(ledgerId: string) {
    const active = this.collecting.get(ledgerId);
    if (active) return active;
    const collection = this.collectSavedRun(ledgerId);
    this.collecting.set(ledgerId, collection);
    try {
      return await collection;
    } finally {
      this.collecting.delete(ledgerId);
    }
  }
  private async collectSavedRun(ledgerId: string): Promise<PaidCollection> {
    let entry = this.history(ledgerId);
    const adapter = this.adapters[entry.operation.actor];
    if (!adapter?.collect || !entry.result || entry.status !== 'submitted')
      throw new Error('Нет сохранённого запуска, доступного для чтения датасета');
    const cached = this.store.db.prepare(`SELECT json_extract(data,'$.datasetMaterials') AS materials
      FROM company_research_paid_ledger WHERE id=?`).get(ledgerId)?.materials;
    if (typeof cached === 'string')
      return { status: 'ready', run: entry.result.data, result: JSON.parse(cached), cached: true };

    const inProgress = ['READY', 'RUNNING', 'TIMING-OUT', 'ABORTING'];
    if (inProgress.includes(entry.result.data.status))
      entry = await this.refresh(ledgerId, true);
    const run = entry.result.data;
    if (inProgress.includes(run.status)) return { status: 'pending', run };
    if (run.status !== 'SUCCEEDED' || !run.datasetId) return { status: 'unavailable', run };

    const result = await adapter.collect(entry.operation, run);
    this.store.db.prepare(`UPDATE company_research_paid_ledger
      SET data=json_set(data,'$.datasetMaterials',json(?)) WHERE id=?`).run(JSON.stringify(result), ledgerId);
    return { status: 'ready', run, result, cached: false };
  }
  normalize(ledgerId: string, rows: unknown) {
    const entry = this.history(ledgerId);
    const adapter = this.adapters[entry.operation.actor];
    if (!adapter?.normalize || !entry.result)
      throw new Error('Нет сохранённого результата запуска');
    return adapter.normalize(entry.operation, entry.result.data, rows);
  }
  private checkCost(result: PaidResult, budget: number) {
    if (result.costUsd === null && result.status === 'submitted') return;
    if (
      typeof result.costUsd !== 'number' ||
      !Number.isFinite(result.costUsd) ||
      result.costUsd < 0 ||
      result.costUsd > budget
    )
      throw new Error('Провайдер нарушил hard budget; проверить расходы перед новым согласием');
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
          hardBudgetUsd: Math.min(operation.maxCostUsd, grant.quote.upperBoundUsd),
          at: new Date().toISOString(),
          operation,
        }),
      );
      return grant;
    });
    let result: PaidResult | undefined;
    try {
      // The provider cap applies to the Actor run. Result collection uses separate platform usage.
      result = await adapter.execute({
        ...operation,
        hardBudgetUsd: Math.min(operation.maxCostUsd, grant.quote.upperBoundUsd),
      });
      this.checkCost(result, Math.min(operation.maxCostUsd, grant.quote.upperBoundUsd));
      this.store.db.prepare('UPDATE company_research_paid_ledger SET data=? WHERE id=?').run(
        JSON.stringify({
          status: result.status ?? 'completed',
          reservedUsd: operation.maxCostUsd,
          hardBudgetUsd: Math.min(operation.maxCostUsd, grant.quote.upperBoundUsd),
          costUsd: result.costUsd,
          result,
          at: new Date().toISOString(),
          operation,
        }),
        ledgerId,
      );
    } catch (error) {
      this.store.db.prepare('UPDATE company_research_paid_ledger SET data=? WHERE id=?').run(
        JSON.stringify({
          status: 'unknown_or_failed',
          reservedUsd: operation.maxCostUsd,
          hardBudgetUsd: Math.min(operation.maxCostUsd, grant.quote.upperBoundUsd),
          ...(result ? { result, costUsd: result.costUsd } : {}),
          at: new Date().toISOString(),
          operation,
        }),
        ledgerId,
      );
      throw error;
    }
    if (operation.readResults) {
      let collection: PaidCollection | { status: 'failed'; error: string };
      try {
        collection = await this.collect(ledgerId);
      } catch (error) {
        collection = {
          status: 'failed',
          error: error instanceof Error ? error.message : 'Ошибка чтения Apify',
        };
      }
      const recordedResult: PaidResult = this.history(ledgerId).result;
      return { ...recordedResult, ledgerId, collection };
    }
    return { ...result, ledgerId };
  }
}
