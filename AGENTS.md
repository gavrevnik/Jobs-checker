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

## Общие коннекторы и Knowledge

- Provider API/transport implementations находятся в [Personal Radar connectors](../personal-radar/connectors/README.md); SQLite, domain filters/dedupe/AI/UI и прикладные MCP остаются здесь. Сохранять обязательные quota adapters; тестировать внешние операции mocks на фактическом общем модуле.
- `personal-radar/knowledge` — канонический каталог долгосрочных знаний. Текущие SQLite-профили, источники/интересы и реакции сохраняются без автоматической миграции. Следовать [границам владения](../personal-radar/docs/storage-boundaries.md); не добавлять auto outbox, GitHub writes или двусторонний sync из пользовательских действий.
- Discovery возвращает source-кандидатов: name/URL/platform/external IDs/description/provenance/evidence/relevance. Review/deduplication по стабильной identity предшествуют потенциальному переносу подтверждённых источников в Knowledge отдельным запросом. Разрешённые локальные импорты продолжают использовать прежние tools/flags/budgets; discovery/digest не разрешают запись Knowledge.
