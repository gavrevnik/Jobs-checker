# Локальный API

`Company.sourceLinks` — опциональный каталог публичных ссылок в прежнем company JSON: `{label,url,kind,parentUrl?,note?}[]` (до 300); kind = blog/article/careers/ats/linkedin/profile/other. `parentUrl` связывает использованную статью с сохранённой главной блога. Company PATCH и export/import сохраняют каталог; редактирование без этого поля его не стирает. Это дополнение к evidence/hiringSources, не замена исходных свидетельств и не подтверждение активности вакансий.

`Company.hiringSources` — опциональная структура в прежнем company JSON: `checkedAt`, `careers` (URL/status/evidence), `ats[]` (provider/board/URL/status/evidence), `linkedin` (canonical profileUrl, необязательный числовой externalCompanyId, identityStatus confirmed/slug_only/needs_review, evidence), `notes`. Evidence содержит evidenceUrls/evidence/checkedAt/verificationMethod. Точная схема: `shared/company-hiring.ts`. Company PATCH и JSON export/import сохраняют эти поля; обычное редактирование без hiringSources не стирает прежнюю identity. Подтверждённый LinkedIn URL/Company ID нельзя связать со второй компанией. Для снятия связи передайте `linkedin:null` внутри существующего hiringSources. Company Research profile возвращает исходную company-структуру вместе с прежними targetVacancies. Это метаданные источников, не отдельный LinkedIn executor и не подтверждение активности всех вакансий.

`PATCH /api/jobs/:id` поддерживает AI-оценку: `aiScore` (0–10/null), `aiSummary`, `aiReason`, `aiProfileId`, `aiReviewedAt`, `aiEvidenceUrls`. Она сохраняется отдельно от автоматического совпадения с фильтрами; источники её не пересчитывают. `POST /api/source-tools/search` принимает `externalIds` для записи только выбранных после исследования публикаций.

Базовый адрес: `http://127.0.0.1:4317/api`. Для записи обязателен `Content-Type: application/json`. Чужие Origin и Host отклоняются. Нет CORS-доступа из сторонних сайтов. Авторизация не нужна: сервер предназначен для одного пользователя на loopback.

| Метод  | Путь              | Назначение                                                   |
| ------ | ----------------- | ------------------------------------------------------------ |
| GET    | `/health`         | Статус сервера и синхронизации                               |
| GET    | `/state`          | Компании, вакансии, профили, источники                       |
| POST   | `/jobs`           | Вакансия, минимум `title`, `company`; ответ `{job, created}` |
| PATCH  | `/jobs/:id`       | Частичное изменение, например `{"stage":"applied"}`          |
| DELETE | `/jobs/:id`       | Удаление вакансии                                            |
| POST   | `/companies`      | Компания, минимум `name`                                     |
| PATCH  | `/companies/:id`  | Частичное изменение компании                                 |
| POST   | `/profiles`       | Новый профиль                                                |
| PATCH  | `/profiles/:id`   | Полные настройки профиля                                     |
| DELETE | `/profiles/:id`   | Удаление, должен остаться хотя бы один профиль               |
| POST   | `/sources`        | Источник: `provider`, `name`, для ATS также `board`          |
| PATCH  | `/sources/:id`    | Например `{"enabled":false}`                                 |
| DELETE | `/sources/:id`    | Удаление источника с сохранением вакансий                    |
| POST   | `/sync`           | `{}` — все включённые; `{"sourceId":"..."}` — один           |
| POST   | `/import/preview` | Валидация и предпросмотр импорта                             |
| POST   | `/import`         | Транзакционный импорт, ответ `{added, skipped, companies}`   |
| GET    | `/export`         | Скачивание JSON, без API-ключей                              |
| POST   | `/demo`           | Добавление вымышленных примеров                              |
| DELETE | `/demo`           | Удаление записей, помеченных demo                            |

Схемы и все допустимые поля определены в `shared/model.ts`. Примеры — в `examples/`.

Компания дополнительно поддерживает:

- `description`: краткое описание, до 2 000 символов; для ленты рекомендуется 2–5 предложений.
- `companyType`: `fintech`, `saas`, `marketplace`, `consumer`, `gaming`, `edtech`, `healthtech`, `retail`, `media`, `services`, `nonprofit`, `other`. `industry` хранит уточняющую сферу свободным текстом.
- `sizeCategory`: `unknown`, `small` (до 50), `medium` (51–200), `growth` (201–1 000), `large` (1 001–5 000), `enterprise` (более 5 000). `size` — пояснение и основание диапазона; код категории сам по себе не подтверждает темп роста.
- `workModes`: массив `remote`, `hybrid`, `onsite`. У вакансии остаётся собственный `workMode`, условия найма не выводятся из общего формата компании.
- `checkedAt`: дата проверки информации `YYYY-MM-DD` или `""`; независима от технической даты редактирования `updatedAt`.
- `origins`: до 15 объектов `{ "label": "Ashby", "url": "https://jobs.ashbyhq.com/company" }`; ссылка необязательна. Это источник появления компании, не просто сайт, использованный для проверки размера.
- `dataDrivenScore`: целое 1–10 либо `null`; `dataDrivenEvidence`: обоснование до 4 000 символов; `evidenceUrls`: до 20 проверочных ссылок.

