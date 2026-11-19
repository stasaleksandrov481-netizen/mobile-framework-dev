# Инвентаризация релизов CORTEX

## 19.11.2026 — Android 1.0.18-beta.3 опубликован

- Release `v1.0.18-beta.3` / code **120**, commit `b079f1e786edc1545359ead13e524d8294e5e1ee`, PR #84, workflow `44478498107` **SUCCESS** (сборки, тесты, lint, постоянная подпись, публикация и проверка скачивания).
- [CORTEX-1.0.18-beta.3.apk](https://github.com/stasaleksandrov481-netizen/mobile-framework-dev/releases/download/v1.0.18-beta.3/CORTEX-1.0.18-beta.3.apk), 19 031 316 байт. SHA256 `9dff5271ff352133e5283c8cfc959658bb9cc11dc863611425cef0bc9bbdaeae`; APK независимо скачан и проверен. Сертификат совпадает с beta.1, пакет `app.cortex.assistant`; 25 WebView-файлов и нативная демонстрация включены.
- Старые `v1.0.18-beta.1` / `v1.0.17` сохранены. Это prerelease: стабильный GitHub latest остаётся отдельным каналом. Прежняя ошибка не была ошибкой компиляции — блокировалась попытка присвоить новому коммиту уже занятый номер beta.1. Теперь версия/тег/code проверяются до сборки, а бета подтверждается по своему тегу/коммиту/файлам.
- UI и код приложения после одобренного merge #83 не переделывались; в этом исправлении изменены версия и процесс выпуска. Действия демонстрации на физических устройствах ещё не проверены. Сайт, Supabase и БД не обновлялись этой работой. Подробности: `docs/AGENT_HANDOFF.md`.

## 19.11.2026 — восстановление публикации Android APK (в работе)

Ручной workflow `44474766061` на main `6d4bbbd` успешно собрал и подписал APK, но отказался переиспользовать уже занятый тег `v1.0.18-beta.1`. Подготовлена отдельная ветка `fix/cortex-apk-release-20261119`: `1.0.18-beta.3` / code 120, ранняя проверка версии/неизменности тегов, проверка скачанной беты по собственному тегу. beta.2/code119 остаётся в отдельном несвязанном draft PR #79. Старые опубликованные APK не заменены. Новый релиз будет подтверждён только после успешного CI и проверки скачанного файла.

Сверено read-only: Supabase cortex ACTIVE v48; Vercel production READY `dpl_HRA7RyqX7unzAG4QuMWSVHiFavrY`, старый согласованный web source `3d8c81e`. Этот Android patch не меняет Edge, БД или сайт. Подробности и оставшиеся проверки — в `docs/AGENT_HANDOFF.md`.

## 18.11.2026 19:20 UTC — противодействие DDoS, Edge v47 → кандидат v48

- На `cortexapp.ru` Vercel обнаружил активный DDoS-эпизод с `18:45Z`: **1 206 282 запроса** за указанную минуту, системная защита `sys_dos_mitigation:challenge`; проверенные страницы и `/api/status` возвращают HTTP 200. WAF v10 продолжает deny 14 exploit-paths и rate-limit статуса 120/мин/IP, наблюдает POST endpoints оплаты в режиме `log`. Cloudflare DNS-only, не является активным WAF этого домена.
- Живой Supabase `cortex` **ACTIVE v47**, `verify_jwt:false`. Считаны и сравнены все **11** файлов: после PR #73 в текущем `main` они совпадают с v47. Ранее обнаруженное расхождение `visual.ts`/таймаутов `handler.ts` теперь включено в `main`, не терять его. Изменений SQL в данном патче нет.
- В PR #76 подготовлен только глобальный финансовый предохранитель: `chat:all:minute` 2000/мин и `chat:all:day` 50000/сут в существующем атомарном SQL `cortex_reserve` перед вызовом OpenRouter. Он действует на все аккаунты, не затрагивает регистрацию, платежи, UI и Android. `CORTEX_CHAT_GLOBAL_MINUTE_LIMIT`/`CORTEX_CHAT_GLOBAL_DAILY_LIMIT` имеют безопасные ограниченные диапазоны. 73/73 Edge-тестов; `git diff --check` чистый.
- **В production ещё не опубликован**: текущая live версия остаётся v47 до повторной сверки всех 11 исходников, наличия нужного RPC и проверки CI. Rollback: v47 из main `be5eab98bdb0421489440f44fe7680a5c6a13361`; нельзя перекатить старый Edge v46. Дизайн сайта должен оставаться на Vercel `dpl_AdZ76xMyr3Z7PJMETG31yCUYqgKj` до восстановления web source.

## 18.11.2026 — подготовка beta brain PR #73 (не production)

- Supabase `cortex` Edge ACTIVE **v46**, на момент проверки файлы `handler.ts`, `provider.ts`, `visual.ts`, `singleflight.ts`, `device.ts`, `settings.ts` идентичны ветке `main` SHA `3d8c81eb`. Проверка выполнена до правок PR #73.
- В PR #73 Edge `handler.ts` и `visual.ts` ускоряют визуальный план (предел 20 с и строгая схема tool-планов). Перед деплоем повторно сверены **все 11 файлов** live v46 с main: полное совпадение. **Продакшен Edge v47 ACTIVE опубликован**, `verify_jwt=false` сохранён. После деплоя повторно проверены все 11 файлов: 11/11 совпали с branch PR #73 (два обновлённых, девять без изменений). Не откатывать v47 из старого GitHub baseline.
- Production DB по запросу пользователя **изменена**: `public.cortex_plans` теперь guest 15k, free 30k, start 80k, pro 180k, ultra 350k токенов в сутки. Проверено SQL чтением и RPC `cortex_ai_usage`; rollback прежних цифр в `docs/BETA_AI_BUDGET_AND_BRAIN_20261118.md`.
- Android `1.0.17` с тегом `v1.0.17` остаётся опубликованным подписанным релизом и rollback-кандидатом. PR #73 **не является beta APK** и не должен автоматически публиковаться без проверок Android CI, реального устройства и подписи.
- Экономика: бесплатный OpenRouter ограничен upstream 20/min, 1000/day при ранее достаточном пополнении; это нельзя исправить повышением токенов. Подписки остаются с checkout_enabled=false и без новой оплаты.


## Сверка 18.11.2026: Android 1.0.17 и подготовленный Gemini TTS

- GitHub `main` = `7a92feaa42beca2d8c6769e4015a4eb026e942e0`, опубликован Android `1.0.17` (все прежние записи ниже относятся к историческому состоянию).
- Production Vercel `cortexapp.ru` связан с READY `dpl_C5Q1YYHYeA63j6YWZUv4Y4qrdUJp` (этот `main`), Supabase Edge `cortex` последней проверкой всё ещё ACTIVE v45.
- На отдельной ветке `fix/cortex-gemini-on-1_0_17` к актуальному серверу перенесены Gemini TTS PCM-stream и выключение гостевого ИИ по умолчанию. В Android 1.0.17 адаптирован клиент потокового звука и закрыт гостевой вход. Это **не production**: live Edge не заменён.
- Server test suite: 71/71, включая совместимость старого speech, Redis, квоты, cancel/settlement, а также отказ устаревшего гостевого флага. Проверка 11 live-файлов v45 до следующей публикации обязательна; версию Edge и SQL повторно сверять непосредственно перед деплоем.
- Ветка содержит две уже применённые на живой БД SQL-миграции `cortex_voice_preferences`: создание таблицы и замена ElevenLabs voice IDs на Gemini Kore/Puck/Charon. **Повторно к production их не применять вручную.**
- На том же baseline отдельная правка сайта переводит OTP с 8 на 6 во всех веб-местах и добавляет тест. Прямой деплой сайта блокируется несоответствием GitHub/одобренного опубликованного UI; до получения точных исходников недопустим визуальный откат.


## Итог опубликованного security-релиза 17.11.2026

PR #54 слит в `main` SHA `60f5b91`. Vercel READY `dpl_4cfAXSvfyyyQ37yBDfpswe4xR448`. Supabase Edge `cortex` **ACTIVE v45**, 11 опубликованных файлов после выпуска совпали с `main`. Полные проверки PR: 50/50 Edge, 6/6 billing, Android CI, CodeQL, Handoff Gate. Подписанная публичная Android APK **не выпускалась**; SQL baseline добавлена в git, действующая БД не менялась. Блокировка managed WAF не включена из-за отсутствия проверки ложных срабатываний. Прежняя v44 доступна как baseline для восстановления при необходимости.

## Изолированная security-ветка 17.11.2026 (не production)

`security/three-hardening-fixes-20261117`: исправляет доверие к подставляемому `X-Forwarded-For` в прямом Supabase Edge, добавляет тесты на IP-спуфинг, исходную SQL-миграцию `cortex_ai_device_identity` и локальный контроль release-подписи Android APK. Подробности: [SECURITY_THREE_FIXES_20261117.md](SECURITY_THREE_FIXES_20261117.md).

До успешного CI и отдельной сверки runtime **продолжает работать Supabase Edge v44**, а production Android **не заменён**. Локальная проверка сертификата APK не равна серверной hardware attestation. Веб-WAF CRS пока наблюдает в `log`; прямой Supabase endpoint им не защищён. Не считать три механизма полностью запущенными.


Проверено 17.11.2026. Это **снимок фактического состояния**, а не команда на публикацию.

| Компонент | Проверенное состояние | Что учитывать |
| --- | --- | --- |
| GitHub default | `main`, security PR #54 merge SHA `60f5b91ed56034cbcd278181faee636cdc44b0de` | Источник текущей Edge v45 и миграции device identity; перепроверять SHA перед работой |
| Vercel production | `mobile-framework-dev` / `cortexapp.ru`; deployment `dpl_4cfAXSvfyyyQ37yBDfpswe4xR448` **READY**, ref `main`, SHA `60f5b91` | Изменения Android UI не публиковались. Rollback `dpl_2nA3ZV9LgTPLXYgKSQK6YfH6yYsu` |
| Android в `main` | `app/build.gradle.kts`: `versionName=1.0.14`, `versionCode=114` | Пользователь 17.11 сообщил о неверном интерфейсе. Одобренную сборку/ветку ещё надо установить |
| Android альтернативы | `release/cortex-1.0.14-20261116`, `fix/cortex-beta-ui-singleflight-20261116`, `audit/beta-stability-20261116` и исторические UI-ветки | Они могут **расходиться с `main`**; не считать ни одну верной без сверки с используемым APK |
| Supabase production | Edge Function `cortex`, **ACTIVE v45**, проект `jjcqrjztxohnifmziksy` | 11 исходных файлов сверены после деплоя; `handler.ts` не доверяет XFF; SQL baseline в main, но не применялась повторно |
| AI device identity | Живая Edge Function использует `rpc/cortex_ai_device_identity` и принимает `X-Cortex-Device` | Функция RPC существует в production; старые Android-вызовы отправляют заголовок лишь на `presence`, а бесплатные AI-вызовы могут возвращать 426 |
| Security PR | [#47](https://github.com/stasaleksandrov481-netizen/mobile-framework-dev/pull/47), `security/stable-guest-device-quota-20261117` | Android-правка объединена с PR #46 и #48 в [PR #49](https://github.com/stasaleksandrov481-netizen/mobile-framework-dev/pull/49), слита в `main` SHA `05a1810` без серверного кода |
| Security sync | [PR #54](https://github.com/stasaleksandrov481-netizen/mobile-framework-dev/pull/54), merge SHA `60f5b91` | 50 Edge + 6 billing тестов, CodeQL, Android/web CI success; локальная проверка APK подписи, SQL baseline и живой Edge v45 |

## Новая интеграционная ветка (17.11.2026)

`release/cortex-unified-20261117` собирает изменения из PR #46 (островок/Markdown/команды), PR #47 (заголовок Android ID) и документы PR #48. Слита в `main` через PR #49, тестовый debug APK собран и сохранён в GitHub Actions run `43959855136`. **Публичный подписанный APK не выпущен**; интерфейс на реальном устройстве ещё не подтверждён. Серверные изменения из старого GitHub-кода намеренно не включены, чтобы не откатить живой Supabase v44.

## Подготовленная синхронизация Edge v44 и аудит безопасности

На ветке `security/sync-edge-runtime-v44-20261117` воспроизводятся все **11** файлов живой функции v44: 8 были идентичны, 2 обновлены (`handler.ts`, `provider.ts`), 1 добавлен (`settings.ts`). Это **не новая версия production** и не основание автоматически публиковать Edge Function. Тесты подстраиваются под реальный обязательный `X-Cortex-Device` для бесплатных запросов; физическая аттестация приложения не реализована.

В Supabase security advisors: 19 информационных предупреждений `RLS enabled no policy` соответствуют закрытым таблицам; 6 предупреждений `SECURITY DEFINER` требуют анализа прав каждой функции (пять проверенных содержат явную авторизацию), массовое `REVOKE` сломает легитимные административные сценарии. Leaked-password protection пока не включена. Для RPC `cortex_ai_device_identity` существует рабочий объект в БД, но SQL-миграция в репозитории ещё не найдена. До её сверки невозможен гарантированно воспроизводимый свежий деплой базы.

## В чём расхождение

**До PR #52** в `main` хранился старый `handler.ts`, а production v44 уже требовал `X-Cortex-Device` и поддерживал изменение настроек. PR #52 переносит 11 файлов с побайтовой проверкой, но не применяется к живой Edge Function. Состояние может вновь разойтись, если другой агент обновит Supabase вне GitHub. Отдельно остаётся несверенная SQL-миграция `cortex_ai_device_identity`. Деплой из устаревшей копии способен **откатить защиту и контракты API**.

## Порядок разрешения

1. Прочитать текущее `AGENTS.md`, этот инвентарь и `docs/AGENT_HANDOFF.md`.
2. Проверить свежие GitHub refs, Vercel production SHA и Supabase Edge версию; обнаружить изменённые с момента снимка компоненты.
3. Получить от пользователя однозначную привязку: **скриншот/имя последнего правильного APK + versionCode / SHA**, прежде чем менять UI или распространять Android.
4. Проверить [PR #52](https://github.com/stasaleksandrov481-netizen/mobile-framework-dev/pull/52) и Edge test-suite (49 Edge + 6 billing). Исходники 11 файлов v44 синхронизированы, но SQL-модель и миграции ещё необходимо сверить. Не заливать обратно старые версии.
5. После слияния PR #52 разрабатывать серверные изменения только на актуальной утверждённой базе, не вручную параллельно в production и GitHub.
6. В PR перед релизом документировать тесты, rollback, изменения квот и то, затрагивает ли новая сборка интерфейс.

## Работа с ветками

Не удалять существующие ветки массово. Их статус неизвестен, часть содержит незамерженные UI/бекенд-функции. Архивирование/удаление допускается только после сравнения с релизом и явного решения владельца.

## Известные ограничения

- Заголовок `X-Cortex-Device` можно подделать, это **не Play Integrity / аппаратная аттестация**.
- Действующие лимиты авторизации уже настраивались владельцем; не менять их без измерений и запроса.
- Зелёный GitHub CI не подтверждает доступность API или корректность интерфейса установленной пользователем сборки.
