# Company Discovery & Comparison

Вкладка «Сравнение компаний» использует существующие `companyId` и вакансии Jobs Checker. Первые колонки — Компания, Описание бизнеса, Целевые вакансии и Аналитическая культура (Middle/Senior Product/Data Analyst за все сохранённые даты); дальше — инфраструктура, аналитические score/coverage/highlights, Evidence и Сводка; доступность/технические колонки остаются только при непокрытых тегами фактах. [Контракт колонок, связь со всеми API/ATS, миграция и ограничения годовой истории](comparison-columns.md). Фильтры: название компании, актуальные города целевых вакансий, активные вакансии; под «Подробнее» — формат, visa, relocation, статус исследования, Target/Secondary/Practice, раздел/pass/coverage. Категория исследования независима от CRM. Кнопка разворота справа оставляет фильтры и таблицу на всё окно браузера; повторный клик или Esc возвращает обычный вид.

## Registry 1.4 · JSON-контракт 1.0

Registry 1.4 добавляет descriptive `T08_INFRA` с прежним типом `{summary,tags}` и provenance-колонку `infrastructure`; scores не расширяются. [Разделение культуры/стека, примеры инструментов, источники и правила обработки](analytics-tags.md). Прежние технические теги AN09 и значения T01/T05/T06 переносятся в новое представление без переписывания observations; T03=true дополняет культуру тегом LLM-assisted analysis.

`A02_HQ` — отдельное descriptive поле основного операционного офиса/штаб-квартиры, ISO-2 список стран. Сохраняется в Evidence/Сводке (с 16.10 вместо плашки в первой колонке обычная строка после размера), независимо от выбранной страны найма; не участвует в score. Несколько явно заявленных штаб-квартир сохраняются. Нужен прямой company claim, а не контактный адрес, регистрация или город вакансии. Для общего company claim из объявления нужен `scope.context=company_headquarters` и соответствующий `scope.job_url`. Явное Headquarters=Distributed Team хранится как `value=null`, `scope.context=distributed_headquarters`, с проверенным официальным evidence; Evidence/Сводка показывают «Распределённая команда». Remote-first сам по себе этого не доказывает. Совместимость JSON `schema_version=1.0` сохранена; обе версии registry хранятся в SQLite.

Registry 1.2 добавляет descriptive AN09_CULTURE (summary/tags) без изменения scores. JSON 1.0 обратно совместимо расширен опциональным collection_sources для API/web/model provenance. Сначала сбор API/матчинга, затем веб-материалы, затем сводка модели; [правила колонок](comparison-columns.md).

20.10.2026 registry 1.3 удаляет A02 «Страны найма» и A06 «Компенсация» из схемы импорта, критериев, таблицы и company-level фильтров. Они не входят в gaps/score/highlights. Одноразовая транзакционная миграция после проверенного WAL-aware backup удаляет связанные observations/reviews, вычищает их из документов runs и инвалидирует previews/score snapshots. ID и исходные digest импортов сохраняются; отредактированные runs помечены `removedCriteria`. Старые версии registry остаются метаданными истории. Локации/зарплаты вакансий, штаб-квартиры, остальные факты, CRM и заметки не меняются. Новые импорты с A02/A06 отклоняются. Откат — из локального backup; миграция повторно не запускается.

## Перенос прежних карточек

14.10.2026 выполнен авторизованный перенос всех 55 реальных компаний: 200 исторических observations + 170 новых проверенных записей. HQ: 52 компании со странами, Typeform — распределённая команда, Yazio/Credit Wellness — уточнить. Ресерч использовал 23 бесплатных ATS API запроса и первичные публичные источники; платные вызовы отсутствуют. Восемь публичных boards добавлены с monitoring=false. Исходные компании, 64 вакансии и 3 профиля сохранены и проверены полным сравнением до/после. Перед переносом создан WAL-aware backup; отчёт и конкретные документы находятся локально в `.runtime/company-discovery/`. Проверено: 111 tests / 14 files, build, HTTP/MCP; в UI — цветные плашки, несколько HQ и распределённая команда, без console warn/error. [Пример плашек](../artifacts/company-headquarters.png).

