import { createHash } from 'node:crypto';
import type { Store } from './store.js';
import { providerCatalog, type ProviderId } from '../shared/source-tools.js';
import { quota, requestScope } from './provider-quota.js';
export { quota } from './provider-quota.js';

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
    const requestId = store.transaction(() => {
      const exhausted = quota(store, provider).windows.find((w) => w.remaining === 0);
      if (exhausted)
        throw new Error(`Достигнут локальный лимит API: ${exhausted.label} (${exhausted.limit})`);
      const windows = ['adzuna', 'serpapi'].includes(provider)
        ? []
        : provider === 'remotive'
          ? [[6 * 3600000, 1]]
          : [[60000, 60]];
      for (const [ms, limit] of windows) {
        const count = Number(
          store.db
            .prepare('SELECT count(*) AS n FROM provider_requests WHERE provider=? AND at>?')
            .get(provider, new Date(Date.now() - ms).toISOString())?.n || 0,
        );
        if (count >= limit) throw new Error('Лимит частоты запросов; повторите позже');
      }
      return store.db
        .prepare('INSERT INTO provider_requests(provider,at,scope) VALUES (?,?,?)')
        .run(provider, new Date().toISOString(), requestScope(provider)).lastInsertRowid;
    });
    budget.used++;
    const response = await fetcher(url, init);
    if (!response.ok) {
      store.db.prepare("UPDATE provider_requests SET outcome='error' WHERE rowid=?").run(requestId);
      return response;
    }
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
    if (parsed?.error) {
      store.db.prepare("UPDATE provider_requests SET outcome='error' WHERE rowid=?").run(requestId);
      throw new Error('API вернул ошибку; проверьте ключ и параметры');
    }
    const externalId =
      provider === 'serpapi' && typeof parsed?.search_metadata?.id === 'string'
        ? parsed.search_metadata.id.slice(0, 200)
        : '';
    const repeated =
      externalId &&
      store.db
        .prepare(
          "SELECT 1 FROM provider_requests WHERE provider=? AND external_id=? AND outcome='success' LIMIT 1",
        )
        .get(provider, externalId);
    store.db
      .prepare('UPDATE provider_requests SET outcome=?,external_id=? WHERE rowid=?')
      .run(repeated ? 'cached' : 'success', externalId, requestId);
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
