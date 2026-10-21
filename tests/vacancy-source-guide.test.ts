import { describe, expect, it } from 'vitest';
import { providerCatalog, type ProviderView, type QuotaWindow } from '../shared/source-tools';
import { sourceConnection, sourceLimits } from '../src/vacancy-source-guide';

const provider = (id: ProviderView['id'], extra: Partial<ProviderView> = {}): ProviderView => ({
  ...providerCatalog.find((p) => p.id === id)!,
  enabled: true,
  missing: [],
  status: 'ready',
  connections: 0,
  lastRun: '',
  error: '',
  quota: {
    used: 0,
    limit: null,
    remaining: null,
    label: '',
    plan: '',
    note: '',
    pricingUrl: '',
    updatedAt: '',
    windows: [],
    today: { date: '2026-10-20', timeZone: 'Europe/Belgrade', attempts: 3, counted: 3 },
    last24Hours: { attempts: 4 },
  },
  ...extra,
});
const window = (label: string, used: number, limit: number): QuotaWindow => ({
  label,
  used,
  limit,
  remaining: limit - used,
  start: null,
  end: null,
  nextResetAt: null,
  resetRule: '',
});
const plain = (lines: string[]) => lines.map((s) => s.replace(/\s/g, ' '));

describe('Compact source guide', () => {
  it('requires enabled credentials for search, and an actual board for ATS; preserves last-run errors', () => {
    expect(sourceConnection(provider('adzuna')).connected).toBe(true);
    expect(sourceConnection(provider('adzuna', { missing: ['ADZUNA_APP_KEY'] })).connected).toBe(
      false,
    );
    expect(sourceConnection(provider('adzuna', { enabled: false })).connected).toBe(false);
    expect(sourceConnection(provider('greenhouse')).connected).toBe(false);
    expect(sourceConnection(provider('greenhouse', { connections: 2 })).connected).toBe(true);
    expect(sourceConnection(provider('adzuna', { status: 'error' }))).toEqual({
      connected: true,
      label: 'Последний запрос с ошибкой',
    });
  });
  it('shows used/limit for day and longer windows and omits minute/hour details', () => {
    const p = provider('adzuna');
    p.quota.windows = [
      window('месяц', 15, 2500),
      window('7 дней', 10, 1000),
      window('24 часа', 2, 250),
      window('минута', 1, 25),
    ];
    expect(plain(sourceLimits(p))).toEqual([
      '15 / 2 500 запросов в месяц',
      '10 / 1 000 запросов за 7 дней',
      '2 / 250 запросов за 24 часа',
    ]);
    p.quota.windows = [window('31 день', 17, 250), window('час', 1, 50)];
    expect(sourceLimits(p)).toEqual(['17 / 250 запросов за 31 день']);
    p.quota.windows = [window('цикл', 17, 250), window('час', 50, 50)];
    expect(sourceLimits(p)).toEqual([
      '17 / 250 запросов за расчётный месяц',
      'Пауза: лимит исчерпан',
    ]);
  });
  it('does not invent a daily quota or a monthly reset for lifetime keys', () => {
    const p = provider('jooble');
    p.quota.windows = [window('всего', 15, 500)];
    expect(sourceLimits(p)).toEqual(['15 / 500 запросов на ключ · без сброса']);
    expect(sourceLimits(provider('ashby'))).toEqual([
      '3 запроса сегодня',
      'Суточная квота не заявлена',
    ]);
    expect(sourceLimits(provider('remotive'))).toEqual(['4 / 4 запроса за 24 часа']);
    const unknown = provider('remotive');
    delete unknown.quota.last24Hours;
    expect(sourceLimits(unknown)).toEqual(['— / 4 запроса за 24 часа']);
  });
});