Старые SQLite-записи и импорты без этих полей получают пустые значения, `unknown` и `null` при чтении. `PATCH /companies/:id` сохраняет непереданные поля, включая пользовательские заметки и статус. Импорт существующей компании с тем же именем **не обогащает** её: для обновления нужен PATCH. Все новые поля входят в JSON-экспорт.

Профили дополнительно поддерживают `notes` (контекст, до 10 000 символов, без влияния на оценку) и `seniority: "middle_plus"` (middle, senior или lead). В `keywords` символ `|` разделяет синонимы внутри одного критерия: `"product analyst | product analytics"`. Запись в массиве даёт баллы один раз при совпадении любого синонима. Эти поля сохраняются при JSON-экспорте и импорте. `middle_plus` предназначен только для профиля, не для отдельной вакансии.

Вакансия: `title`, `company`, `url`, `location`, `workMode`, `seniority`, `salaryMin`, `salaryMax`, `currency`, `salaryPeriod`, `salaryText`, `tags`, `description`, `notes`, `stage`, `favorite`, `followUp`, `source`, `externalId`, `publishedAt`.

- `stage`: `new`, `saved`, `applied`, `interview`, `offer`, `archived`.
- `workMode`: `remote`, `hybrid`, `onsite`, `unknown`.
- `seniority`: `intern`, `junior`, `middle`, `senior`, `lead`, `unknown`.
- `salaryPeriod`: `year`, `month`, `hour`, `unknown`.
- `salaryMin` и `salaryMax`: числа либо `null`, не строки.
- `tags`: массив строк.
- `followUp`: `YYYY-MM-DD` либо пустая строка.
- `source` для подборок из чата: `import`.

В JSON импортируется объект с массивами `companies`, `jobs`, опционально `profiles` и `sources`. Пустые массивы разрешены, но нужна хотя бы одна сущность. До 5 000 вакансий и 5 000 компаний, до 20 МБ на запрос. Неизвестные поля игнорируются. При импорте экспорта также сохраняются история и даты вакансий, восстанавливается привязка к импортированным источникам. ID новых записей генерируются локально.

Сервер не получает произвольные URL для скачивания: хосты API заданы в коде, параметр `board` — короткий идентификатор. URL источника из интерфейса преобразуется в идентификатор до запроса. Внешние описания отображаются текстом. API-ключи Adzuna остаются в переменных окружения сервера.

## Источники и API tools

| Метод | Путь                          | Назначение                                                                                                     |
| ----- | ----------------------------- | -------------------------------------------------------------------------------------------------------------- |
| GET   | `/source-tools`               | Каталог, состояние адаптеров, имена недостающих ключей, локальные квоты, доски, наблюдения и последние запуски |
| PATCH | `/source-tools/providers/:id` | `{ "enabled": false }` — отключить адаптер для UI, sync и MCP                                                  |
| POST  | `/source-tools/search`        | План/поиск; схема `searchSchema` в `shared/source-tools.ts`                                                    |
| POST  | `/source-tools/boards`        | Регистрация ATS-доски; provider, name, board; опционально companyId/profileId/region/monitoring/intervalHours  |
| POST  | `/source-tools/monitor`       | Due-доски; sourceIds, execute=false, maxRequests=30                                                            |
| POST  | `/source-tools/enrich`        | SmartRecruiters: jobId, execute=false; максимум один запрос деталей                                            |
| POST  | `/source-tools/web-plan`      | Сформировать web-search запросы по фильтрам, без внешнего вызова                                               |
| POST  | `/source-tools/ats`           | query, stage, limit — чтение ATS и наблюдений                                                                  |

`search`: adzuna, providers, sourceIds, profileId, keywords, exclude, locations, workMode, seniority, minSalary, currency, salaryPeriod, country, location, maxAgeDays, includeUnknownDate, maxPages, maxRequests, maxItems, execute, store. По умолчанию execute=false и store=false. Примеры и точная семантика в [MCP.md](MCP.md).

