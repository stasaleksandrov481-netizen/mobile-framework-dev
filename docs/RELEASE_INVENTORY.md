# Инвентаризация релизов CORTEX

## Изолированная security-ветка 17.11.2026 (не production)

`security/three-hardening-fixes-20261117`: исправляет доверие к подставляемому `X-Forwarded-For` в прямом Supabase Edge, добавляет тесты на IP-спуфинг, исходную SQL-миграцию `cortex_ai_device_identity` и локальный контроль release-подписи Android APK. Подробности: [SECURITY_THREE_FIXES_20261117.md](SECURITY_THREE_FIXES_20261117.md).

До успешного CI и отдельной сверки runtime **продолжает работать Supabase Edge v44**, а production Android **не заменён**. Локальная проверка сертификата APK не равна серверной hardware attestation. Веб-WAF CRS пока наблюдает в `log`; прямой Supabase endpoint им не защищён. Не считать три механизма полностью запущенными.


Проверено 17.11.2026. Это **снимок фактического состояния**, а не команда на публикацию.

| Компонент | Проверенное состояние | Что учитывать |
| --- | --- | --- |
| GitHub default | `main`, security PR #52 merge SHA `15cad8ba025587581b12af2749df937a7b84e7ea` | Источник Edge v44 и автоматические API/billing тесты теперь в `main`; перепроверять SHA перед работой |
| Vercel production | `mobile-framework-dev` / `cortexapp.ru`; deployment `dpl_F7dquhdgkYMXdFkybFVAqH84DzjL` **READY**, ref `main`, SHA `15cad8b` | Сайт собран и назначен домену; ручная проверка UI/APK отсутствует. Rollback `dpl_BJ3FBazwuDZqM1nsYN88fyxgJoMo` |
| Android в `main` | `app/build.gradle.kts`: `versionName=1.0.14`, `versionCode=114` | Пользователь 17.11 сообщил о неверном интерфейсе. Одобренную сборку/ветку ещё надо установить |
| Android альтернативы | `release/cortex-1.0.14-20261116`, `fix/cortex-beta-ui-singleflight-20261116`, `audit/beta-stability-20261116` и исторические UI-ветки | Они могут **расходиться с `main`**; не считать ни одну верной без сверки с используемым APK |
| Supabase production | Edge Function `cortex`, **ACTIVE v44**, проект `jjcqrjztxohnifmziksy` | В PR #52 синхронизированы 11 исходных файлов без деплоя Edge; SQL-миграция identity ещё не подтверждена |
| AI device identity | Живая Edge Function использует `rpc/cortex_ai_device_identity` и принимает `X-Cortex-Device` | Функция RPC существует в production; старые Android-вызовы отправляют заголовок лишь на `presence`, а бесплатные AI-вызовы могут возвращать 426 |
| Security PR | [#47](https://github.com/stasaleksandrov481-netizen/mobile-framework-dev/pull/47), `security/stable-guest-device-quota-20261117` | Android-правка объединена с PR #46 и #48 в [PR #49](https://github.com/stasaleksandrov481-netizen/mobile-framework-dev/pull/49), слита в `main` SHA `05a1810` без серверного кода |
| Security sync | [PR #52](https://github.com/stasaleksandrov481-netizen/mobile-framework-dev/pull/52), merge SHA `15cad8b` | 49 Edge + 6 billing тестов, CodeQL, Android/web CI success; нет нового подписанного APK |

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
