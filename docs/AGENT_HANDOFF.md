# Журнал изменений и передачи между ИИ-агентами

Каждый агент **обновляет этот файл в том же PR**, где меняет код/документацию, либо отдельным PR, если действие выполнено вне GitHub. Всегда отмечать, **что реально попало в production**, а что осталось в PR.

## Формат новой записи

- **Когда (UTC), кто / задача**:
- **Ветка, commit SHA, PR / issue**:
- **Что изменилось и зачем**:
- **Затронутые компоненты / пути**:
- **Тесты: подтверждено / не запускалось**:
- **Продакшен: не менялся / Vercel deployment ID / Supabase Edge version / Android APK**:
- **Откат, ограничения и следующий шаг**:

Новые записи добавлять **сверху**; не удалять чужие записи.

---

## 2026-11-17: срочный веб-хотфикс восьмизначных OTP и проверки сессии

- **Задача:** владелец сообщил, что реальный код содержит 8 цифр, а форма CORTEX принимает 6, и что вход выглядит успешным при случайных данных.
- **Ветка:** `hotfix/cortex-web-eight-digit-otp-20261117`, основа `main` SHA `778ed7f`; PR/deploy фиксируются после CI.
- **Изменения:** веб-OTP теперь принимает 8 цифр в 8 ячейках, корректно обрабатывает вставку; после логина/OTP сверяется подтверждённый email через Supabase Auth `getUser()`.
- **Файлы:** `cortex-web/components/OtpCodeInput.tsx`, `Registration.tsx`, `app/globals.css`.
- **Проверки:** `npm run lint --prefix cortex-web` пройден; сборка и GitHub CI перед релизом.
- **Production:** на момент создания записи не менялся. Существующий обратный путь — предыдущий Vercel production deployment `dpl_FrtTPcMdDAw2LN2sceBFVYfrDAsc`.
- **Отдельный блокер доставки:** live Supabase Auth logs показали `template: ... function "D1" not defined` для confirmation template. Репозиторные шаблоны используют корректное `{{ .Token }}`, но их необходимо применить к реальным Auth Templates в Supabase Dashboard. Контрольная панель Supabase в браузере запросила вход; не менять живой SMTP/шаблоны без авторизованной сессии.


## 2026-11-17: отдельное исключение для публичной веб-регистрации по требованию владельца

- **Агент / задача:** владелец явно потребовал открыть веб-регистрацию всем, осознавая, что локализация персональных данных в РФ ещё не выполнена. Не выдавать техническое открытие за юридическое соответствие.
- **Основа / ветка:** от `main` `d3e6d4cacb53a8d5c2fc5410744e17a1c6aff102`, `feat/cortex-public-registration-20261117`; отдельный сайт/документация, **не включать Android PR #57 в этот релиз**. Итоговый PR/SHA уточнить после отправки GitHub.
- **Изменения:** `cortex-web/lib/registration-gate.ts` добавляет обратимый путь только при двух явных production-флагах: `CORTEX_ENABLE_REGISTRATION=true` и `CORTEX_PUBLIC_SIGNUP_EXCEPTION=true`. `CORTEX_RF_DATA_COMPLIANCE_VERIFIED` остаётся ложным/отсутствующим, адреса операторов не выдумываются. Обновлены тест, `tsconfig.json` (импорт `.ts` для Node-тестов), `.env.example`, README, security gate и достоверное описание текущей обработки в `/privacy`.
- **Проверки / продакшен:** до выпуска тесты/CI и отдельный новый production deployment обязательны. На момент начала работы `cortexapp.ru` открыт публично через `ssoProtection=all_except_custom_domains`, `main` deployment `dpl_3hRmFmcdnr2sSHGSyfgqwRsJhwto` READY; `/api/healthz` 200, `/api/status` 200 `cache: degraded`, `/api/internal/notify-beta` 401. Supabase `jjcqrjztxohnifmziksy` ACTIVE_HEALTHY в `eu-west-1`; auth settings показывают `disable_signup=false`, `mailer_autoconfirm=false`. Код/SQL/Edge Supabase не менять.
- **Риски / откат / следующий шаг:** требования локализации данных граждан РФ не выполнены; два юридических адреса не настроены; антибот CAPTCHA для прямого Supabase Auth signup не проверена, Redis на сайте не настроен. **Внешняя регистрация через Supabase уже была разрешена**, но UI оставался закрыт. Не заявлять о полной юридической готовности, не подделывать compliance-флаг. Для отката выключить `CORTEX_PUBLIC_SIGNUP_EXCEPTION`, повторно задеплоить сайт и проверить UI. Продолжить миграцию персональных данных в РФ, проверку SMTP/OTP, CAPTCHA, RLS двух аккаунтов и бизнес-лимитов до массовой рекламы.

