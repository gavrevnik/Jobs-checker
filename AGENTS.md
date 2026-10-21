# Repository instructions

When this checkout is inside `life-stack`, first read the shared [workspace instructions](../AGENTS.md) if they have not already been loaded. This file supplies project-specific overrides. If the shared file is absent in a standalone clone, continue with this file.

- Communicate with the user in Russian unless they request another language.
- Preserve unrelated changes and never publish, delete, or rewrite data without an explicit request.
- The canonical repository is https://github.com/gavrevnik/Jobs-checker.
- The default branch is `master`.
- The live SQLite database is `../data/jobs-checker/scout.sqlite` in the standard `life-stack` layout. `SCOUT_DB` may override it.
- Never use the live database in tests. Tests must use temporary SQLite databases.
- Keep API keys only in the ignored `.env`; never include them in source, fixtures, logs, or chat output.
- Update `README.md` when setup, storage, providers, or user-visible behavior changes.
- Before handing off code changes, run `npm test`, `npm run build`, and relevant focused verification.

## Ручные Jobs workflows

- Новые компании и повторный ресерч: [jobs-discovery](.agents/skills/jobs-discovery/SKILL.md).
- Вакансии известных компаний: [jobs-monitoring](.agents/skills/jobs-monitoring/SKILL.md).
- Пересмотр пула и предложения резерва/архива: [jobs-pool-review](.agents/skills/jobs-pool-review/SKILL.md).
- [Общие правила](discovery/workflow-common.md) и [Careers/ATS/веб-источники](discovery/hiring-sources.md) сохраняют единые контракты. Скиллы не включают расписание автоматически.

## Общие коннекторы и Knowledge

- Provider API/transport implementations находятся в [Personal Radar connectors](../personal-radar/connectors/README.md); SQLite, domain filters/dedupe/AI/UI и прикладные MCP остаются здесь. Сохранять обязательные quota adapters; тестировать внешние операции mocks на фактическом общем модуле.
- `personal-radar/knowledge` — канонический каталог долгосрочных знаний. Текущие SQLite-профили, источники/интересы и реакции сохраняются без автоматической миграции. Следовать [границам владения](../personal-radar/docs/storage-boundaries.md); использовать [Catalog Sync](../personal-radar/docs/catalog-sync.md): mapping/cache, атомарный outbox только однозначных canonical fields, ручной flush; discovery/new/conflict — pending review, без автоматического GitHub publish.
- Discovery возвращает source-кандидатов: name/URL/platform/external IDs/description/provenance/evidence/relevance. Review/deduplication по стабильной identity предшествуют потенциальному переносу подтверждённых источников в Knowledge отдельным запросом. Разрешённые локальные импорты продолжают использовать прежние tools/flags/budgets; discovery/digest не разрешают запись Knowledge.

- Catalog Sync: before schema/pull/review/flush changes create WAL-aware verified SQLite backup; tests use synthetic temporary DB/YAML. Preserve Radar IDs, local overrides, notes/CRM/workflow/consumption state. Never approve pending review heuristically; source interest ≠ enabled/favorite, AI ≠ personal liked. GET /api/catalog is local/cached; no automatic startup GitHub sync.
