# Glassdoor по явному запросу

Подключён `memo23/glassdoor-scraper-ppr` для **reviews → P01** и **interviews → P07_INTERVIEW** через [общий клиент Personal Radar](../../personal-radar/docs/glassdoor.md). Salaries/jobs/AI insights/email enrichment не подключены. Ordinary discovery, enrichment, monitoring, просмотр карточки, тесты и startup не запускают Actor. Не обходить `ResearchPaidGate` внешним Apify MCP или прямым HTTP.

## Настройка

В ignored `.env` Jobs Checker самостоятельно задать `APIFY_TOKEN` своего Apify account. Не переносить ключ соседнего проекта автоматически. `JOBS_GLASSDOOR_MAX_RUN_USD=1` — локальный потолок на один запуск, допустимо >0 и <=10. Это не месячный бюджет и не отдельный allowance Jobs: при одном аккаунте расходы делятся с Personal Radar/Activity Checker. После настройки перезапустить Jobs и MCP обычным lifecycle. Наличие ключа — configured, не проверка его валидности/баланса.

## Порядок запуска

1. `jobs_company_paid_status` — локальные capability, missing credentials и лимиты, без HTTP провайдера.
2. Установить точное соответствие companyId и профиля Glassdoor по названию, домену и деятельности. Бесплатные источники остаются первым шагом. Подготовить конкретные URL, reviews/interviews, объём и период.
3. `jobs_company_paid_quote({operation})` — один публичный GET тарифа, без Actor/согласия. Если пользователь ещё не запросил этот конкретный запуск, показать параметры, стоимость и возможный общий account budget. Само подключение интеграции не разрешает платный запуск.
4. Только после явного пользовательского запроса с этими параметрами: `jobs_company_paid_authorize({operation,confirmed:true})`. Повторное разрешение не спрашивать, если оно уже дано на тот же конкретный запуск. Возвращает grantId на один час, привязанный к неизменной operation. Это ещё не исполнение.
5. `jobs_company_paid_execute({operation,grantId})`. Тот же JSON. Бюджет резервируется и grant расходуется атомарно до провайдера. Тариф проверяется повторно; один POST с provider `maxTotalChargeUsd`, без polling/retry. Возвращаются ledgerId, run URL и dataset URL, если уже известен. Сетевой timeout — неизвестный исход, никогда не повторять запуск автоматически.
6. `jobs_company_paid_runs({ledgerId?})` читает SQLite; без ID возвращает последние 20 запусков. `jobs_company_paid_refresh({ledgerId})` делает один явный GET metadata **уже сохранённого run ID**, обновляет status/cost в ledger, не запускает Actor и не читает dataset. Если POST не вернул ID, проверять Console вручную, а не угадывать run по истории аккаунта.
7. Пользователь экспортирует результат из Apify в JSON. `jobs_company_paid_normalize({ledgerId,rows})` обрабатывает его локально, возвращает материалы P01/P07_INTERVIEW, rejected rows и provenance. Дальнейшее сохранение/review — прежний research workflow; нет автоматической записи observations или повышения оценок.

Пример **шаблона**, не согласие и не команда к исполнению:

```json
{
  "provider": "apify",
  "actor": "memo23/glassdoor-scraper-ppr",
  "operation": "reviews",
  "companyIds": ["EXISTING_COMPANY_ID"],
  "volume": 50,
  "parameters": {
    "companyUrl": "https://www.glassdoor.com/Reviews/Example-Reviews-E123.htm",
    "startDate": "2026-07-01"
  },
  "maxCostUsd": 0.30
}
```

URL/ID здесь вымышлены. Для интервью изменить operation на `interviews`, проверить нужную компанию и согласовать новый запуск. Один запуск — одна компания/операция, максимум 200 строк; параметры строго `companyUrl` и optional `startDate`. Платные extras и произвольный Actor input запрещены. Лимит применяется к запуску; **автоматическое скачивание dataset отключено по решению пользователя**. Экспорт/чтение Console отдельно может тарифицироваться Apify вне cap запуска.

## HTTP

Все маршруты под `/api/company-research/paid`; сохраняют прежние loopback/Host/Origin проверки.

| Метод/маршрут | Body | Эффект |
| --- | --- | --- |
| GET `/` | — | Локальный status |
| POST `/quote` | `{operation}` | Один GET актуального публичного тарифа |
| POST `/authorize` | `{operation,confirmed:true}` | GET тарифа + локальный одноразовый grant |
| POST `/execute` | `{operation,grantId}` | Резерв бюджета, GET тарифа, единственный POST запуска |
| GET `/runs` или `/runs/:ledgerId` | — | Локальная история/результат |
| POST `/runs/:ledgerId/refresh` | `{}` | GET метаданных run + обновление ledger |
| POST `/runs/:ledgerId/normalize` | `{rows:[...]}` | Offline нормализация; ничего не импортирует |

`status=submitted` в ledger означает отправленную операцию; фактический статус Apify находится в `result.data.status`. `costUsd=null` — неизвестно, не бесплатно; `costProvisional=true` — snapshot, не финальный счёт. При unknown/failed grant уже использован. Новая попытка требует нового конкретного пользовательского запроса. Результаты и журнал находятся в существующих `company_research_paid_grants/ledger` прежней SQLite; новой БД/пути нет.

Свежесть, конкретная роль/страна, повторяемость и содержательность отзывов важнее общего рейтинга. Кандидатский рассказ не становится официальным процессом найма; durationDays — длительность всего процесса. P01 не доказывает зрелую аналитику. Данные из локального JSON не сверены с Apify и сами по себе не подтверждают identity; особенно осторожно с `identityBasis=input_url_only`.