## 2026-11-17: AGENTS.md синхронизирован с релизом Edge v45

- **Агент / задача:** устранить устаревшее указание на v44 и «отсутствующую SQL-миграцию» в обязательном корневом `AGENTS.md`, чтобы другой агент не начал с неверного источника.
- **Основа / файлы:** ветка `docs/agent-rules-edge-v45-20261117` от `main` SHA `b1624bfa5c193a5b2aee8276bba5458166bf90f7`; `AGENTS.md`, `docs/AGENT_HANDOFF.md`.
- **Проверки:** документация сверена с ACTIVE Supabase Edge v45 и commit `60f5b91`. Исходники не менялись; повторная сборка для docs-only не нужна.
- **Production:** Supabase v45 и Vercel остаются без нового кода; новый Vercel docs-only build может автоматически стартовать после слияния.
- **Следующий шаг:** продолжить полноценную server-side Android hardware attestation и наблюдение WAF только после согласования правильного APK и проверки реального трафика.

## 2026-11-17: PR #54 объединён, Edge v45 опубликован и проверен

- **Агент / задача:** завершить три security-правки из PR #54, подтвердить реальные статусы в GitHub/Vercel/Supabase.
- **Репозиторий:** PR [#54](https://github.com/stasaleksandrov481-netizen/mobile-framework-dev/pull/54) слит в `main` squash SHA `60f5b91ed56034cbcd278181faee636cdc44b0de`; UI сайта/Android не менялся. Полный список файлов и ограничений: `docs/SECURITY_THREE_FIXES_20261117.md`.
- **CI:** Edge regression **50/50**, billing **6/6**, Android build/unit/web/tests, CodeQL и AI Handoff Gate **success** на PR head SHA `ee3afe928bdbe2a4e4e14f5006648d6ff29a6a94`. Debug APK собрана в Actions run `44031608642`, **не является подписанной публичной версией**.
- **Supabase production:** Edge Function `cortex` обновлена с **v44 до ACTIVE v45**. Deployment `ezbr_sha256=5e5e9ddedaa9a544fac1f820730bffabeb71047544de99133e4f1788920d9403`. После деплоя повторно прочитаны 11 файлов, все совпадают с `main` (10 файлов из v44 неизменны; в `handler.ts` только доверенный IP-бакет). `verify_jwt=false` сохранён согласно текущему собственному auth handler. Предыдущее содержимое v44 было проверено и может служить исходником отката.
- **SQL production:** **НЕ применялась** новая исходная baseline миграция `20261117080100_cortex_device_identity_baseline.sql`: таблицы, RLS, grants и RPC уже есть и работают в текущей БД. Базу не перезаписывали; на свежем развёртывании миграцию нужно применить в штатном порядке.
- **Vercel production:** READY deployment `dpl_4cfAXSvfyyyQ37yBDfpswe4xR448`, ref `main`, SHA `60f5b91`, проект `mobile-framework-dev`. Предыдущее рабочее развёртывание `dpl_2nA3ZV9LgTPLXYgKSQK6YfH6yYsu` (SHA `d0d1932`) — кандидат отката.
- **Ограничения:** прямой GET smoke-test внешним инструментом недоступен, но ACTIVE и исходники функции подтверждены через Supabase API; не писать, что публичный E2E выполнен. Android release signer guard — только локальный механизм, аппаратной attestation нет; APK и правильный UI не согласованы. Managed Vercel WAF `gen/rce/sqli/xss` в `log`, без анализа трафика не блокировать.
- **Следующему агенту:** начинать от `main` SHA `60f5b91`, Supabase **v45**. Не деплоить устаревшую v44, не публиковать APK до сверки дизайна. Для полноценной верификации Android потребуется доверенная цепочка hardware key attestation, одноразовые вызовы и тесты на реальных устройствах; перед включением WAF block — проверить лог и ручной publish владельца.

## 2026-11-17: три усиления безопасности (ветка, до CI/деплоя)

- **Агент / задача:** контроль официальной подписи Android release APK, защита IP-бакетов прямого Supabase Edge, фиксация приватного device RPC в SQL-миграции.
- **Ветка:** `security/three-hardening-fixes-20261117` от `main` SHA `d0d1932ea7afd3361eabbf510f50cc72a44c8322`. Коммиты в ветке: `f0199f2` (SQL), `c377530` (Edge IP), `aa762c1` (тест), `1135419`, `4300d22`, `c4080b0` (Android), `fc051e3` (уточнение безопасности), `7a6960a` (runbook).
- **Файлы:** `supabase/migrations/20261117080100_cortex_device_identity_baseline.sql`, `supabase/functions/cortex/handler.ts` и `handler.test.ts`, `app/build.gradle.kts`, `app/src/main/java/app/cortex/assistant/CortexApkIntegrity.kt`, `CortexServerBridge.kt`, `docs/SECURITY_THREE_FIXES_20261117.md`.
- **Проверки:** контракт тестов Edge + GitHub Actions Android/Web/CodeQL **ожидаются** после открытия PR. SQL-схема сверена read-only по `pg_catalog` в действующем Supabase: первичные ключи, CHECK, RLS, grants, точное определение RPC. Миграция не применялась к production.
- **Production:** **не менялся** при создании записи: Supabase Edge v44, Vercel READY на `main` SHA `d0d1932`, Android public APK не выпускалась. Managed Vercel WAF `gen/rce/sqli/xss` в `log`; настройку без анализа трафика не публиковать.
- **Ограничения:** локальный Android signer check не является аппаратной аттестацией, изменённый APK может его обойти; `X-Cortex-Device` остаётся подделываемым. Защищённый IP через Supabase `CF-Connecting-IP` и общий fallback имеют смысл только для hosted ingress. Сначала завершить CI и проверить runtime snapshot перед Edge v45; после любого деплоя обновить здесь SHA/version/deployment ID.
- **Следующему агенту:** перед дальнейшими Android/UI правками согласовать у владельца SHA одобренного интерфейса; hardware attestation проектировать server-verified и fail-open на время миграции. До включения CRS-blocking проверить ложные срабатывания и получить ручную публикацию владельца.

## 2026-11-17: итог security-merge и фактического деплоя сайта

- **Агент / задача:** закончить проверенную синхронизацию Edge v44, закрепить CI и передать точный release snapshot.
- **Ветка и коммит:** [PR #52](https://github.com/stasaleksandrov481-netizen/mobile-framework-dev/pull/52) слит в `main` на `15cad8ba025587581b12af2749df937a7b84e7ea`; отдельный docs-only PR обновляет этот журнал.
- **Исходники:** все 11 файлов `supabase/functions/cortex/` по содержимому совпадали с живой Edge v44 на момент синхронизации. UI Android, сайт и платежи не менялись, только исходники Edge, автоматические тесты и документация.
- **Проверки:** CI PR #52 на SHA `f664136ff0de792fe1052c428cb1c1c5ad6eb7df` полностью `success`: 49/49 Edge, 6/6 billing, CodeQL, Handoff Gate, полный Android/build/web test suite. Debug APK `CORTEX-test-debug-158`, workflow run `44029859687`, artifact `14304224675`; **не подписанный публичный релиз**.
- **Vercel production:** auto-deployment `dpl_F7dquhdgkYMXdFkybFVAqH84DzjL` **READY**, `main` SHA `15cad8b`, alias `cortexapp.ru`. Визуальная/авторизованная ручная проверка UI не проведена; в сайт программно не вносилось изменений.
- **Supabase production:** Edge Function `cortex` остаётся **ACTIVE v44**, никаких функций/миграций не выкатывали. Не публиковать старую SQL-версию; `cortex_ai_device_identity` и связанные private-таблицы имеют работающую схему, но отсутствует подтверждённая миграция в GitHub.
- **Риски и следующий шаг:** `X-Cortex-Device` — подделываемый Android ID, не доказательство подлинности; Vercel WAF `gen/rce/sqli/xss` работает в `log` и не защищает прямой Supabase API. Требуются проверенная attestation с безопасной деградацией для устройств без Google Play, анализ трафика перед блокирующим WAF, SQL migration baseline, подтверждение одобренного APK и отдельный подписанный релиз. Исходный Vercel rollback-кандидат: `dpl_BJ3FBazwuDZqM1nsYN88fyxgJoMo` (SHA `6f144ca`).

## 2026-11-17: сверка безопасности Supabase Edge v44 с исходниками

- **Агент / задача:** подготовка защищённой основы для дальнейших исправлений после запроса владельца.
- **Ветка / PR:** `security/sync-edge-runtime-v44-20261117`; [PR #52](https://github.com/stasaleksandrov481-netizen/mobile-framework-dev/pull/52) слит в `main` squash SHA `15cad8ba025587581b12af2749df937a7b84e7ea`.
- **Проверка:** через Supabase API считаны все **11 файлов** текущей Edge Function `cortex` v44. С `main` совпадают 8; в GitHub устарели `handler.ts` и `provider.ts`, а `settings.ts` отсутствует. Никаких ключей не извлекали.
- **Изменения:** три файла приводятся к **побайтовому соответствию** действующей v44; тесты Edge дополняются контрактом `X-Cortex-Device`, лимитом `chat:device` и белым списком настроек. Лимиты, биллинг и UI production не изменяются.
- **База данных:** advisory `rls_enabled_no_policy` на закрытых таблицах является ожидаемым deny-by-default; функции `SECURITY DEFINER` требуют AAL2, одноразовые секреты или конкретную роль и не должны быть массово отозваны. Есть предупреждение о выключенной leaked-password protection. RPC `cortex_ai_device_identity` существует в живой БД, но **её исходная миграция в GitHub ещё не подтверждена**: выкатывать из чистой БД без проверки нельзя.
- **Платежи:** `cortex-control/api/billing.js` сверяет webhook-секреты и запрашивает подтверждение транзакции непосредственно у Platega. SQL `cortex_billing_payment` проверяет сумму/провайдера и защищает повторные состояния транзакционной блокировкой. Внешний реальный платёж не тестировался.
- **Тесты:** workflow `CORTEX Edge and Billing Regression Tests`, run `44029673882`: **49/49 Edge и 6/6 Platega прошли**. `AI Handoff Gate`: success; сборка Android и CodeQL проверяются отдельно. В workflow добавлена явная проверка Node TypeScript и биллинга при каждом затрагивающем PR.
- **Production:** Supabase остаётся v44, Vercel и Android **не менялись**. WAF managed `gen/rce/sqli/xss` пока в `log`; перевод в `deny` требует наблюдения за трафиком и отдельной публикации владельцем.
- **Откат и следующий шаг:** PR можно откатить обычным revert. Сверить edge миграции с фактической БД, проверить CI и затем отдельно поднимать серверную защиту. Не считать `X-Cortex-Device` аппаратной аттестацией, поскольку заголовок можно подделать.

## 2026-11-17: релиз объединён в main и опубликован сайт

- **PR и commit:** [#49](https://github.com/stasaleksandrov481-netizen/mobile-framework-dev/pull/49) объединён squash-коммитом `05a18101c67b121db7ac64fcbd9c9fe27c6c988c`.
- **Состав:** пять Android-файлов нового островка из PR #46, `CortexServerBridge.kt` из PR #47, документация и CI gate из PR #48, ускоренная per-PR Gradle concurrency.
- **Проверки:** Android APK + unit/integration tests, website build/lint, CodeQL Security Scan и Agent Handoff Gate — **success** для объединённой ветки `cae7db6fa60a526f9d2a79678df185b477cd0717`.
- **APK:** тестовый debug-артефакт `CORTEX-test-debug-146`, GitHub Actions run `43959855136`, ZIP артефакт `14274190711`. **Не является подписанным публичным APK**. UI на физическом устройстве не проверен.
- **Vercel production:** проект `mobile-framework-dev`, домен `cortexapp.ru`, deployment `dpl_uf52Do9kUru568A2SttwLYGKw74h`, **READY**, SHA `05a1810`. Авторизованный GET `https://cortexapp.ru` вернул HTTP 200. В проверенном диапазоне runtime errors нет.
- **Supabase:** Edge `cortex` остался **ACTIVE v44**, не перезаписывался. GitHub-copy устарела относительно runtime; миграции не применялись.
- **Координация:** PR #46, #47, #48 закрыты с комментариями об интеграции. Следующим агентам работать от текущего `main` и сверять live Supabase. PR #41 остаётся конфликтующим и не интегрирован.
- **Следующий шаг:** подтвердить отображение Android на тестовом устройстве; после подтверждения отдельно инициировать подписанный beta release через проверенный ключ. Не объявлять публичную APK доступной раньше времени.

## 2026-11-17: единый проверяемый релиз CORTEX, без смены backend

- **Агент / задача:** собрать в одной ветке актуальные изменения островка и Android-защиты после сообщения пользователя о перепутанном интерфейсе.
- **Релизная ветка:** `release/cortex-unified-20261117`, создана из `docs PR #48` на SHA `d6a685b645d8b9a1eaa8480d3434a7624cc8fbe5`.
- **Источники:** пять файлов нативного островка, Markdown и команд из [PR #46](https://github.com/stasaleksandrov481-netizen/mobile-framework-dev/pull/46) SHA `40140290336dfcdba9d2a269d29223b1d28b27d8`; `CortexServerBridge.kt` из [PR #47](https://github.com/stasaleksandrov481-netizen/mobile-framework-dev/pull/47) SHA `7576f248b2b116df180ec33b01511a5b3c798926`.
- **Изменения:** 6 Android-файлов, ранее подготовленная документация, GitHub Actions `android-apk.yml`: сборки из разных PR больше не блокируют друг друга, устаревшие проверки одного PR отменяются. `cortex-web/`, `cortex-control/`, Supabase, миграции и платёжные пути не затронуты.
- **Тесты:** исходные PR #46 и #47 прошли Android + Security CI; для объединённой ветки необходимы отдельные Android, Security и Handoff Gate проверки.
- **Production:** **не менялся** в момент создания записи; новая APK/Edge Function не опубликована.
- **Откат/ограничения:** пользователь всё ещё должен подтвердить, что именно интерфейс из #46 соответствует желаемому. Сборку нельзя считать одобренной без проверки на устройстве. Supabase v44 не перезаписывать. Конфликтующий [PR #41](https://github.com/stasaleksandrov481-netizen/mobile-framework-dev/pull/41) и 22 дивергентные ветки не были слиты вслепую.
- **Следующий шаг:** проверить CI, точный merged SHA, Android APK, staging/production и оставить итоговую запись с подтверждённым состоянием.

## 2026-11-17: защита квоты устройства, сверка с production

- **Агент / задача:** аудит гостевых лимитов ИИ и передача заголовка устройства Android.
- **PR:** [#47](https://github.com/stasaleksandrov481-netizen/mobile-framework-dev/pull/47); ветка `security/stable-guest-device-quota-20261117`.
- **Изменения:** Android теперь отправляет существующий `X-Cortex-Device` для API-запросов и речи, а не только `presence`. Первоначальную серверную правку и её тесты **откатили внутри PR**, поскольку активная Edge Function v44 значительно новее GitHub `main`. В PR должен остаться только `CortexServerBridge.kt`.
- **Тесты:** первая ревизия PR прошла GitHub Android build и Security Scan. После удаления серверных изменений требуется повторная проверка нового head SHA.
- **Production:** не менялся; **никакая новая APK, сайт или Edge Function этим PR пока не опубликованы**.
- **Риск:** живой Edge-код v44 ждёт заголовок `X-Cortex-Device` для бесплатных ИИ-запросов; опубликованные старые Android версии могут отвечать `client_version` 426. Заголовок подделываемый.
- **Следующий шаг:** установить одобренную пользователем Android UI-ветку/сборку; затем перенести точечную правку в неё и выпускать только проверенный APK. Отдельным PR синхронизировать исходники Edge с production.

## 2026-11-17: безопасность релизов и порядок в репозитории

- **Агент / задача:** создать `AGENTS.md`, инвентарь релизов, этот журнал и PR-шаблон.
- **Ветка / PR:** `chore/agent-handoff-release-guard-20261117`, [#48](https://github.com/stasaleksandrov481-netizen/mobile-framework-dev/pull/48).
- **Изменения:** обязательный `AGENTS.md`, актуальный релизный инвентарь, PR-шаблон, предупреждение в README и GitHub Actions `agent-handoff.yml`: runtime-PR без журнала будет отклонён; Edge-PR также требует новой сверки инвентаря.
- **Production:** функциональные изменения не планируются; документацию не следует считать деплоем защиты.
- **Аудит веток:** проверены все 53 ветки относительно `main`: 13 уже включены, 22 разошлись, 3 впереди, 14 Dependabot. Список и запреты удаления в `docs/BRANCH_REGISTRY.md`.
- **Координация:** в открытый [PR #46](https://github.com/stasaleksandrov481-netizen/mobile-framework-dev/pull/46) другого агента добавлен прямой комментарий с предупреждением о расхождении UI и Supabase v44; его файлы не менялись.
- **Ограничение:** эти правила работают лишь для агентов, которые читают репозиторий. Внешним параллельно запущенным агентам нужно передать ссылку на этот документ и PR.
