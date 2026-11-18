# Передача работы по Android CORTEX

## 2026-11-18 UTC · Стабилизация сайта после повторного отката интерфейса

- Инцидент: в GitHub `main` (`3d8c81ebfe4f35e54988540a214620888bdc3bc3`) отсутствует часть подтверждённого владельцем сайта; публикация GitHub-сборки возвращала старую главную, ломала `/payment` и визуально меняла регистрацию. Сайт и исходник в GitHub **не синхронизированы**, несмотря на успешные Android/Edge тесты.
- Исправлено в production без повторной сборки: Vercel `mobile-framework-dev`, команда `syndicate13`, `dpl_AdZ76xMyr3Z7PJMETG31yCUYqgKj` (READY) повторно назначен на `cortexapp.ru` и `www.cortexapp.ru`. Проверены HTTP 200 `/`, `/register`, `/pricing`, `/payment?plan=start`, `/api/status`; Telegram Stars `GET /api/telegram/stars/availability` → `{"available":true}`, кеш статуса → `{"status":"ok","cache":"ok"}`. Production CSS содержит `repeat(6,minmax(0,1fr))`, без восьми ячеек.
- Ограничение: у опубликованного snapshot `/account` возвращает 404. Не обещать работающий кабинет или успешную денежную транзакцию без отдельной end-to-end проверки. В нём есть `/support` и `/payment`.
- Vercel Project API: успешно применено `autoAssignCustomDomains:false` для защиты домена от непроверенных новых GitHub-деплоев. Дополнительно `cortex-web/vercel.json` в этом PR отключает **автоматический Git deploy только ветки `main`**, остальные ветки остаются для preview. Не возвращать настройку до согласованного web-релиза.
- Источник восстановления: `vercel_list_deployment_files` у `dpl_AdZ76xMyr3Z7PJMETG31yCUYqgKj` содержит `src/cortex-web/`, включая отсутствующие в GitHub `AmbientDotField.tsx`, `PricingPanels.tsx`, `PricingBuyButton.tsx`, `SupportChat.tsx`, `lib/support-media.ts`, `app/api/checkout/route.ts`. API получения файла возвращает урезанную base64-строку (2 KB), поэтому полная исходная версия **ещё не восстановлена в GitHub**; не пытаться заменять её догадками. Отдельная локальная ветка содержит обновлённые Account/Payment API, но не подтверждённый публичный UI.
- Тесты и статус: на локальном web-кандидате 46/46 `npm test`, `npm run lint` успешно; `npm run release:verify` блокирует релиз из-за шести файлов. Не публиковать этот кандидат. Supabase Edge и Android не менялись в ходе восстановления.
- Следующий шаг: получить **полный архив исходников** именно `dpl_AdZ76xMyr3Z7PJMETG31yCUYqgKj` через экспорт Vercel, восстановить `cortex-web` поверх актуального `main` без изменения Android и Edge, пройти `release:verify`, выполнить визуальный diff в Preview и одобрение владельца. Только после этого вручную выпустить новый production и, при необходимости, вновь включить Git auto-deploy.

## 2026-11-18 UTC · Проверенный production: 6 OTP, Gemini TTS, авторизация