`shared/legacy-company-research.ts` готовит аддитивный документ по существующим ID. Description/industry → неподтверждённый B04, форматы сохранённых вакансий → неподтверждённые observations с job scope и исходными датами. Зарплатные вилки остаются только в исходных карточках вакансий. Location, размер и прежнее обоснование dataDrivenScore сохраняются в истории исследования; location не превращается в HQ/найм, размер не превращается в стадию финансирования, прежние оценки не превращаются в discovery score. Пустые карточки тоже получают запись исследования. Company/ATS/CRM и пользовательские заметки не изменяются.

Для подготовки нового локального файла из запущенного приложения (только чтение):

```sh
node --import tsx scripts/prepare-legacy-discovery.ts .runtime/legacy-discovery.json
```

Перед применением к живой базе создать проверенный WAL-aware backup штатным Personal Radar helper. Затем обычные preview → проверка сопоставления ID → авторизованный import. Повтор того же документа идемпотентен; неизвестные факты не стирают подтверждения. Свежий research добавляется отдельным документом и проходит содержательный review первичных источников.

## Файлы контракта

- [criteria.json](criteria.json) — единый реестр: стабильные ID, тип, scored/descriptive/subjective, правило, scope, допустимые источники, freshness и связи с интервью. Изменения контракта требуют новой версии; прежние версии сохраняются в SQLite.
- [Discovery checklist](discovery-checklist.md) — публичное исследование.
- [Deep Interview checklist](deep-interview-checklist.md) — конкретные вопросы HR, hiring manager и коллегам. Непубличные детали T04, T07, P03 остаются здесь; опубликованный процесс задач — P03_PUBLIC; публичные сигналы остальных направлений отделены от внутренних вопросов. Ответы интервью не загружаются как публичный discovery.
- [JSON Schema](research-import.schema.json) — строгая структура, без неизвестных ключей, версия `1.0`, тип значения зависит от criterion ID.
- [Синтетический пример](examples/research-import.example.json) — две вымышленные компании, unknown, salary scope, противоречия, отзыв и red flag. Не использовать как реальные сведения.
- [Общие правила](workflow-common.md) — единый порядок сбора, evidence, импорт, квоты и история трёх ручных сценариев.
- [jobs-discovery](../.agents/skills/jobs-discovery/SKILL.md) — новые компании и повторный ресерч профилей.
- [jobs-monitoring](../.agents/skills/jobs-monitoring/SKILL.md) — обновление вакансий известных компаний.
- [jobs-pool-review](../.agents/skills/jobs-pool-review/SKILL.md) — пересмотр пула по соответствию, отдаче и полноте наблюдения; без автоматического архива и расписания.
- [Careers / ATS / LinkedIn](hiring-sources.md) — обязательный поиск официальных карьерных источников перед агрегаторами, безопасный адресный веб-мониторинг и повторное использование identity.

Документ: `schema_version`, `generated_at` (ISO timestamp), `research_mode` (`external_research` / `internal_discovery` / `manual`), `companies`. Компания: `identity`, `observations`, `job_urls`, `red_flags`, `notes`. Identity: name, optional website/company_id/aliases. Для новой компании требуется website; для существующей использовать ID или уникальный домен. Коллизия имени/alias без подтверждающего домена пропускается с причиной; исправить JSON и выполнить новый preview. Website — заявленная исследователем identity, её также необходимо проверить в preview. ID + противоречащий домен блокирует сопоставление.

Observation: `criterion_id`, `value`, `confidence`, `scope`, `reasoning`, `evidence`, optional `verdict`, `complete`, `applicability`. Неизвестное значение — `null`, без придуманного default. A02_OFFICES и A02_HQ: массив ISO-2 кодов в верхнем регистре. A05: `{modes:["hybrid"],eligible_countries:["ES"]}`; remote не означает право работать из любой страны. Зарплаты хранятся в карточках вакансий ATS, не в observations компаний.

`scope`: country, city, role, level, job_url, context. Условия вакансии с source_type=job подтверждаются только с соответствующим job_url. Не переносить их на компанию. При фильтре страны не использовать вакансию с неизвестной страной как страновую политику. Офисы A02_OFFICES и рынки B08 не подменяют географию конкретных вакансий.

