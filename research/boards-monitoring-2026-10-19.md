# Подключение ATS-досок к мониторингу · 19.10.2026

Проверен пул **71 существующей компании**. До изменения: 26 зарегистрированных ATS-досок, из них 17 с monitoring=true. Проверены сохранённые identity и официальные Careers 45 компаний без досок; по найденным переходам и пробелам выполнены адресный веб-поиск и чтение дополнительных официальных страниц.

Результат: **14 новых досок**, **9 ранее отключённых досок включены**. Всего 40 зарегистрированных досок; **39 компаний готовы к ручному API-мониторингу**, одна групповая DeliveryHero у Glovo приостановлена до корректного ограничения бренда. Остальные 32 компании требуют веб-проверки или дополнительного адаптера/подтверждения identity.

Новые доски — интервал 24 часа и существующий профиль «Европа · Senior Product Analyst». Для прежних источников сохранены интервалы и существующие профили; у источников без профиля выбран тот же европейский профиль. Это минимальный интервал для явного запуска, не фоновое расписание.

Валидация новых досок: **21 бесплатный ATS HTTP-запрос**, все 14 вернули корректный полный ответ (1797 публикаций до фильтрации). Ещё 1 запрос — отдельная прежняя Greenhouse Glovo, 404. Запросы metered, provider_requests/source_runs и cache существующие. SerpAPI/Adzuna/Jooble/Jobicy в этом запуске не вызывались. Веб-поиск и чтение сайтов учитываются отдельно от ATS HTTP.

Вакансии не импортировались: прежние **110** записей, их содержимое/этапы/заметки/AI, профили и ID всех компаний проверены на неизменность. Регистрация источника не означает свежую проверку активности каждой вакансии. Dry-run jobs_monitor_companies вернул 39 досок без сетевых вызовов. Проверенный WAL-aware backup создан до изменения локальных настроек.

## Новые доски

