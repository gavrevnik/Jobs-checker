# Локальный API

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

`search`: providers, sourceIds, profileId, keywords, exclude, locations, workMode, seniority, minSalary, currency, salaryPeriod, country, location, maxAgeDays, includeUnknownDate, maxPages, maxRequests, maxItems, execute, store. По умолчанию execute=false и store=false. Примеры и точная семантика в [MCP.md](MCP.md).

Провайдеры: greenhouse, lever, ashby, smartrecruiters, arbeitnow, remotive, adzuna, serpapi, jooble. Новые записи страны больше не получают GB автоматически: country передаётся явно, для Adzuna/Jooble необходим. Существующие значения в базе сохраняются.

Состояние загрузки общее для операций источников; конфликтующий вызов возвращает 409. Провайдерные ошибки изолируются внутри результата поиска. При пагинации, оборванной лимитом, частичная выборка этого провайдера не записывается. Неподдерживаемый идентификатор доски/URL отклоняется; внешние HTTP-хосты заданы адаптером.

SQLite дополнена таблицами provider_requests/provider_cache/source_runs/job_observations; миграция создаёт только новые структуры. JSON-экспорт не содержит кэш, журнал запросов и наблюдения; полная резервная копия — SQLite. Импорт экспортированных досок переназначает ID компаний/профилей на локальные.