Evidence: публичный HTTP(S) URL без credentials, title, source_type, observed_at, excerpt (конкретное подтверждение), optional published_at. Источники: official/job/engineering/report/conference/employee_report/news/market_estimate/user. Отзыв — отзыв, оценка рынка — оценка; даже проверка источника не делает их условиями всей компании. Маркетинговые лозунги не подтверждают процесс. Red flag: title, description, severity, confidence, scope, evidence, optional occurred_at.

## Подтверждение, конфликты и свежесть

Импортированные observations всегда **не проверены**. Verdict внешней LLM хранится как предложение; реальный verdict вычисляется по значению и реестру после review источника/scope. Проверка — содержательная работа пользователя/агента по ссылке, не автоматическая проверка факта по наличию URL. Не следует подтверждать синтетические данные или сведения, содержание которых не прочитано.

Pass/fail требуют проверенного конкретного свидетельства primary source, high/medium confidence и свежести. Неполный перечень языков/технологий/стран без подходящего значения остаётся unknown; `complete:true` допустимо только если источник явно даёт полный перечень. `applicability:not_applicable` принимается лишь у ручной observation после review. B03 — личное мнение, не факт. Descriptive и subjective исключены из score.

Coverage = (pass + fail) / число применимых scored критериев. Conflicting входит в знаменатель, но не в числитель; unknown не равен fail. Положительная доля выводится только при coverage ≥50%. Общего AI-рейтинга нет; dataDrivenScore и job aiScore не меняются. Highlights — только проверенные свежие pass.

Score/coverage/criteria/highlights хранятся как снимок с `scoresCalculatedAt` в `company_research_scores` той же SQLite, с отдельными вариантами по scope страны. Свежесть score оценивается на дату снимка. Первое чтение создаёт недостающий снимок; изменение observations/review или scoring registry инвалидирует его. Без новых данных list/profile/фильтры/обычное обновление не запускают scoring, в том числе после перезапуска сервера. В конце авторизованного discovery/monitoring вызови `jobs_company_research_recalculate({companyIds:[...]})`: это отдельный локальный пересчёт с текущей датой, без подтверждения старых источников, изменения фактов, CRM или AI-оценок. Опущенный companyIds означает весь каталог. Общие таблицы читаются и группируются один раз на весь list; актуальность вакансий вычисляется независимо от снимка score.

История observations и review append-only. Unknown и более слабое предложение не удаляют прежний факт. Разные подтверждённые значения в одном scope дают conflict; разные pass/fail по разным scope показывают неоднородность условий и общий conflicting до выбора страны. Противоречащее непроверенное предложение отмечается для review, сохраняя прежний verdict. Разрешение: явно отклонить неверную observation; все версии/причины остаются. Исправление: новая ручная observation, затем review, при необходимости отклонение устаревшей версии.

Freshness: 30 дней для условий доступности, 180 для остальных публичных сигналов; учитываются observed_at, published_at и verifiedAt. Перепроверка исторической публикации не превращает её в текущее условие. Публичные события/отзывы сохраняют датировку. ATS current = последнее наблюдение ≤30 дней, не архив и не два отсутствия в полных снимках. «Current» означает недавно проверенную публикацию, не гарантию, что ссылка открыта в эту секунду. Прежний currentJobs для условий формата/зарплаты фильтруется активным поисковым профилем. Новая колонка использует независимый targetVacancies: только Middle/Senior Product/Data Analyst, со всей сохранённой историей и отдельным open; см. контракт колонок. `job_urls` внешнего исследования сохраняются в истории как найденные ссылки; в ATS они попадают отдельно через существующий jobs_ats_import после проверки.

## Импорт из ChatGPT

