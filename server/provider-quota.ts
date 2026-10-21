import { createHash } from 'node:crypto';
import type { Store } from './store.js';
import type { ProviderQuota, QuotaWindow } from '../shared/source-tools.js';

const DAY = 86400000;
export function requestScope(provider: string) {
  // Jooble issues a separate lifetime allowance for each regional key.
  return provider === 'jooble' && process.env.JOOBLE_API_KEY
    ? createHash('sha256')
        .update(`${process.env.JOOBLE_HOST || 'jooble.org'}|${process.env.JOOBLE_API_KEY}`)
        .digest('hex')
    : '';
}
function positiveLimit(value: string | undefined, fallback: number) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}
export function billingPeriod(anchor: Date, now: Date) {
  const anniversary = (offset: number) => {
    const month = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + offset, 1));
    const lastDay = new Date(
      Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0),
    ).getUTCDate();
    month.setUTCDate(Math.min(anchor.getUTCDate(), lastDay));
    month.setUTCHours(
      anchor.getUTCHours(),
      anchor.getUTCMinutes(),
      anchor.getUTCSeconds(),
      anchor.getUTCMilliseconds(),
    );
    return month;
  };
  let offset =
    (now.getUTCFullYear() - anchor.getUTCFullYear()) * 12 +
    now.getUTCMonth() -
    anchor.getUTCMonth();
  if (anniversary(offset) > now) offset--;
  return { start: anniversary(offset), end: anniversary(offset + 1) };
}
export function quota(store: Store, provider: string, now = new Date()): ProviderQuota {
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const scope = requestScope(provider);
  const window = (
    label: string,
    limit: number,
    start: Date | null,
    end: Date | null,
    resetRule: string,
    rollingMs = 0,
    attempts = false,
  ): QuotaWindow => {
    const rows = store.db
      .prepare(
        `SELECT at FROM provider_requests
      WHERE provider=? AND at<=? AND (?='' OR scope=? OR scope='')
      AND (?=1 OR ?<>'serpapi' OR outcome NOT IN ('error','cached'))
      AND (?='' OR at ${rollingMs ? '>' : '>='} ?)
      ORDER BY at`,
      )
      .all(
        provider,
        now.toISOString(),
        scope,
        scope,
        attempts ? 1 : 0,
        provider,
        start?.toISOString() || '',
        start?.toISOString() || '',
      );
    const used = rows.length;
    return {
      label,
      used,
      limit,
      remaining: Math.max(0, limit - used),
      start: start?.toISOString() || null,
      end: end?.toISOString() || null,
      nextResetAt: rollingMs
        ? rows.length
          ? new Date(Date.parse(String(rows[0].at)) + rollingMs).toISOString()
          : null
        : end?.toISOString() || null,
      resetRule,
    };
  };
  const rolling = (label: string, limit: number, ms: number, attempts = true) =>
    window(
      label,
      limit,
      new Date(now.getTime() - ms),
      null,
      'Скользящее окно: запросы выходят из счётчика по одному по истечении периода.',
      ms,
      attempts,
    );
  let windows: QuotaWindow[] = [];
  let plan = '',
    pricingUrl = '',
    note = '';
  if (provider === 'adzuna') {
    plan = 'Adzuna · personal research';
    pricingUrl = 'https://developer.adzuna.com/docs/terms_of_service';
    windows = [
      window(
        'месяц',
        2500,
        month,
        nextMonth,
        'Локальный календарный месяц: сброс 1-го числа в 00:00 UTC. Границы периода и часовой пояс сброса Adzuna не подтверждены; это локальная оценка.',
      ),
      rolling('7 дней', 1000, 7 * DAY),
      rolling('24 часа', 250, DAY),
      rolling('минута', 25, 60000),
    ];
    note =
      'Считаются все отправленные попытки, включая ошибки. Границы периода и время сброса у провайдера не подтверждены и могут отличаться от локального расчёта.';
  } else if (provider === 'serpapi') {
    const limit = positiveLimit(process.env.SERPAPI_MONTHLY_LIMIT, 250);
    const hourly = positiveLimit(process.env.SERPAPI_HOURLY_LIMIT, 50);
    const value = process.env.SERPAPI_BILLING_ANCHOR || '';
    const anchor = new Date(value);
    const configured =
      /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
      Number.isFinite(anchor.getTime());
    plan = limit === 250 && hourly === 50 ? 'SerpAPI · Free' : 'SerpAPI · настроенный лимит';
    pricingUrl = 'https://serpapi.com/pricing';
    const period = configured ? billingPeriod(anchor, now) : null;
    windows = [
      period
        ? window(
            'цикл',
            limit,
            period.start,
            period.end,
            'Ежемесячно в дату и время начала цикла аккаунта (UTC); короткий месяц — в последний день.',
          )
        : rolling('31 день', limit, 31 * DAY, false),
      rolling('час', hourly, 3600000),
    ];
    note =
      'SerpAPI тарифицирует успешные поиски, включая пустые результаты. Известные ошибки и повторные search ID исключены; старые записи и неопределённый исход учитываются консервативно. Часовой лимит считает все попытки.';
    if (!configured)
      note +=
        ' Дата цикла не задана: показана оценка за последние 31 день. Для точного сброса задайте SERPAPI_BILLING_ANCHOR из аккаунта.';
  } else if (provider === 'jooble') {
    plan = 'Jooble · Free';
    pricingUrl =
      'https://help.jooble.org/en/support/solutions/articles/60001448238-rest-api-documentation';
    windows = [
      window(
        'всего',
        500,
        null,
        null,
        '500 запросов на региональный ключ за всё время. Автоматического сброса нет.',
      ),
    ];
    note =
      'Считаются все попытки для текущего регионального ключа. Старые записи без идентификатора ключа включены консервативно.';
  } else if (provider === 'jobicy') {
    plan = 'Jobicy · public free';
    pricingUrl = 'https://jobicy.com/jobs-rss-feed';
    const last = store.db
      .prepare('SELECT value FROM settings WHERE key=?')
      .get('jobicy:last-feed-pass')?.value;
    note =
      'Месячная/суточная числовая квота не заявлена. Новый проход не чаще раза/час; cursor-страницы последовательно, до 200 записей/страница. Окно 7 дней, задержка 3 ч. Счётчик показывает HTTP-попытки, а не число проходов. Платные ключи и прямые ATS URLs не используются.';
    if (last)
      note += ` Последний старт прохода: ${last}; следующий не ранее ${new Date(Date.parse(String(last)) + 3600000).toISOString()}.`;
  }
  const primary = windows[0];
  const timeZone = 'Europe/Belgrade';
  const dayFormat = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const today = dayFormat.format(now);
  // The local day can span 25 hours at the DST transition. The wider SQL
  // range is narrowed by the actual calendar date before counting.
  const recentRows = store.db
    .prepare(
      "SELECT at,outcome FROM provider_requests WHERE provider=? AND at>=? AND at<=? AND (?='' OR scope=? OR scope='')",
    )
    .all(
      provider,
      new Date(now.getTime() - 26 * 3600000).toISOString(),
      now.toISOString(),
      scope,
      scope,
    );
  const todayRows = recentRows.filter((r) => dayFormat.format(new Date(String(r.at))) === today);
  return {
    last24Hours: {
      attempts: recentRows.filter((r) => Date.parse(String(r.at)) > now.getTime() - DAY).length,
    },
    today: {
      date: today,
      timeZone,
      attempts: todayRows.length,
      counted: todayRows.filter(
        (r) => provider !== 'serpapi' || !['error', 'cached'].includes(String(r.outcome)),
      ).length,
    },
    used:
      primary?.used ??
      Number(
        store.db
          .prepare(
            'SELECT count(*) AS n FROM provider_requests WHERE provider=? AND at>=? AND at<=?',
          )
          .get(provider, month.toISOString(), now.toISOString())?.n || 0,
      ),
    limit: primary?.limit ?? null,
    remaining: primary?.remaining ?? null,
    label: primary?.label || '',
    plan,
    pricingUrl,
    note: note
      ? `${note} Общий журнал Jobs checker для UI, API и MCP. Локальный кэш не расходует квоту. Запросы из других приложений здесь не видны.`
      : '',
    updatedAt: now.toISOString(),
    windows,
  };
}
