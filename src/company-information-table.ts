import { companyInformation } from './company-summary';
import { cleanCompanyText, shortSentences } from './company-presentation';
import { interviewText } from '../shared/company-interviews';
import { sourceUrl } from './company-useful-links';
import type { ComparisonProfile } from './company-comparison';
import type { StoredObservation } from '../shared/company-research';

export type InformationRow = {
  label: string;
  facts: string[];
  sources: Array<{ url: string; title: string; note: string }>;
  notes: string[];
};
const normalized = (s: string) =>
  cleanCompanyText(s)
    .toLocaleLowerCase('ru')
    .replace(/[^\p{L}\p{N}%€$£¥+<>=−–-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const countries = new Intl.DisplayNames(['ru'], { type: 'region' });
const explanation = (text: string) =>
  text
    .replace(
      /(?:Перенос сохранённых сведений[^.]*|Сводка прочитанного первичного материала[^.]*|Факт относится к указанной роли[^.]*|Проверенное содержание источника|Прямое подтверждение в указанном scope|Сохранённая карточка:[^.]*|Сохранённые форматы:[^.]*|Публичная HTML-страница[^.]*|Это не повторная проверка объявления)\.?/gi,
      '',
    )
    .replace(
      /(?:Полный текст известен из поискового индекса[^.]*|Прямое чтение сейчас ограничено[^.]*|Прямой доступ к странице ограничен[^.]*)\.?/gi,
      '',
    )
    .replace(/\s+/g, ' ')
    .trim();
function addFact(facts: string[], text: string) {
  const key = normalized(text);
  const contains = (a: string, b: string) => ` ${a} `.includes(` ${b} `);
  if (!key || facts.some((s) => contains(normalized(s), key))) return;
  const subset = facts.findIndex((s) => contains(key, normalized(s)));
  if (subset >= 0) facts[subset] = text;
  else facts.push(text);
}
function compactValue(o: StoredObservation, fallback: string) {
  if (typeof o.value === 'string') {
    const labels: Record<string, string> = {
      product_data: 'Продуктовая / Data-аналитика',
      bi_de_ml: 'BI / Data Engineering / ML',
      mixed: 'Смешанные обязанности',
    };
    return shortSentences(o.criterion_id === 'AN06' ? labels[o.value] || o.value : o.value, 3, 650);
  }
  if (o.value && typeof o.value === 'object' && !Array.isArray(o.value)) {
    if ('sample_scope' in o.value) {
      const v = o.value;
      const number = (n: number) => new Intl.NumberFormat('ru-RU').format(n);
      const amount =
        v.statistic === 'range'
          ? `${v.min === null ? '…' : number(v.min)}–${v.max === null ? '…' : number(v.max)}`
          : v.amount === null
            ? '—'
            : number(v.amount);
      return `${{ median: 'Медиана', mean: 'Среднее', range: 'Диапазон', individual: 'Отдельный пример' }[v.statistic]} · ${{ total: 'TC', base: 'Базовая зарплата', stock: 'Акции', bonus: 'Бонус', sign_on: 'Разовый бонус' }[v.component]}: ${amount} ${v.currency} / ${{ year: 'год', month: 'месяц', hour: 'час' }[v.period]}. ${v.sample_size === null ? 'N не раскрыт' : `N = ${v.sample_size}`}${v.role_relation === 'related' ? ' · смежная роль' : ''}.`;
    }
    if ('stages' in o.value) return interviewText(o.value);
    if ('summary' in o.value)
      return shortSentences(o.value.summary || o.value.tags.join(' · '), 3, 650);
    if ('modes' in o.value)
      return [
        o.value.modes
          .map((m) => ({ remote: 'Удалённо', hybrid: 'Гибрид', onsite: 'Офис' })[m])
          .join(', '),
        o.value.eligible_countries.length
          ? 'Допустимые страны: ' +
            o.value.eligible_countries.map((c) => countries.of(c) || c).join(', ')
          : '',
        shortSentences(
          explanation(o.reasoning)
            .split(/(?<=[.!?])\s+/)
            .filter(
              (s) =>
                !/^(Поле workplace|Формат из поля|Сохранённ|Перенос|Проверено|Источник)/i.test(s),
            )
            .join(' '),
          2,
          300,
        ),
      ]
        .filter(Boolean)
        .join('. ');
  }
  if (Array.isArray(o.value))
    return o.value
      .map((v) => (['A02_HQ', 'A02_OFFICES'].includes(o.criterion_id) ? countries.of(v) || v : v))
      .join(', ');
  if (o.short_facts?.length) return o.short_facts.join(' · ');
  if (typeof o.value === 'boolean')
    return [o.value ? 'Да.' : 'Нет.', shortSentences(explanation(o.reasoning), 2, 350)]
      .filter(Boolean)
      .join(' ');
  return shortSentences(explanation(fallback), 3, 650);
}
/** One row per information type. Evidence differs without duplicating the answer. */
export function companyInformationRows(p: ComparisonProfile): InformationRow[] {
  const rows = new Map<string, InformationRow>();
  for (const section of companyInformation(p))
    for (const item of section.items) {
      if (
        item.id === 'description' &&
        p.observations.some(
          (o) =>
            !o.rejected &&
            o.criterion_id === 'B04' &&
            typeof o.value === 'string' &&
            o.value.trim() &&
            !o.scope.role &&
            !o.scope.job_url,
        )
      )
        continue;
      const label = item.label === 'Описание компании' ? 'Бизнес-модель' : item.label;
      let row = rows.get(label);
      if (!row) {
        row = { label, facts: [], sources: [], notes: [] };
        rows.set(label, row);
      }
      const observation = p.observations.find((o) => o.id === item.observationIds[0]);
      const body = observation
        ? compactValue(observation, item.body)
        : shortSentences(item.body, 3, 650);
      const scope = observation
        ? [
            observation.scope.country ? countries.of(observation.scope.country) : '',
            observation.scope.city,
            observation.scope.role,
            observation.scope.level &&
            !observation.scope.role?.toLowerCase().includes(observation.scope.level.toLowerCase())
              ? observation.scope.level
              : '',
          ]
            .filter(Boolean)
            .join(' · ')
        : item.scope;
      addFact(row.facts, [scope, body].filter(Boolean).join(' — '));
      const notes = [
        /не проверено/.test(item.notice) ? 'Не проверено' : '',
        /устаревшие|источник 20/.test(item.notice) ? 'Датированные сведения' : '',
        /отзыв/.test(item.notice) ? 'Отзыв' : '',
        /внешняя оценка/.test(item.notice) ? 'Внешняя оценка' : '',
        /низкая уверенность/.test(item.notice) ? 'Низкая уверенность' : '',
      ].filter(Boolean);
      for (const note of notes) if (!row.notes.includes(note)) row.notes.push(note);
      for (const source of item.sources) {
        const url = sourceUrl(source.url);
        if (!url) continue;
        const note = [
          source.published_at?.slice(0, 10),
          observation?.value &&
          typeof observation.value === 'object' &&
          !Array.isArray(observation.value) &&
          'source_updated_at' in observation.value
            ? observation.value.source_updated_at?.slice(0, 10)
            : '',
          source.source_type === 'employee_report' ? 'отзыв' : '',
          source.source_type === 'market_estimate' ? 'рыночный ориентир' : '',
          observation?.reasoning &&
          /требуем|требован|опыт.*не подтверж|внедрение.*не подтверж/i.test(observation.reasoning)
            ? shortSentences(explanation(observation.reasoning), 1, 200)
            : '',
        ]
          .filter(Boolean)
          .join(' · ');
        if (!row.sources.some((s) => s.url === url && s.note === note))
          row.sources.push({ url, title: source.title || new URL(url).hostname, note });
      }
    }
  return [...rows.values()].filter((r) => r.facts.length);
}