1. Передать ChatGPT checklist, criteria.json и schema (прикрепить файлы), список компаний и при наличии существующие ID.
2. Получить только JSON; неизвестные факты оставить null. Проверить первичные ссылки и scope.
3. В «Сравнение компаний → Импорт research JSON» загрузить файл или вставить JSON.
4. Нажать «Проверить и показать preview». Проверить новые/существующие компании, пропуски и конфликты; имя само по себе не всегда сопоставляется.
5. Явно подтвердить этот preview. Он действителен 60 минут и привязан к состоянию компании/facts/reviews; при изменениях нужен новый preview. Запись транзакционная, повтор документа идемпотентен независимо от форматирования ключей JSON.
6. Открыть Evidence, проверить содержание ссылок и подтвердить отдельные observations. Отдельно проверить red flags. Сохранить личный приоритет/заметки; посмотреть Gap analysis.

Copy-paste запрос (прикрепить четыре файла):

```text
Исследуй компании: <названия и сайты; существующие company_id, если есть>.
Мой профиль: Senior Product/Data Analyst, SQL/Python/статистика/A/B, AI coding agents,
Испания в приоритете, затем ЕС, кандидат вне ЕС, английский/русский.
Используй приложенные discovery-checklist.md, criteria.json, research-import.schema.json и analytics-tags.md.
Для «Аналитики» сохраняй также AN01/AN04/AN06/T03 и содержательные AN07/AN08 с источниками;
прежние Highlights скрыты только в UI. Summary/tags AN09_CULTURE не заменяют эти observations.
Верни только JSON schema_version "1.0", research_mode "external_research".
Не выдумывай даты, компенсацию, географию, источники, visa sponsorship или verdict.
Ищи официальные Careers/вакансии, Engineering/Data Blog, отчётность/IR и red flags.
Сохраняй атомарные observations со scope страны/роли/конкретной вакансии;
офисы и рынки не являются странами найма, remote не означает worldwide.
Каждое известное утверждение снабди ссылкой и конкретным excerpt;
published_at только если известна, observed_at = фактическая дата просмотра.
Неизвестное value=null; противоречия — отдельные observations с источниками.
Отделяй employee_report от первичных фактов. Не проводи платных запросов.
Не заявляй confirmed или verified: проверка выполняется в Jobs Checker после импорта.
Для неполных перечней не ставь complete:true. Личные впечатления B03 — отдельно.
job_urls — найденные реальные ссылки, они не доказывают текущую активность.
```

## HTTP / MCP

Один существующий loopback сервер, одна SQLite. MCP обращается к HTTP и не открывает БД.

| HTTP                                                                      | MCP                                    |
| ------------------------------------------------------------------------- | -------------------------------------- |
| GET /api/company-research/criteria                                        | jobs_company_research_criteria         |
| GET /api/company-research?country=ES&profileId=…                          | jobs_company_research_list             |
| POST /api/company-research/recalculate ({companyIds?: [...]})             | jobs_company_research_recalculate      |
| GET /api/company-research/:id                                             | jobs_company_research_profile          |
| POST /api/company-research/preview (документ)                             | jobs_company_research_preview ({data}) |
| POST /api/company-research/import ({previewId,confirmed:true})            | jobs_company_research_import           |
| POST /api/company-research/:id/observations (observation)                 | jobs_company_research_observe          |
| PATCH /api/company-research/observations/:id ({verified,rejected?,note?}) | jobs_company_research_review           |
| PATCH /api/company-research/flags/:id ({verified,note?})                  | jobs_company_research_flag_review      |
| PATCH /api/company-research/:id/preferences ({priority,notes})            | jobs_company_research_priority         |
| GET /api/company-research/:id/plan?country=ES                             | jobs_company_research_plan             |
| GET /api/company-research/history?companyId=…                             | jobs_company_research_history          |

Все чтения локальные. Preview сохраняет только временный токен/документ, без изменения companies/facts или сетевых вызовов. Research не входит в прежний ATS JSON export: отдельная история доступна через API/MCP, полный бэкап SQLite включает таблицы.

## Providers и платное расширение

Переиспользуются jobs_search/add_company_board/monitor_companies/enrich и существующий meteredFetcher с SQLite cache, quota ledger и maxRequests. Проверка кода и официальных API на 14.10.2026:

