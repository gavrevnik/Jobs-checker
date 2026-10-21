# Аудит Careers / ATS / LinkedIn · 19.10.2026

Проверены все **71** компании текущей базы: официальные сайты и их карьерная навигация, прежние подключённые ATS, прямые LinkedIn-ссылки и адресный веб-поиск для пробелов. Сохранено **65 Careers**, **70 LinkedIn identity**, ссылки на поддерживаемые ATS у **30 компаний** (26 прежних привязок и 4 дополнительно найденных: A.Team, GoCardless, Grover, Lemon.io).

Подтверждение URL/работодателя не означает свежий полный снимок вакансий. Вакансии, active/open, оценки и пользовательские поля не обновлялись. Результаты хранятся в `Company.hiringSources` прежней SQLite, provenance — в company research run. Новых баз, расписания, LinkedIn API или organic SerpAPI executor нет. Новые ATS-привязки сохранены как метаданные; четыре новые доски не добавлены автоматически в постоянный мониторинг. Для Lemon.io необходимо различать внутреннюю BambooHR-команду и Ashby-сеть разработчиков.

Для Careers, открывающихся с официального сайта, сохранена прямая ссылка-основание. HTTP 403/429, TLS/anti-bot ограничения не обходились; где возможно использована индексированная официальная страница. Для старых подключённых ATS сохранена фактическая прежняя дата sync; она не заменена датой этого аудита. `checkedAt` верхнего уровня означает проверку источников/identity, не дату публикации или проверки вакансий.

LinkedIn identity устанавливалась по официальной ссылке или совокупности названия, домена, деятельности и географии. Числовые Company ID не выдумывались: сохранены company slug и переходы `/company/{slug}/jobs/`. LinkedIn не обходился браузерной автоматизацией, с cookies/личным аккаунтом, guest API или CAPTCHA/proxy bypass. Найденные одноимённые Google-клоны и чужие Credit Wellness исключены. Adevinta Spain связана именно с региональным профилем, Careers относится к глобальной группе.

**Расход:** платные provider API не вызывались; SerpAPI остаётся на прежних 10 попытках за день. Адресный веб-поиск агента и чтение официальных сайтов не являются вызовами ATS API и зафиксированы отдельно. Завершённый research run указан ниже.

## Пробелы

- Credit Wellness, LLC: отдельные Careers/ATS и LinkedIn этой компании не подтверждены; результаты с другими доменами отклонены.
- IAPWE: Jobs Board содержит чужие вакансии и не считается Careers работодателя.
- idealista: сайт блокирует чтение; точный текущий Careers URL не подтверждён.
- Klarna: anti-bot ограничил официальный сайт; найденные Klar/Nift — другие работодатели.
- KoboToolbox: обнаружены старые закрытые роли; текущий общий Careers/ATS не установлен. Переход к Kobo/kobo.ngo требует отдельной проверки identity.
- Mitre Media: официальный Careers ведёт прямо на LinkedIn Jobs; отдельная Careers-ссылка не дублируется.
- Sanctuary Computer: сохранён официальный Work with us на /info для creative/contractor network; это не полный список штатных вакансий.

## Все компании

