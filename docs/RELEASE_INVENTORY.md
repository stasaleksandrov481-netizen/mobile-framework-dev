# Инвентаризация релизов CORTEX

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
