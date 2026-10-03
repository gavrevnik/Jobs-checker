# Jobs checker MCP

`npm run mcp` запускает stdio MCP-сервер с десятью инструментами. Локальный jobs-checker должен работать отдельно: `npm start` или штатный запуск из Life Hub. Обёртка обращается только к loopback HTTP API; сама не открывает SQLite и не обращается к провайдерам. Секреты остаются в `.env` локального сервиса.

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
