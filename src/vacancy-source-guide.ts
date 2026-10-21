import { boardProviders, type ProviderId, type ProviderView } from '../shared/source-tools';

export const sourceNotes: Record<ProviderId, string> = {
  adzuna: 'Испания и другие рынки; поиск по роли и локации.',
  serpapi: 'Google Jobs: агрегаторы и Careers. Нужен отдельный бюджет.',
  jooble: 'Рынок регионального ключа; дополнительный охват.',
  arbeitnow: 'Германия (de) и Великобритания (gb); tech-вакансии, отдельные ленты.',
  remotive: 'Удалённые роли; публикации с задержкой. География допуска указана в вакансии.',
  jobicy: 'Удалённые роли за 7 дней; ссылки ведут на Jobicy.',
  greenhouse: 'Официальные доски компаний; описания и отделы.',
  lever: 'Официальные доски Global / EU; описания и зарплаты.',
  ashby: 'Официальные доски; локации и опубликованная оплата.',
  smartrecruiters: 'Официальные доски; полное описание — отдельный запрос.',
};

export function sourceConnection(p: ProviderView) {
  if (!p.enabled) return { connected: false, label: 'Выключен' };
  if (p.missing.length) return { connected: false, label: 'Не настроен' };
  if (boardProviders.includes(p.id) && !p.connections)
    return { connected: false, label: 'Нет досок' };
  return {
    connected: true,
    label:
      p.status === 'error'
        ? 'Последний запрос с ошибкой'
        : boardProviders.includes(p.id)
          ? `Досок: ${p.connections}`
          : 'Готов к запуску',
  };
}

const periods: Record<string, string> = {
  месяц: 'в месяц',
  цикл: 'за расчётный месяц',
  '31 день': 'за 31 день',
  '7 дней': 'за 7 дней',
  '24 часа': 'за 24 часа',
  всего: 'на ключ · без сброса',
};
const number = (value: number) => new Intl.NumberFormat('ru-RU').format(value);
const requestWord = (value: number) => {
  const form = new Intl.PluralRules('ru').select(value);
  return form === 'one' ? 'запрос' : form === 'few' ? 'запроса' : 'запросов';
};

export function sourceLimits(p: ProviderView): string[] {
  const result = p.quota.windows
    .filter((w) => periods[w.label])
    .map(
      (w) => `${number(w.used)} / ${number(w.limit)} ${requestWord(w.limit)} ${periods[w.label]}`,
    );
  if (!result.length) {
    if (p.id === 'remotive') {
      const daily = p.quota.last24Hours;
      result.push(`${daily ? number(daily.attempts) : '—'} / 4 запроса за 24 часа`);
    } else {
      const today = p.quota.today;
      result.push(
        today
          ? `${number(today.attempts)} ${requestWord(today.attempts)} сегодня`
          : 'Расход за сегодня неизвестен',
      );
      result.push('Суточная квота не заявлена');
    }
  }
  if (p.id === 'jobicy') result.push('Один проход за раз; страницы последовательно');
  if (p.quota.windows.some((w) => w.remaining === 0)) result.push('Пауза: лимит исчерпан');
  return result;
}