| Компания | Careers | LinkedIn Jobs | Поддерживаемые ATS |
| --- | --- | --- | --- |
| A.Team | [Careers](https://jobs.ashbyhq.com/a-team/) | [LinkedIn Jobs](https://www.linkedin.com/company/ateams/jobs/) | [ashby · a-team](https://jobs.ashbyhq.com/a-team) |
| Adevinta Spain | [Careers](https://adevinta.com/careers/jobs/) | [LinkedIn Jobs](https://www.linkedin.com/company/adevintaspain/jobs/) | — |
| Adyen | [Careers](https://careers.adyen.com) | [LinkedIn Jobs](https://www.linkedin.com/company/adyen/jobs/) | — |
| Affirm | [Careers](https://www.affirm.com/careers) | [LinkedIn Jobs](https://www.linkedin.com/company/affirm/jobs/) | [greenhouse · affirm](https://job-boards.greenhouse.io/affirm) |
| Air Apps | [Careers](https://jobs.ashbyhq.com/airapps) | [LinkedIn Jobs](https://www.linkedin.com/company/airapps/jobs/) | [ashby · airapps](https://jobs.ashbyhq.com/airapps) |
| Allfunds | [Careers](https://allfunds.com/en/careers) | [LinkedIn Jobs](https://www.linkedin.com/company/allfunds-wealthtech/jobs/) | — |
| Amazon | [Careers](https://www.amazon.jobs/) | [LinkedIn Jobs](https://www.linkedin.com/company/amazon/jobs/) | — |
| BlaBlaCar | [Careers](https://jobs.blablacar.com/) | [LinkedIn Jobs](https://www.linkedin.com/company/blablacar/jobs/) | — |
| Booking.com | [Careers](https://jobs.booking.com/) | [LinkedIn Jobs](https://www.linkedin.com/company/booking.com/jobs/) | — |
| Cabify | [Careers](https://cabify.careers/es/) | [LinkedIn Jobs](https://www.linkedin.com/company/cabify/jobs/) | [greenhouse · cabify](https://job-boards.greenhouse.io/cabify) |
| Coalition Technologies | [Careers](https://coalitiontechnologies.com/jobs) | [LinkedIn Jobs](https://www.linkedin.com/company/coalition-technologies/jobs/) | — |
| Contentful | [Careers](https://www.contentful.com/careers/) | [LinkedIn Jobs](https://www.linkedin.com/company/contentful/jobs/) | — |
| Credit Wellness, LLC | — | — | — |
| Criteo | [Careers](https://careers.criteo.com/en/) | [LinkedIn Jobs](https://www.linkedin.com/company/criteo/jobs/) | — |
| Docplanner | [Careers](https://www.docplanner.com/career/) | [LinkedIn Jobs](https://www.linkedin.com/company/docplannergroup/jobs/) | [ashby · Docplanner](https://jobs.ashbyhq.com/Docplanner) |
| Ebury | [Careers](https://ebury.com/company/careers) | [LinkedIn Jobs](https://www.linkedin.com/company/ebury/jobs/) | [greenhouse · ebury](https://job-boards.greenhouse.io/ebury) |
| Ericsson | [Careers](https://www.ericsson.com/en/careers) | [LinkedIn Jobs](https://www.linkedin.com/company/ericsson/jobs/) | — |
| Factorial | [Careers](https://careers.factorialhr.com/) | [LinkedIn Jobs](https://www.linkedin.com/company/factorialhr/jobs/) | — |
| Fever | [Careers](https://careers.feverup.com) | [LinkedIn Jobs](https://www.linkedin.com/company/fever-up/jobs/) | [greenhouse · feverup](https://job-boards.greenhouse.io/feverup) |
| Finom | [Careers](https://careers.finom.co/) | [LinkedIn Jobs](https://www.linkedin.com/company/finomhq/jobs/) | [lever · pnlfin](https://jobs.eu.lever.co/pnlfin) |
| FREENOW | [Careers](https://www.free-now.com/career/) | [LinkedIn Jobs](https://www.linkedin.com/company/freenow/jobs/) | [greenhouse · freenow](https://job-boards.greenhouse.io/freenow) |
| Glovo | [Careers](https://jobs.glovoapp.com) | [LinkedIn Jobs](https://www.linkedin.com/company/glovo-app/jobs/) | [smartrecruiters · DeliveryHero](https://careers.smartrecruiters.com/DeliveryHero) |
| GoCardless | [Careers](https://job-boards.greenhouse.io/gocardless) | [LinkedIn Jobs](https://www.linkedin.com/company/gocardless/jobs/) | [greenhouse · gocardless](https://job-boards.greenhouse.io/gocardless) |
| Google | [Careers](https://www.google.com/about/careers/applications/jobs/results/) | [LinkedIn Jobs](https://www.linkedin.com/company/google/jobs/) | — |
| Grafana Labs | [Careers](https://grafana.com/careers/) | [LinkedIn Jobs](https://www.linkedin.com/company/grafana-labs/jobs/) | [greenhouse · grafanalabs](https://job-boards.greenhouse.io/grafanalabs) |
| Grover | [Careers](https://jobs.grover.com) | [LinkedIn Jobs](https://www.linkedin.com/company/grover/jobs/) | [greenhouse · grover](https://job-boards.greenhouse.io/grover) |
| Heetch | [Careers](https://heetch.com/jobs) | [LinkedIn Jobs](https://www.linkedin.com/company/heetch/jobs/) | [lever · heetch](https://jobs.lever.co/heetch) |
| HelloFresh | [Careers](https://careers.hellofresh.com/) | [LinkedIn Jobs](https://www.linkedin.com/company/hellofresh/jobs/) | — |
| hey contact heroes GmbH | [Careers](https://www.hey-contact-heroes.de/karriere.html) | [LinkedIn Jobs](https://www.linkedin.com/company/hey-contact-heroes-gmbh/jobs/) | — |
| Hostinger | [Careers](https://www.hostinger.com/career) | [LinkedIn Jobs](https://www.linkedin.com/company/hostinger/jobs/) | [ashby · hostinger](https://jobs.ashbyhq.com/hostinger) |
| IAPWE | — | [LinkedIn Jobs](https://www.linkedin.com/company/iapwe-international-association-of-professional-writers-and-editors/jobs/) | — |
| idealista | — | [LinkedIn Jobs](https://www.linkedin.com/company/idealista-com/jobs/) | — |
| iMerit Technology | [Careers](https://imerit.ai/careers/) | [LinkedIn Jobs](https://www.linkedin.com/company/imerit/jobs/) | — |
| Inditex | [Careers](https://www.inditexpeople.com) | [LinkedIn Jobs](https://www.linkedin.com/company/inditex/jobs/) | — |
| King | [Careers](https://careers.king.com/us/en) | [LinkedIn Jobs](https://www.linkedin.com/company/king/jobs/) | — |
| Klarna | — | [LinkedIn Jobs](https://www.linkedin.com/company/klarna/jobs/) | — |
| KoboToolbox | — | [LinkedIn Jobs](https://www.linkedin.com/company/kobotoolbox/jobs/) | — |
| Labhouse | [Careers](https://jobs.ashbyhq.com/labhouse) | [LinkedIn Jobs](https://www.linkedin.com/company/labhousemobile/jobs/) | [ashby · labhouse](https://jobs.ashbyhq.com/labhouse) |
| Lemon.io | [Careers](https://lemonio.bamboohr.com/careers/) | [LinkedIn Jobs](https://www.linkedin.com/company/lemoneyeo/jobs/) | [ashby · lemon-io](https://jobs.ashbyhq.com/lemon-io) |
| Lodgify | [Careers](https://www.lodgify.com/careers/) | [LinkedIn Jobs](https://www.linkedin.com/company/lodgify/jobs/) | [lever · lodgify](https://jobs.lever.co/lodgify) |
| Manychat | [Careers](https://careers.manychat.com/) | [LinkedIn Jobs](https://www.linkedin.com/company/manychat/jobs/) | [ashby · manychat](https://jobs.ashbyhq.com/manychat) |
| MediaMarktSaturn | [Careers](https://careers.mediamarktsaturn.com/MediaMarktSaturn/?locale=de_DE&currentPage=1&pageSize=25&addresses%2Fcountry=DEU) | [LinkedIn Jobs](https://www.linkedin.com/company/media-markt-saturn/jobs/) | — |
| Meta | [Careers](https://www.metacareers.com/jobs/) | [LinkedIn Jobs](https://www.linkedin.com/company/meta/jobs/) | — |
| Mitre Media | — | [LinkedIn Jobs](https://www.linkedin.com/company/mitre-media-corp-/jobs/) | — |
| Mollie | [Careers](https://jobs.mollie.com/) | [LinkedIn Jobs](https://www.linkedin.com/company/molliepayments/jobs/) | — |
| Multiverse Computing | [Careers](https://multiversecomputing.com/join-us) | [LinkedIn Jobs](https://www.linkedin.com/company/multiversecomputing/jobs/) | — |
| N26 | [Careers](https://n26.com/en-eu/careers) | [LinkedIn Jobs](https://www.linkedin.com/company/n26/jobs/) | — |
| Nexthink | [Careers](https://nexthink.com/company/careers) | [LinkedIn Jobs](https://www.linkedin.com/company/nexthink/jobs/) | [smartrecruiters · Nexthink](https://careers.smartrecruiters.com/Nexthink) |
| Pennylane | [Careers](https://www.pennylane.com/fr/careers) | [LinkedIn Jobs](https://www.linkedin.com/company/pennylaneaccounting/jobs/) | [ashby · pennylane](https://jobs.ashbyhq.com/pennylane) |
| Perk | [Careers](https://www.perk.com/careers/) | [LinkedIn Jobs](https://www.linkedin.com/company/perk/jobs/) | [ashby · perk](https://jobs.ashbyhq.com/perk) |
| Photoroom | [Careers](https://jobs.ashbyhq.com/photoroom) | [LinkedIn Jobs](https://www.linkedin.com/company/photoroom/jobs/) | [ashby · photoroom](https://jobs.ashbyhq.com/photoroom) |
| Preply | [Careers](https://preply.com/en/careers) | [LinkedIn Jobs](https://www.linkedin.com/company/preply/jobs/) | [ashby · preply](https://jobs.ashbyhq.com/preply) |
| Roamless | [Careers](https://roamless.com/careers) | [LinkedIn Jobs](https://www.linkedin.com/company/roamless/jobs/) | — |
| Rover | [Careers](https://www.rover.com/careers/) | [LinkedIn Jobs](https://www.linkedin.com/company/roverdotcom/jobs/) | [lever · rover](https://jobs.lever.co/rover) |
| Sanctuary Computer Inc | [Careers](https://www.sanctuary.computer/info) | [LinkedIn Jobs](https://www.linkedin.com/company/sanctuary-computer/jobs/) | — |
| Scandit | [Careers](https://www.scandit.com/careers/) | [LinkedIn Jobs](https://www.linkedin.com/company/scandit/jobs/) | — |
| Scopely | [Careers](https://www.scopely.com/en/join-us) | [LinkedIn Jobs](https://www.linkedin.com/company/scopely/jobs/) | [greenhouse · scopely](https://job-boards.greenhouse.io/scopely) |
| Smadex | [Careers](https://smadexslu.applytojob.com/) | [LinkedIn Jobs](https://www.linkedin.com/company/smadex/jobs/) | — |
| Socialpoint | [Careers](https://job-boards.greenhouse.io/spcareers) | [LinkedIn Jobs](https://www.linkedin.com/company/social-point/jobs/) | [greenhouse · spcareers](https://job-boards.greenhouse.io/spcareers) |
| Spotify | [Careers](https://www.spotifyjobs.com/) | [LinkedIn Jobs](https://www.linkedin.com/company/spotify/jobs/) | — |
| SumUp | [Careers](https://www.sumup.com/careers/) | [LinkedIn Jobs](https://www.linkedin.com/company/sumup/jobs/) | — |
| Thunes | [Careers](https://www.thunes.com/jobs/) | [LinkedIn Jobs](https://www.linkedin.com/company/thunespayments/jobs/) | — |
| TK Elevator | [Careers](https://career.tkelevator.com/en) | [LinkedIn Jobs](https://www.linkedin.com/company/tke-global/jobs/) | — |
| Typeform | [Careers](https://www.typeform.com/careers) | [LinkedIn Jobs](https://www.linkedin.com/company/typeform-com/jobs/) | [greenhouse · typeform](https://job-boards.greenhouse.io/typeform) |
| Ubisoft | [Careers](https://www.ubisoft.com/en-us/company/careers/search) | [LinkedIn Jobs](https://www.linkedin.com/company/ubisoft/jobs/) | — |
| Unio Digital | [Careers](https://unio.digital/company/careers) | [LinkedIn Jobs](https://www.linkedin.com/company/uni%C3%B3-digital/jobs/) | — |
| Wallapop | [Careers](https://boards.eu.greenhouse.io/wallapop) | [LinkedIn Jobs](https://www.linkedin.com/company/wallapop/jobs/) | [greenhouse · wallapop](https://job-boards.greenhouse.io/wallapop) |
| Wise | [Careers](https://www.wise.jobs/) | [LinkedIn Jobs](https://www.linkedin.com/company/wiseaccount/jobs/) | — |
| Wolt | [Careers](https://careers.wolt.com/) | [LinkedIn Jobs](https://www.linkedin.com/company/wolt-oy/jobs/) | — |
| Yazio | [Careers](https://www.yazio.com/en/jobs) | [LinkedIn Jobs](https://www.linkedin.com/company/yazio-gmbh/jobs/) | [ashby · yazio](https://jobs.ashbyhq.com/yazio) |
| Zalando | [Careers](https://jobs.zalando.com/en/jobs) | [LinkedIn Jobs](https://www.linkedin.com/company/zalando/jobs/) | — |

## Хранение, правила и проверка

`npm test`: **141 tests / 18 files**, TypeScript/Vite build, HTTP и MCP integration checks успешны. В браузере проверены ссылки и их реальные href/target в ячейке и внизу модалки Wise, отсутствие неподтверждённых ссылок у Credit Wellness, LLC; console warn/error отсутствуют. Skill прошёл quick_validate. Screenshot: `.runtime/careers-audit-2026-10-19/careers-column.png`.

Перед записью выполнен проверенный WAL-aware SQLite backup. Проверена неизменность всех 110 ATS-карточек и полей компаний вне hiringSources/updatedAt, включая Radar identity, scores и личные заметки. Research observations/flags не добавлялись. Приложение и схема сохраняют новые поля при обычном редактировании и JSON export/import; конфликтующая LinkedIn identity другой компании отклоняется.

[Операционный skill](../.agents/skills/jobs-discovery/SKILL.md) теперь требует Careers/ATS до агрегаторов и содержит адресный веб-мониторинг. [Подробные правила LinkedIn](../discovery/hiring-sources.md). Единственный repository-owned skill Jobs Checker — jobs-discovery; отдельного jobs-monitoring пока нет, сценарий включён в jobs-discovery. Технический мониторинг также доступен существующим MCP jobs_monitor_companies, но инструмент не является скиллом.

Локальные inventory, HTTP receipts, поисковая выдача, reviewed-links, preview/apply receipts и скриншоты: ignored `.runtime/careers-audit-2026-10-19/`.

Завершённый research run: `ac7d21cd-8e0c-4aae-b85d-5c8e3640861d`.
