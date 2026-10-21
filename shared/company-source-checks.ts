import { providerLabels, type Source } from './model.js';
import type { SourceRun } from './source-tools.js';
import type { CollectionSource } from './company-provenance.js';

export type CompanySourceCheck = {
  id: string;
  name: string;
  checkedAt: string;
  result: string;
  error: boolean;
  url: string;
};

// Only company-scoped attempts belong here. A global feed search, or a saved job,
// does not prove that this employer was checked (especially with zero matches).
export function companySourceChecks(
  companyId: string,
  sources: Source[],
  runs: SourceRun[],
  collected: CollectionSource[],
): CompanySourceCheck[] {
  const checks = new Map<string, CompanySourceCheck>();
  const add = (check: CompanySourceCheck) => {
    const old = checks.get(check.id);
    if (!old || check.checkedAt > old.checkedAt) checks.set(check.id, check);
  };
  for (const run of runs) {
    const source = sources.find((s) => s.id === run.sourceId);
    if ((run.companyId || source?.companyId) !== companyId) continue;
    add({
      id: `api:${run.sourceId}`,
      name: `${providerLabels[run.provider] || run.provider} · ${run.sourceName || source?.name || 'Доска компании'}`,
      checkedAt: run.at,
      result: run.error
        ? `Ошибка: ${run.error}`
        : `Получено ${run.received}; по фильтрам запуска ${run.matched}${run.cached ? ' · из кэша' : ''}`,
      error: !!run.error,
      url: '',
    });
  }
  // Older monitoring attempts may predate the run journal. Do not turn missing
  // counters into zero, or a previous successful sync into a successful retry.
  for (const source of sources.filter((s) => s.companyId === companyId)) {
    const at = source.lastAttempt || source.lastSync;
    if (!at) continue;
    add({
      id: `api:${source.id}`,
      name: `${providerLabels[source.provider] || source.provider} · ${source.name}`,
      checkedAt: at,
      result: source.error
        ? `Ошибка: ${source.error}`
        : 'Проверен; подробный результат не сохранён',
      error: !!source.error,
      url: '',
    });
  }
  const labels: Record<CollectionSource['outcome'], string> = {
    success: 'Проверен',
    empty: '0 результатов',
    error: 'Ошибка',
    partial: 'Частичная проверка',
    cached: 'Из кэша',
  };
  for (const source of collected) {
    if (
      !source.columns.includes('target_vacancies') ||
      !['api', 'web_search', 'web_page'].includes(source.kind)
    )
      continue;
    add({
      id: `research:${source.kind}:${source.name}:${source.url || ''}:${source.query || ''}`,
      name: source.name,
      checkedAt: source.observed_at,
      result: `${labels[source.outcome]} · ${source.description}`,
      error: source.outcome === 'error',
      url: source.url || '',
    });
  }
  return [...checks.values()].sort((a, b) => b.checkedAt.localeCompare(a.checkedAt));
}