- Коммит `6260e7814cf2660eeb80e032d89556feaa2da2ab` из PR #69 опубликован: исправлено 8 → 6 OTP в React, CSS и проверке формы. Production CSS `.otp-code` проверен на `https://cortexapp.ru/register`: шесть колонок, восемь отсутствуют; страница HTTP 200.
- PR #70 слит в `main` коммитом `2c80b5a7f149a89c2e2735a89b487fa9a5c84005`. Слияние проверено как бесконфликтное, web-стили не изменены относительно PR #69. Android 1.0.17 сохраняет UI и native actions; добавлены PCM streaming OpenRouter Gemini и блокировка гостевого доступа на Android и сервере.
- Проверки: GitHub Android Build, Edge/Billing, CodeQL и security — зелёные; локально Edge 71/71; проверено точное совпадение итогового git tree с проверенной веткой.
- Vercel production: проект `mobile-framework-dev`, команда `syndicate13`, деплой `dpl_DAoZopNGd3AD7B8jajXhVg46A2hG` **READY**, исходник `main` / `2c80b5a`. `cortexapp.ru/register` возвращает HTTP 200; итоговый CSS имеет `repeat(6,minmax(0,1fr))`.
- Supabase project `jjcqrjztxohnifmziksy`, Edge `cortex` **ACTIVE v46**, `verify_jwt:false` сохранён (внутренняя авторизация). Все 11 файлов live v45 сначала точно совпали с базой main; для v46 заменён только `handler.ts`. После деплоя заново считаны все 11 файлов: точное совпадение с `main` `2c80b5a`. SQL voice preferences `20261118165958` и `20261118171520` уже были применены, повторно **не применялись**. Edge логи на момент проверки: 61 запись за 20 минут, ни одна не содержит явных строк `error`/HTTP 500/502/503 (не заменяет E2E).
- Rollback: предыдущая рабочая Edge v45 точно соответствует коммиту `7a92feaa42beca2d8c6769e4015a4eb026e942e0`; предыдущий Vercel READY `dpl_62i8PQrxNCa5NzHDD2Jms1q9NrFk` (OTP исправлен).
- **Не выполнено автоматически:** подписанный APK 1.0.17 с Gemini TTS не выпущен пользователям; требуется подтверждение интерфейса и тест на Android. Настройки голосов в веб-кабинете ещё не восстановлены. Старые ветки не удалены: некоторые имеют уникальные коммиты, GitHub connector не предоставляет API удаления refs. В отдельном локальном worktree есть незакоммиченные изменения Telegram Stars — не перетирать.
- Следующий шаг: проверить голос на Android-устройстве под реальной учётной записью, после одобрения подписать/выпустить APK, затем отдельно разбирать остаточные ветки и тарифы. Не деплоить старую копию Edge или UI.


## 2026-11-18 UTC · Актуализация GitHub и шестизначный OTP

- Исходный `main`: `7a92feaa42beca2d8c6769e4015a4eb026e942e0` (Android 1.0.17, Vercel READY `dpl_C5Q1YYHYeA63j6YWZUv4Y4qrdUJp`). Прежние данные по 1.0.14 не являются текущим релизом.
- Подготовлена отдельная рабочая ветка `fix/cortex-gemini-on-1_0_17`. Сохранены новинки Android 1.0.17, изменены только голосовой клиент, серверный streaming speech и гостевые проверки. Supabase production `cortex` по последней сверке остаётся ACTIVE v45; **этот код не выложен в Edge**.
- В `main` обнаружено восемь цифр в `cortex-web/components/OtpCodeInput.tsx`, `Registration.tsx` и `app/globals.css` вопреки Android с 6. Исправлены на строго 6, добавлен общий `lib/email-otp.ts` и тест; не менять одобренную стилистику формы.
- `node --experimental-transform-types --test supabase/functions/cortex/*.test.ts`: 71/71; `node --experimental-strip-types --test cortex-web/scripts/hardening.test.mjs`: 9/9; `node --check` WebView файлов и TypeScript lint: зелёные. Android Gradle в текущем runtime не запускается из-за DNS к `services.gradle.org`; APK не собран.
- GitHub: 76 refs (1 main, 20 полностью включены, 41 разошлась, 14 Dependabot), 19 открытых PR. Карта актуализирована в `docs/BRANCH_REGISTRY.md`. Никакие чужие ветки, PR, релизы и теги не удалены.
- После снимка созданы draft [PR #69](https://github.com/stasaleksandrov481-netizen/mobile-framework-dev/pull/69) с OTP-фиксом и [PR #70](https://github.com/stasaleksandrov481-netizen/mobile-framework-dev/pull/70) с Gemini/Android. Теперь 78 refs и 21 открытый PR; GitHub подтверждает точное совпадение деревьев с локальными проверенными коммитами. Улучшен hardening-тест: фиксирует и CSS-сетку из 6 ячеек, и использование общей константы.
- До публикации в production требуется получить одобренные исходники UI (`cortex-web` release guard указывает недостающие файлы), проверить CI Android и тот же APK/скриншоты на устройстве; миграции voice preferences уже применены в Supabase, в GitHub восстановлена их история. Не выдавать локальную правку за выпущенную.


Предыдущие записи доступны через историю изменений этого файла в Git.

## 2026-11-18 · Релиз 1.0.17

- Основа приложения — проверенная сборка из PR #67. Ветку выпуска добавили только для обновления процесса публикации.
- В GitHub Actions выберите CORTEX Android APK and Release, затем Run workflow на основной ветке. Ручной запуск соберёт подписанный APK и опубликует стабильный выпуск.
- При переходе на 1.0.17 старые записи Releases удаляются после скачивания нового APK и проверки SHA-256. Обзор результата есть в журнале сборки.
- При проверке выпуска сравните его тег, загруженный APK и файл SHA256SUMS.txt с результатом workflow.