Провайдеры: greenhouse, lever, ashby, smartrecruiters, arbeitnow, remotive, jobicy, adzuna, serpapi, jooble. Новые записи страны больше не получают GB автоматически: country передаётся явно, для Adzuna/Jooble необходим. Существующие значения в базе сохраняются.

Состояние загрузки общее для операций источников; конфликтующий вызов возвращает 409. Провайдерные ошибки изолируются внутри результата поиска. При пагинации, оборванной лимитом, частичная выборка этого провайдера не записывается. Неподдерживаемый идентификатор доски/URL отклоняется; внешние HTTP-хосты заданы адаптером.

SQLite дополнена таблицами provider_requests/provider_cache/source_runs/job_observations; миграция дополняет структуры без сброса существующих данных. JSON-экспорт не содержит кэш, журнал запросов и наблюдения; полная резервная копия — SQLite. Импорт экспортированных досок переназначает ID компаний/профилей на локальные.

`GET /source-tools` и MCP `jobs_sources_status` возвращают `providers[].quota`: `used`, `limit`, `remaining`, `label`, `plan`, `pricingUrl`, `note`, `updatedAt` и `windows[]`. Каждое окно содержит `used/limit/remaining`, `start/end`, `nextResetAt` и `resetRule`; время — ISO UTC. В скользящем окне `nextResetAt` означает выход старейшего запроса, а не обнуление всего счётчика. Для lifetime Jooble дата сброса отсутствует. Чтение статуса не вызывает API провайдера. Та же функция проверяет квоты перед сетевым вызовом.

Миграция SQLite v3 добавляет в существующий `provider_requests` поля `scope` (хэш регионального ключа Jooble), `outcome` (`unknown`, `success`, `error`, `cached`) и `external_id` (SerpAPI search ID). Старые строки сохраняются с неизвестным исходом. Ни URL запроса, ни секреты не записываются. Временные окна вычисляются при чтении, очистка истории для сброса не требуется. Настройка расчётного цикла и лимитов SerpAPI описана в README и `.env.example`.

Блок `adzuna` передаёт проверенные нативные фильтры только этому провайдеру. В dry-run `targets[].params` показывает фактические параметры без секретов, `country` и `page` — рынок и начальную страницу. Неизвестные поля блока и противоречивые диапазоны отклоняются до внешних запросов. [Список и семантика](ADZUNA_FILTERS.md).

`POST /source-tools/discovery-history` читает `{reviews}` по `profileId`/`limit`. `POST /source-tools/discovery-review` валидирует и сохраняет summary по схеме `shared/discovery-review.ts`; таблица `discovery_reviews` создаётся дополнительно без изменения старых карточек. Подробности полей — в MCP.md.

## Company research

