# Jobs checker MCP

Company profiles (`jobs_profiles`, `jobs_company_research_profile/list`) включают опциональный `company.hiringSources`: Careers/ATS и LinkedIn identity с evidence/датами/пробелами. Это сохранённые метаданные; отдельные LinkedIn discovery/refresh executor tools не добавлены. Адресный веб-поиск выполняет агент по [правилам](../discovery/hiring-sources.md), а проверенные вакансии передаёт прежнему ATS import. Ссылка LinkedIn Jobs не является API и не подтверждает полноту активного найма.

`jobs_company_research_recalculate({companyIds:[...]})` — итоговый локальный пересчёт сохранённого score/coverage после авторизованного discovery/monitoring, включая давность evidence. Возвращает `scoresCalculatedAt` по компаниям; без companyIds — весь каталог. List/profile и фильтры читают готовые оценки; новый набор observations/review автоматически обновляет снимок. Не меняет факты, verification, job aiScore или dataDrivenScore и не вызывает внешние API.

`npm run mcp` запускает stdio MCP-сервер с двенадцатью инструментами. Локальный jobs-checker должен работать отдельно: `npm start` или штатный запуск из Life Hub. Обёртка обращается только к loopback HTTP API; сама не открывает SQLite и не обращается к провайдерам. Секреты остаются в `.env` локального сервиса.

## Подключение

Из корня проекта, после `npm ci` и `npm run build`:

```sh
codex mcp add jobs-checker -- node --import /ABS/PATH/jobs-checker/node_modules/tsx/dist/loader.mjs /ABS/PATH/jobs-checker/scripts/jobs-mcp.ts
```

Замените `/ABS/PATH` на каталог проекта. Для независимости от PATH можно использовать абсолютный путь к `node`. Альтернатива в `~/.codex/config.toml`:

```toml
[mcp_servers.jobs-checker]
command = "/ABS/PATH/TO/node"
args = ["--import", "/ABS/PATH/jobs-checker/node_modules/tsx/dist/loader.mjs", "/ABS/PATH/jobs-checker/scripts/jobs-mcp.ts"]
tool_timeout_sec = 300
```