- [Greenhouse Job Board API](https://docs.greenhouse.io/job-board.html): публичные GET, jobs?content=true, фильтрация prospect posts.
- [Ashby public postings](https://developers.ashbyhq.com/docs/public-job-posting-api): includeCompensation=true, listed jobs, workplaceType и отдельный Salary-компонент.
- [Lever postings](https://github.com/lever/postings-api): Global/EU, skip/limit pagination.
- Также существуют SmartRecruiters, Remotive, Arbeitnow, Adzuna, SerpAPI, Jooble. Credentials определяются jobs_sources_status, наличие кода не означает подключённый аккаунт. LinkedIn Actors в ChatGPT не означают локальную доступность.

Новые provider-клиенты и постоянно работающие сервисы не добавлены. Research import не меняет Sources/Knowledge/Sites/D1. Отдельно авторизованный research может зарегистрировать публичные ATS boards прежним jobs_add_company_board; monitoring задаётся явно. Бесплатный research не вызывает платные Actors. Для блогов/feeds использовать существующие Personal Radar connectors или доступный web-search, результаты передавать через research preview.

`ResearchPaidGate` включает адаптер `memo23/glassdoor-scraper-ppr` только для reviews/interviews. [Настройка, HTTP/MCP и точный порядок одноразового запуска](glassdoor.md). Status/просмотр/preview не вызывают Actor. Требуются конкретный пользовательский запрос, актуальный тариф, неизменные параметры и provider hard cap. Автоматическое чтение dataset выключено: возвращаются Console links, экспортированный JSON обрабатывается локально. Остальные платные Actors без адаптеров заблокированы.

Gap plan рекомендует конкретные компании/пробелы P01/P07_INTERVIEW/B06 и важность по пользовательскому Target; стоимость неизвестна до явного quote. Для Glassdoor указан адаптер и configured credentials; B06/Similarweb остаётся неподключённым. Автоматического paid fallback нет. Для реального подключения нужен отдельный выбор Actor/операции/объёма/параметров и максимальной стоимости. Pricing можно получить read-only доступными средствами; не запускать Actor ради оценки цены.

## Хранение и проверка

Аддитивные `company_research_*`: registry, immutable observations (evidence внутри атомарного JSON), reviews, flags, runs/import documents, identity, preferences, preview tokens, paid grants/ledger. Существующая company — единственная каноническая локальная сущность. Перед первым добавлением таблиц в существующий SQLite используется Personal Radar WAL-aware backup helper; копия с integrity/fingerprint metadata в `<DB directory>/backups/company-research/`, без offsite push/архивной ротации. При ошибке backup открытие для миграции отменяется. Данные не переносятся в Knowledge. Новый файл БД/путь не создаётся; текущий архив Jobs SQLite уже покрывает эти таблицы.

```sh
npm test
npm run build
npm run test:http
npm run test:mcp
```

Тесты на временной SQLite/in-memory и mocked providers. JSON Schema обновлять из Zod (проверка равенства в тестах):

```sh
node --import tsx -e "import {z} from 'zod'; import {researchImportSchema} from './shared/company-research.ts'; import {writeFileSync} from 'node:fs'; writeFileSync('discovery/research-import.schema.json', JSON.stringify(z.toJSONSchema(researchImportSchema),null,2)+'\n')"
```

## Первичная реализация · до переноса реальных карточек

Проверено: `npm test` — 109 tests / 13 files; `npm run build` — успешно; `npm run test:http` и `npm run test:mcp` — успешно, 23 MCP tools (12 прежних + 11 research). HTTP/MCP проходили на отдельных временных базах; разрешённый loopback использовался после sandbox EPERM. Offline тесты покрывают scoring/coverage, scope, зарплаты, schema parity, identity, atomic rollback/idempotency, history/conflict preservation, shared ATS/quota workflow, одноразовый paid consent/budget и WAL-aware backup. Skill прошёл quick_validate.

Браузерная проверка на отдельной синтетической SQLite: вкладка и sticky-колонка, горизонтальная прокрутка до score/highlights, evidence modal, JSON paste → preview → apply, новая компания с unknown без баллов, Spain filter (1 из 3), корректный статус conflicting. Console error/warn: отсутствуют. [Preview основных колонок](../artifacts/company-comparison-ui.png) и [score/coverage](../artifacts/company-comparison-scores.png) — локальные игнорируемые screenshots тестовых компаний.

Фактически созданы:

- `.agents/skills/{jobs-discovery,jobs-monitoring,jobs-pool-review}/SKILL.md`; общие правила в `discovery/workflow-common.md`.
- `discovery/discovery-checklist.md`, `discovery/deep-interview-checklist.md`, `discovery/criteria.json`, `discovery/research-import.schema.json`, `discovery/examples/research-import.example.json`, `discovery/README.md`.
- `shared/company-research.ts`.
- `server/company-research.ts`, `server/research-api.ts`, `server/research-migration.ts`, `server/research-paid.ts`.
- `src/CompanyComparisonPage.tsx`, `src/company-comparison.ts`, `src/company-comparison.css`.
- `tests/company-research.test.ts`, `tests/research-migration.test.ts`.

Изменены:

- `src/App.tsx`, `server/store.ts`, `server/index.ts` — навигация, lifecycle/аддитивная схема и API registration.
- `scripts/jobs-mcp.ts`, `scripts/check-http.ts`, `scripts/check-mcp.ts` — research tools и реальные loopback integration checks на fixtures.
- `README.md`, `docs/API.md`, `docs/MCP.md` — пользовательский workflow и ссылки на контракт.
- `server/provider-io.ts`, `tests/connectors-safety.test.ts` — единая дата observation/cache receipt и детерминированная проверка: cache hit не обновляет свежесть вакансии даже при смене миллисекунды во время SQL-записи.

Новых provider clients нет. Существующие Personal Radar Greenhouse/Ashby/Lever и остальные ATS integrations переиспользованы через SourceTools. Код Personal Radar и его публичные интерфейсы не изменены. Сборка общего пакета выполнена стандартными pretest/prebuild scripts. Production Sites/MCP/D1/Knowledge и пользовательская SQLite не использовались для проверок. Коммит/push не выполнены. Синтетический preview-сервер остановлен; приложение запускается штатно через Jobs checker.app/Life Hub, первая миграция реальной базы выполняется только при таком запуске после автоматического локального backup.

Ограничения: реальные компании ещё не исследованы; источники требуют содержательного review, live provider availability не проверялась, job_urls исследования не создают ATS автоматически. Сроки свежести консервативные и задаются registry. Почасовая/неизвестная компенсация и FX не нормализуются в годовые суммы. В build остаются неблокирующие Rollup предупреждения о комментариях Zod и размере общего bundle. Glassdoor reviews/interviews реализованы через общий adapter и ручной paid gate; нужны credentials, актуальный pricing с hard cap и точное одноразовое согласие на каждый запуск. Live Actor проверка не выполнялась. Старый ATS export не содержит research, полный SQLite backup содержит все новые таблицы.

По квотам будущего Apify: несекретная [документация Personal Radar](../../personal-radar/docs/apify-actor-pricing.md) подтверждает общий account scope его pricing/usage и Activity Checker. Для Jobs Checker аккаунт не настроен; пересечение с отдельными Actor plugins неизвестно. Подключение к тому же аккаунту разделит account usage/spending с соседними проектами. Credentials не читались/не сравнивались и платных запусков не было.

Registry 1.5: публичный процесс работы P03_PUBLIC и структурированные детали интервью P07_INTERVIEW; T08_INFRA принимает необязательные assessments[{label,basis}] при прежнем summary/tags. Все новые поля descriptive, без изменения состава scored-критериев. Research JSON сохраняет версию 1.0; старые T08_INFRA совместимы. [Сценарии извлечения и ограничения оценок](company-enrichment.md).


Registry 1.6: A07_SALARY_BENCHMARK добавляет descriptive ориентиры Levels.fyi из бесплатного веб-ресерча с ролью/страной, компонентом/статистикой, валютой/периодом, датой данных и N/областью выборки. Нет возврата A06, salary score и автоматического заполнения зарплаты вакансии. [Сбор/сохранение](salary-web-research.md).


## Независимый режим культуры

[Культура и команда](culture-and-team.md) исследуется отдельно от поиска вакансий. Компания и команды получают разные оценки, исторические доказательства сохраняются с исходными датами. Для этого режима обязательный предварительный сбор Careers/ATS и вакансий не нужен.