Дополнительный workflow research JSON 1.0, comparison/profile/criteria, preview/apply, review, priority, plan и history описан в [discovery/README.md](../discovery/README.md#http--mcp). Он использует прежний loopback сервер и SQLite, не вызывает providers при чтении/preview и не изменяет ATS/CRM. MCP tools `jobs_company_research_*` доступны после перезапуска MCP wrapper; wrapper пишет только через HTTP.

`GET /api/company-research/:id/plan` также возвращает `jobMaterials`: все непустые сохранённые описания этого companyId, включая архив/closed/stale/unverified, независимо от country и целевого грейда. Каждая запись содержит `origin=saved_ats`, исходный `job` без личных заметок/AI/CRM, provider/sourceId, availability, researchUse, publishedAt/observedAt/savedAt и рекомендуемый scope. `researchUse=historical` задаёт `scope.context=historical_job`, который исключается из текущих оценок и тегов. Дата выгрузки не меняет даты evidence; пустое observedAt означает неизвестное наблюдение. [Правила обработки](../discovery/historical-job-materials.md).

List/profile включают `scoresCalculatedAt`: score/coverage/criteria/highlights берутся из сохранённого снимка, одинакового при повторных чтениях и смене country/profileId. При первом чтении или изменении observations/review/registry обновляется только производный кэш `company_research_scores`; факты и подтверждения не меняются. `POST /api/company-research/recalculate` с `{companyIds:[...]}` явно пересчитывает выбранные компании на текущую дату в конце discovery/monitoring; `{}` означает весь каталог. Возвращает `{companies:[{companyId,scoresCalculatedAt}]}`; пустой список, неизвестные ID и лишние поля дают 400. Не вызывает providers и не меняет job aiScore/dataDrivenScore. Кнопка обновления таблицы этот POST не вызывает.

## Проекция целевых вакансий компаний

`GET /api/company-research` и `GET /api/company-research/:id` включают `targetVacancies` версии 1.0: companyId, total, open, jobIds, jobs, offices, sources, contract. Это read-only проекция общей ATS со всеми API-провайдерами, включая Adzuna; новые SQLite-записи не создаются. Target = Middle/Senior Product/Data Analyst, независимо от текущего profileId/country. `jobIds` открывают те же карточки ATS, включая архив; счётчик total не ограничен 30 днями, open ограничен свежестью проверки. Условия остальных колонок сохраняют прежний country/profile контекст. [Поля, источники дат, границы и UI-контракт](../discovery/comparison-columns.md).

## Аналитическая культура и источники колонок

Registry 1.2, JSON research 1.0: новый descriptive `AN09_CULTURE` принимает `{summary,tags}`; не участвует в score. `companies[].collection_sources` опционально сохраняет происхождение API/web/model по целевым колонкам внутри существующей истории runs. Company-research list/profile возвращают `columnSources` для company/business/target_vacancies/analytics_culture. Старые импорты без поля продолжают работать. [Контракт и порядок сбора](../discovery/comparison-columns.md).

`providers[].quota.today` в `GET /source-tools` содержит `date`, `timeZone` (Europe/Belgrade), `attempts` и `counted`. Сетевые попытки считаются по местному календарному дню с учётом DST; для SerpAPI известные error/cached не входят в counted, unknown учтён консервативно. Локальные cache hits без HTTP не создают попыток. Это журнал Jobs Checker, не сверка баланса провайдера. Общий `/sync` пропускает SerpAPI; запуск отдельного SerpAPI sourceId и явный providers:[serpapi] в `/source-tools/search` остаются доступны.

Jobicy: `POST /api/source-tools/search` с `providers:["jobicy"]`, `execute:false` по умолчанию; store=true при execute=true использует прежний ATS import. Общий feed (до 200/страницу), maxPages/cursor и maxRequests; роли/компании фильтруются локально. Публичный доступ без credentials/Authorization. Кэш 1 ч и guard одного нового прохода/час общий для UI/API/MCP; страницы текущего прохода не считаются новыми проходами. Статистика HTTP в прежнем provider_requests; дневная/месячная тарифная квота не выдумывается.

Registry 1.3: A02/A06 исключены из company research и импорта (400 для удалённых criterion_id); производное поле `countries` компании больше не возвращается. Страны job scope и `jobs[].countries`, salary-поля ATS, HQ и страны офисов целевых вакансий сохранены. Одноразовая миграция после локального backup удаляет retired observations/reviews и их копии в документах истории; исходные import digest сохраняются вместе с `removedCriteria`.

Registry 1.4 добавляет descriptive `T08_INFRA` с `{summary,tags}` и `collection_sources.columns`/`columnSources.infrastructure`. JSON research остаётся 1.0; новый criterion_id проходит прежний preview/import/review. Таблица переносит проверенный стек в «Инфраструктуру», T03=true в LLM-тег культуры; удаление колонок не удаляет факты или оценки API. [Правила тегов](../discovery/analytics-tags.md).

Company research registry 1.5 (research JSON 1.0): T08_INFRA accepts `{summary,tags,assessments?:[{label,basis}]}`; P03_PUBLIC accepts text; P07_INTERVIEW accepts `{summary,stages:[{title,details,duration?}],assignment?:{kind,details,duration?}}`, with assignment.kind `take_home|live|none|unspecified`. At least one stage or an explicit assignment statement is required. These are descriptive fields; normal preview/import/review/manual APIs and scope/provenance rules apply. No new database table or external-provider call is involved. The UI can additionally read an explicit interview-process section from saved job descriptions as unverified material; it does not create or verify observations on read.

Registry 1.6 adds descriptive `A07_SALARY_BENCHMARK` using existing observations/preview/import/review APIs. Non-null values require scope.role and scope.country. Value fields: component(total/base/stock/bonus/sign_on), statistic(median/mean/range/individual), amount/min/max (nullable numbers), currency, period(year/month/hour), sample_size(nullable positive integer), sample_scope(role_country_level/role_country/company_role/individual/not_disclosed), source_updated_at(nullable ISO date/datetime), sample_period(nullable text), role_relation(target/related), notes. For unknown N use null + not_disclosed. One observation is one consistent statistic/component/scope; source_type=market_estimate. These are web-researched benchmarks, not ATS salary fields. Research JSON remains 1.0; no new tables or provider calls.

### Краткие факты research 1.0

Observation принимает optional `short_facts: string[]` (до 3 непустых строк по 100 символов). Поле дополняет исходный value, scope и evidence, не меняет score. Для short_facts требуется non-null value и хотя бы один evidence. Полные ограничения и маршрутизация B04/B06/A05/AN02/AN03/AN06/P03_PUBLIC: [compact-facts](../discovery/compact-facts.md). Старые документы совместимы без поля; review остаётся обязательным для показа плашек.