Обёртка читает `.env` рядом с `package.json` независимо от текущей директории. `SCOUT_API_URL` по умолчанию `http://127.0.0.1:4317`, либо порт из `PORT`. После добавления подключения может потребоваться переподключение MCP/новый чат. [Официальная инструкция Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

## Инструменты

| Инструмент               | Действие                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------ |
| `jobs_sources_status`    | Адаптеры, состояния, отсутствующие переменные, локальная квота и история             |
| `jobs_discovery_history` | Сохранённые стратегии, результаты и рекомендации прошлых подборок                    |
| `jobs_discovery_save`    | Сохранить/обновить summary поиска, параметры запросов и ID карточек                  |
| `jobs_profiles`          | Профили и компании: получить реальные ID перед вызовами                              |
| `jobs_search`            | План или поиск; `execute=false` по умолчанию; `store=true` пополняет ATS             |
| `jobs_add_company_board` | Добавить компанию/доску и настройки мониторинга, без запроса к провайдеру            |
| `jobs_monitor_companies` | План или проверка due-досок; `execute=true` сохраняет подходящие вакансии            |
| `jobs_enrich`            | Подробности существующей карточки SmartRecruiters; `execute=true`, максимум 1 запрос |
| `jobs_web_search_plan`   | Запросы для web-tools, не самостоятельный веб-поиск                                  |
| `jobs_ats_list`          | Карточки ATS по тексту/этапу и происхождение                                         |
| `jobs_ats_import`        | Предпросмотр проверенных web/MCP результатов; `store=true` записывает                |
| `jobs_ats_update`        | Этап, заметки, избранное и follow-up локальной карточки                              |

Пример аргументов поиска (сначала без `execute`):

```json
{
  "providers": ["arbeitnow", "remotive", "adzuna"],
  "keywords": ["product analyst | product analytics"],
  "exclude": ["intern"],
  "country": "de",
  "location": "Berlin, Germany",
  "locations": [],
  "maxPages": 1,
  "maxRequests": 5,
  "maxItems": 50,
  "store": true
}
```

`profileId` добавляет фильтры выбранного профиля. Явные поля переопределяют его: `locations: []` снимает локальный фильтр географии, `minSalary: null` снимает порог. `country` не выводится из свободного текста профиля. Для board-провайдеров нужны зарегистрированные доски; можно ограничить `sourceIds`. `maxPages` ограничивает discovery; ATS-доски всегда читаются полностью, а `maxRequests` останавливает слишком большой проход без ложного закрытия ролей.

Для исполнения передайте `execute: true` и осмысленный `maxRequests`; по умолчанию 10, максимум 100. Результаты содержат ошибки отдельных адаптеров, количество запросов, нормализованные вакансии и локальные `atsId`, если `store=true`. Отсутствие ключа не мешает другим выбранным провайдерам.

Для отбора агентом сначала выполните поиск с `store=false`, прочитайте описания, затем повторите с `store=true`, выбранными `sourceIds` и `externalIds`. Последнее поле ограничивает запись точными ID отобранных публикаций; остальные фильтры продолжают действовать. Повтор использует общий кэш. Ранее импортированная карточка без привязанного источника обновляется и связывается с ATS при совпадении канонического URL; этап, заметки и AI-оценка сохраняются. Для Greenhouse учитываются повторяющие ID query-параметры, для SmartRecruiters — варианты URL со slug и без него.

Для повторной проверки компаний:

```json
{ "execute": true, "maxRequests": 30 }
```

В `jobs_monitor_companies` это проверяет только включённые доски с `monitoring=true`, для которых прошёл интервал. Фоновый планировщик пока не установлен.

CLI использует те же операции:

`jobs_ats_update` также сохраняет `aiScore` (0–10), `aiSummary` (вывод для списка), `aiReason` (подробное обоснование с пробелами и ограничениями), `aiProfileId`, `aiReviewedAt` и `aiEvidenceUrls`. Оценивать после чтения полного описания и профиля; неизвестные языки, sponsorship и право на работу не считать подтверждёнными. Обновление вакансии источником не пересчитывает оценку автоматически.

```sh
npm run tools -- status
npm run tools -- search '{"providers":["arbeitnow"],"keywords":["analyst"]}'
npm run tools -- monitor '{"execute":true,"maxRequests":20}'
```

Проверки: `npm test`, `npm run build`, `npm run test:http`, `npm run test:mcp`. `npm run test:providers:live` отдельно делает небольшие реальные запросы только к бесплатным API на изолированной базе.

## Фильтры Adzuna

В `jobs_search` передавайте `adzuna: {"what_phrase":"product analyst","salary_min":60000,"salary_include_unknown":true,"max_days_old":14,"full_time":true}` вместе с `providers:["adzuna"]` и `country:"es"`. Для чистого провайдерного запроса без локального отбора профиля задайте `keywords:[]`, `locations:[]`, `minSalary:null`, `seniority:"any"`, `workMode:"any"`, `exclude:[]`. Явные `what`/`what_and`/`what_or`/`what_phrase`/`title_only` создают один запрос Adzuna вместо отдельных запросов по keywords; фильтры профиля всё равно применяются после ответа. [Полный список, ограничения и пример](ADZUNA_FILTERS.md).

## Память стратегии

Перед новой подборкой вызовите `jobs_discovery_history` (`profileId` необязателен, `limit` 1–100, по умолчанию 20). По окончании `jobs_discovery_save` сохраняет `id`, `title`, `profileId`, `summary`, `nextSearches`, `queries` (label, parameters поиска, requests, received, notes), `stats` (requests, returned, unique, added), `jobIds`. Один и тот же `id` обновляет запись без дубля; `createdAt` сохраняется. Это чтение/запись локальной памяти без внешних запросов.

## Company research

Дополнительный workflow research JSON 1.0, comparison/profile/criteria, preview/apply, review, priority, plan и history описан в [discovery/README.md](../discovery/README.md#http--mcp). Он использует прежний loopback сервер и SQLite, не вызывает providers при чтении/preview и не изменяет ATS/CRM. MCP tools `jobs_company_research_*` доступны после перезапуска MCP wrapper; wrapper пишет только через HTTP.

Company research registry 1.2: `AN09_CULTURE` — descriptive `{summary,tags}`; JSON 1.0 поддерживает optional `collection_sources` на компанию. List/profile возвращают `columnSources` по четырём первым колонкам. [Порядок API → web → сводка модели и правила provenance](../discovery/comparison-columns.md).

## Ручные сценарии LLM и Jobicy

Скиллы [discovery](../.agents/skills/jobs-discovery/SKILL.md), [monitoring](../.agents/skills/jobs-monitoring/SKILL.md), [pool review](../.agents/skills/jobs-pool-review/SKILL.md) используют существующие tools и [общие правила](../discovery/workflow-common.md), без нового расписания. `jobs_monitor_companies` остаётся мониторингом зарегистрированных ATS; агентский monitoring дополнительно использует search/web по пробелам.

`jobs_search({providers:["jobicy"], execute:false})` — план без сети. Для разрешённого прохода execute=true, maxRequests/maxPages; store=true сохраняет результаты в общую ATS. Jobicy не требует ключа; общий feed скачивается один раз и фильтруется локально. Часовой guard сохраняется между процессами и считает новые проходы, не cursor-страницы. `jobs_sources_status` возвращает десять адаптеров, в том числе Jobicy; запросы, кэш и история используют прежние таблицы. `jobs_web_search_plan` включает Workday как web-канал, но не выполняет поиск.

Registry 1.4 добавляет descriptive `T08_INFRA` с `{summary,tags}` и `collection_sources.columns`/`columnSources.infrastructure`. JSON research остаётся 1.0; новый criterion_id проходит прежний preview/import/review. Таблица переносит проверенный стек в «Инфраструктуру», T03=true в LLM-тег культуры; удаление колонок не удаляет факты или оценки API. [Правила тегов](../discovery/analytics-tags.md).

Arbeitnow: `jobs_search({providers:["arbeitnow"],country:"gb",execute:false})` планирует британскую ленту. Пустой country или `de` сохраняет прежнюю немецкую; другие рынки для этого провайдера отклоняются. UK sourceId — `discovery:arbeitnow:gb`. Оба рынка используют прежние cache/quota adapters, новые credentials не нужны.
