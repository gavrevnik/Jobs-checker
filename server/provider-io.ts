import { createHash } from 'node:crypto';
import type { Store } from './store.js';
import { providerCatalog, type ProviderId } from '../shared/source-tools.js';

export function safeProviderError(error: unknown) {
  if (!(error instanceof Error)) return 'Ошибка источника';
  let text = error.message;
  for (const name of ['ADZUNA_APP_ID', 'ADZUNA_APP_KEY', 'SERPAPI_API_KEY', 'JOOBLE_API_KEY']) {
    const value = process.env[name];
    if (value)
      text = text.replaceAll(value, '[скрыто]').replaceAll(encodeURIComponent(value), '[скрыто]');
  }
  return /https?:\/\/|app_key|api_key|fetch failed|ENOTFOUND/i.test(text)
    ? 'Не удалось подключиться к источнику'
    : text.slice(0, 500);
}
export function providerEnabled(store: Store, provider: string) {
  return (
    store.db.prepare('SELECT value FROM settings WHERE key=?').get(`provider:${provider}`)
      ?.value !== 'false'
  );
}
export function quota(store: Store, provider: string) {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const used = Number(
    store.db
      .prepare('SELECT count(*) AS n FROM provider_requests WHERE provider=? AND at>=?')
      .get(provider, start.toISOString())?.n || 0,
  );
  const limit = provider === 'adzuna' ? 2500 : provider === 'serpapi' ? 250 : null;
  return { used, limit, remaining: limit === null ? null : Math.max(0, limit - used) };
}
export function meteredFetcher(
  store: Store,
  provider: ProviderId,
  budget: { used: number; limit: number; cacheHits: number; observedAt: string },
  fetcher: typeof fetch = fetch,
): typeof fetch {
  return async (url, init) => {
    if (!providerEnabled(store, provider)) throw new Error('Адаптер выключен');
    const key = createHash('sha256')
      .update(`${provider}|${url}|${init?.body || ''}`)
      .digest('hex');
    const cached = store.db
      .prepare('SELECT body, at FROM provider_cache WHERE key=? AND expires>?')
      .get(key, Date.now());
    if (cached) {
      budget.cacheHits++;
      if (!budget.observedAt || String(cached.at) < budget.observedAt)
        budget.observedAt = String(cached.at);
      return new Response(String(cached.body), { headers: { 'Content-Type': 'application/json' } });
    }
    if (budget.used >= budget.limit)
      throw new Error('Достигнут лимит запросов запуска; увеличьте maxRequests');
    store.transaction(() => {
      const monthly = quota(store, provider);
      if (monthly.remaining === 0) throw new Error('Достигнут локальный месячный лимит API');
      const windows =
        provider === 'adzuna'
          ? [
              [60000, 25],
              [86400000, 250],
              [7 * 86400000, 1000],
            ]
          : provider === 'remotive'
            ? [[6 * 3600000, 1]]
            : provider === 'serpapi'
              ? [[3600000, 50]]
              : [[60000, 60]];
      for (const [ms, limit] of windows) {
        const count = Number(
          store.db
            .prepare('SELECT count(*) AS n FROM provider_requests WHERE provider=? AND at>?')
            .get(provider, new Date(Date.now() - ms).toISOString())?.n || 0,
        );
        if (count >= limit) throw new Error('Лимит частоты запросов; повторите позже');
      }
      store.db
        .prepare('INSERT INTO provider_requests(provider,at) VALUES (?,?)')
        .run(provider, new Date().toISOString());
    });
    budget.used++;
    const response = await fetcher(url, init);
    if (!response.ok) return response;
    // Consume a bounded stream before JSON parsing or caching.
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 25_000_000) {
          await reader.cancel();
          throw new Error('Ответ источника слишком большой');
        }
        chunks.push(value);
      }
    }
    let body = Buffer.concat(chunks).toString('utf8');
    for (const name of ['ADZUNA_APP_ID', 'ADZUNA_APP_KEY', 'SERPAPI_API_KEY', 'JOOBLE_API_KEY']) {
      const value = process.env[name];
      if (value)
        body = body
          .replaceAll(value, '[redacted]')
          .replaceAll(encodeURIComponent(value), '[redacted]');
    }
    const parsed = JSON.parse(body);
    if (parsed?.error) throw new Error('API вернул ошибку; проверьте ключ и параметры');
    const observedAt = new Date().toISOString();
    if (!budget.observedAt || observedAt < budget.observedAt) budget.observedAt = observedAt;
    const ttl = providerCatalog.find((p) => p.id === provider)!.ttlHours * 3600000;
    store.db
      .prepare(
        'INSERT INTO provider_cache VALUES (?,?,?,?) ON CONFLICT(key) DO UPDATE SET body=excluded.body,at=excluded.at,expires=excluded.expires',
      )
      .run(key, body, new Date().toISOString(), Date.now() + ttl);
    store.db.prepare('DELETE FROM provider_cache WHERE expires<?').run(Date.now());
    return new Response(body, { headers: { 'Content-Type': 'application/json' } });
  };
}
