import type { SalaryBenchmarkValue } from '../shared/company-research';

export function salaryBenchmarkText(v: SalaryBenchmarkValue) {
  const money = (amount: number) =>
    new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(amount) + ' ' + v.currency;
  const amount =
    v.statistic === 'range'
      ? [v.min === null ? '' : 'от ' + money(v.min), v.max === null ? '' : 'до ' + money(v.max)]
          .filter(Boolean)
          .join(' ')
      : money(v.amount!);
  return [
    'Levels.fyi · рыночный ориентир, не условие вакансии.',
    `${{ median: 'Медиана', mean: 'Среднее', range: 'Диапазон', individual: 'Отдельное сообщение' }[v.statistic]} · ${{ total: 'Total compensation', base: 'Базовая зарплата', stock: 'Акции / equity', bonus: 'Бонус', sign_on: 'Разовый sign-on' }[v.component]}: ${amount} / ${{ year: 'год', month: 'месяц', hour: 'час' }[v.period]}.`,
    v.role_relation === 'related'
      ? 'Смежная роль; не подставлять вместо зарплаты Product/Data Analyst.'
      : '',
    v.sample_size === null
      ? 'Размер выборки: не раскрыт.'
      : `Размер выборки: N=${v.sample_size} (${{ role_country_level: 'роль + страна + грейд', role_country: 'роль + страна', company_role: 'компания + роль; охват страны/грейда не подтверждён', individual: 'одно сообщение', not_disclosed: 'область не раскрыта' }[v.sample_scope]}).`,
    'Обновление источника: ' + (v.source_updated_at?.slice(0, 10) || 'не указано') + '.',
    v.sample_period ? 'Период выборки: ' + v.sample_period : 'Период выборки не раскрыт.',
    v.notes,
  ]
    .filter(Boolean)
    .join('\n\n');
}