| Компания | API / board | Публикаций в ответе | Основание |
| --- | --- | ---: | --- |
| A.Team | ashby / `a-team` | 2 | [Careers/ATS](https://www.a.team/) |
| GoCardless | greenhouse / `gocardless` | 33 | [Careers/ATS](https://gocardless.com/) |
| Grover | greenhouse / `grover` | 6 | [Careers/ATS](https://jobs.grover.com) |
| N26 | greenhouse / `n26` | 34 | [Careers/ATS](https://n26.com/en-eu/careers) |
| Scandit | greenhouse / `scandit` | 13 | [Careers/ATS](https://www.scandit.com/careers/current-openings/) |
| BlaBlaCar | lever / `blablacar` | 8 | [Careers/ATS](https://jobs.blablacar.com/vacancies) |
| Contentful | greenhouse / `contentful` | 22 | [Careers/ATS](https://job-boards.greenhouse.io/contentful) |
| Wolt | greenhouse / `wolt` | 205 | [Careers/ATS](https://job-boards.greenhouse.io/wolt) |
| Adyen | greenhouse / `adyen` | 246 | [Careers/ATS](https://job-boards.greenhouse.io/adyen/jobs/8090631) |
| Mollie | ashby / `Mollie` | 44 | [Careers/ATS](https://jobs.mollie.com/vacancies/a47018ac-0a29-4ba0-88cf-9616fdb03b71) |
| Spotify | lever / `spotify` | 82 | [Careers/ATS](https://jobs.lever.co/spotify) |
| Wise | smartrecruiters / `Wise` | 430 | [Careers/ATS](https://jobs.smartrecruiters.com/Wise/744000150221219) |
| Ubisoft | smartrecruiters / `Ubisoft2` | 333 | [Careers/ATS](https://jobs.smartrecruiters.com/Ubisoft2/744000154039054-pipeline-release-manager) |
| SumUp | greenhouse / `sumup` | 339 | [Careers/ATS](https://boards.greenhouse.io/embed/job_app?for=sumup&token=8027837002) |

## Все компании и итоговое покрытие

| Компания | Статус | Источник / причина |
| --- | --- | --- |
| A.Team | Добавлена доска | ashby / `a-team` |
| Adevinta Spain | Адресная веб-проверка / пробел | Careers доступен, но поддерживаемая ATS-доска не установлена; нужен web search или отдельный адаптер. |
| Adyen | Добавлена доска | greenhouse / `adyen` |
| Affirm | Включён мониторинг | greenhouse / `affirm` |
| Air Apps | Включён мониторинг | ashby / `airapps` |
| Allfunds | Адресная веб-проверка / пробел | Careers доступен, но поддерживаемая ATS-доска не установлена; нужен web search или отдельный адаптер. |
| Amazon | Адресная веб-проверка / пробел | Careers доступен, но поддерживаемая ATS-доска не установлена; нужен web search или отдельный адаптер. |
| BlaBlaCar | Добавлена доска | lever / `blablacar` |
| Booking.com | Адресная веб-проверка / пробел | Публичный Careers на iCIMS; адаптера нет. |
| Cabify | Мониторинг уже был включён | greenhouse / `cabify` |
| Coalition Technologies | Адресная веб-проверка / пробел | Careers доступен, но поддерживаемая ATS-доска не установлена; нужен web search или отдельный адаптер. |
| Contentful | Добавлена доска | greenhouse / `contentful` |
| Credit Wellness, LLC | Адресная веб-проверка / пробел | Отдельный официальный Careers/ATS не подтверждён; одноимённые компании не подменялись. |
| Criteo | Адресная веб-проверка / пробел | Официальный Careers содержит ссылку на Workday; адаптера нет. |
| Docplanner | Мониторинг уже был включён | ashby / `Docplanner` |
| Ebury | Включён мониторинг | greenhouse / `ebury` |
| Ericsson | Адресная веб-проверка / пробел | Careers доступен, но поддерживаемая ATS-доска не установлена; нужен web search или отдельный адаптер. |
| Factorial | Адресная веб-проверка / пробел | Careers доступен, но поддерживаемая ATS-доска не установлена; нужен web search или отдельный адаптер. |
| Fever | Включён мониторинг | greenhouse / `feverup` |
| Finom | Включён мониторинг | lever / `pnlfin` |
| FREENOW | Мониторинг уже был включён | greenhouse / `freenow` |
| Glovo | Адресная веб-проверка / пробел | Общая DeliveryHero приостановлена: нет фильтра бренда; отдельная прежняя Greenhouse glovo вернула 404. Адресный Careers web search. |
| GoCardless | Добавлена доска | greenhouse / `gocardless` |
| Google | Адресная веб-проверка / пробел | Careers доступен, но поддерживаемая ATS-доска не установлена; нужен web search или отдельный адаптер. |
| Grafana Labs | Мониторинг уже был включён | greenhouse / `grafanalabs` |
| Grover | Добавлена доска | greenhouse / `grover` |
| Heetch | Включён мониторинг | lever / `heetch` |
| HelloFresh | Адресная веб-проверка / пробел | Публичный Careers на Phenom; отдельная подтверждённая общая ATS-доска не установлена. Private/alumni boards не подключались. |
| hey contact heroes GmbH | Адресная веб-проверка / пробел | Careers доступен, но поддерживаемая ATS-доска не установлена; нужен web search или отдельный адаптер. |
| Hostinger | Мониторинг уже был включён | ashby / `hostinger` |
| IAPWE | Адресная веб-проверка / пробел | Общая Jobs Board содержит вакансии других работодателей; это не собственный Careers компании. |
| idealista | Адресная веб-проверка / пробел | Careers доступен, но поддерживаемая ATS-доска не установлена; нужен web search или отдельный адаптер. Проверка: HTTP Error 403: Forbidden. |
| iMerit Technology | Адресная веб-проверка / пробел | Careers доступен, но поддерживаемая ATS-доска не установлена; нужен web search или отдельный адаптер. |
| Inditex | Адресная веб-проверка / пробел | Careers доступен, но поддерживаемая ATS-доска не установлена; нужен web search или отдельный адаптер. Проверка: HTTP Error 403: Forbidden. |
| King | Адресная веб-проверка / пробел | Публичный Careers на Phenom; поддерживаемая ATS-доска не установлена. |
| Klarna | Адресная веб-проверка / пробел | Официальный homepage доступен; отдельный Careers/поддерживаемая ATS не подтверждены. |
| KoboToolbox | Адресная веб-проверка / пробел | Careers доступен, но поддерживаемая ATS-доска не установлена; нужен web search или отдельный адаптер. Проверка: HTTP Error 403: Forbidden. |
| Labhouse | Мониторинг уже был включён | ashby / `labhouse` |
| Lemon.io | Адресная веб-проверка / пробел | Штатный Careers на BambooHR; Ashby lemon-io относится к сети разработчиков. Не подключён как штатный найм аналитиков. |
| Lodgify | Включён мониторинг | lever / `lodgify` |
| Manychat | Мониторинг уже был включён | ashby / `manychat` |
| MediaMarktSaturn | Адресная веб-проверка / пробел | Публичный Careers на SuccessFactors; адаптера нет. |
| Meta | Адресная веб-проверка / пробел | Careers доступен, но поддерживаемая ATS-доска не установлена; нужен web search или отдельный адаптер. |
| Mitre Media | Адресная веб-проверка / пробел | Careers указывает на LinkedIn Jobs; отдельная поддерживаемая ATS-доска не установлена. |
| Mollie | Добавлена доска | ashby / `Mollie` |
| Multiverse Computing | Адресная веб-проверка / пробел | Официальный Careers ссылается на Teamtailor; адаптера нет. |
| N26 | Добавлена доска | greenhouse / `n26` |
| Nexthink | Мониторинг уже был включён | smartrecruiters / `Nexthink` |
| Pennylane | Мониторинг уже был включён | ashby / `pennylane` |
| Perk | Мониторинг уже был включён | ashby / `perk` |
| Photoroom | Мониторинг уже был включён | ashby / `photoroom` |
| Preply | Мониторинг уже был включён | ashby / `preply` |
| Roamless | Адресная веб-проверка / пробел | Careers доступен, но поддерживаемая ATS-доска не установлена; нужен web search или отдельный адаптер. |
| Rover | Мониторинг уже был включён | lever / `rover` |
| Sanctuary Computer Inc | Адресная веб-проверка / пробел | Careers доступен, но поддерживаемая ATS-доска не установлена; нужен web search или отдельный адаптер. |
| Scandit | Добавлена доска | greenhouse / `scandit` |
| Scopely | Мониторинг уже был включён | greenhouse / `scopely` |
| Smadex | Адресная веб-проверка / пробел | Официальный список на JazzHR/applytojob; адаптера нет. |
| Socialpoint | Включён мониторинг | greenhouse / `spcareers` |
| Spotify | Добавлена доска | lever / `spotify` |
| SumUp | Добавлена доска | greenhouse / `sumup` |
| Thunes | Адресная веб-проверка / пробел | Индексированные официальные вакансии имеют gh_jid, но чтение Careers возвращает 403 и точный board token не подтверждён. Проверка: HTTP Error 403: Forbidden. |
| TK Elevator | Адресная веб-проверка / пробел | Careers доступен, но поддерживаемая ATS-доска не установлена; нужен web search или отдельный адаптер. |
| Typeform | Мониторинг уже был включён | greenhouse / `typeform` |
| Ubisoft | Добавлена доска | smartrecruiters / `Ubisoft2` |
| Unio Digital | Адресная веб-проверка / пробел | Careers доступен, но поддерживаемая ATS-доска не установлена; нужен web search или отдельный адаптер. |
| Wallapop | Мониторинг уже был включён | greenhouse / `wallapop` |
| Wise | Добавлена доска | smartrecruiters / `Wise` |
| Wolt | Добавлена доска | greenhouse / `wolt` |
| Yazio | Включён мониторинг | ashby / `yazio` |
| Zalando | Адресная веб-проверка / пробел | Careers доступен, но поддерживаемая ATS-доска не установлена; нужен web search или отдельный адаптер. |

## Границы

Adzuna — общий агрегатор, отдельные company boards у него не регистрируются. Работающий company filter в запросе не означает постоянного мониторинга компаний: текущий jobs_monitor_companies обходит четыре типа ATS. Для остальных компаний скилл monitoring использует сохранённые Careers/LinkedIn и доступные поисковые API по пробелам. Не создавать фиктивные ATS-доски для Workday/собственных сайтов, не угадывать slug и не трактовать отсутствие источника как отсутствие вакансий.

Технические receipts, HTML и before/after настройки сохранены в ignored `.runtime/boards-monitoring-2026-10-19/`; SQLite snapshot — в `../data/jobs-checker/backups/boards-monitoring-2026-10-19/`.
