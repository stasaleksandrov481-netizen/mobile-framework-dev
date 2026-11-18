# Передача работы по Android CORTEX

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
