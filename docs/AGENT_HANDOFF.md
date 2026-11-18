# Передача работы по Android CORTEX

## 2026-11-18 · Local-first Android response hotfix (branch only)

- Agent task: CORTEX island delays, phone app launch stutter, incomplete Russian local phrases.
- Base: main `7a92feaa42beca2d8c6769e4015a4eb026e942e0`; branch `fix/android-beta-local-execution-20261118`.
- Android-only changes: `CortexPhoneActions.kt` (background, cached launcher index; app command execution off main thread; cold-start aliases), `CortexActionEngine.kt` (remove one-second artificial first-turn delay, bound planner attempt to 12–14 seconds, faster retry, clearer invalid-plan reporting), `CortexLocalCommands.kt` (extra Russian aliases), `LocalIntentTest.kt` (new unit cases).
- No production deployment; no Edge Function, database, WebView, permissions, island UI or release artifact changed.
- Validation: source inspection and new unit tests authored; Gradle/Android device tests not run in this tool environment. Run CI for branch, then verify Android device launch latency, torch on/off and visual AI task end-to-end. Must not claim 20 Nov beta readiness before real hardware test.
- Risks: initial app-index warmup, OEM camera torch callback differences, server-side invalid visual plan/provider latency; the patch does not solve all LLM execution or Android policy limitations. Keep approved interface and original APK as rollback.
- Follow-up: review CI and smoke test Galaxy A23; fix failures in a separate follow-up commit and merge only after approval.


Предыдущие записи доступны через историю изменений этого файла в Git.

## 2026-11-18 · Релиз 1.0.17

- Основа приложения — проверенная сборка из PR #67. Ветку выпуска добавили только для обновления процесса публикации.
- В GitHub Actions выберите CORTEX Android APK and Release, затем Run workflow на основной ветке. Ручной запуск соберёт подписанный APK и опубликует стабильный выпуск.
- При переходе на 1.0.17 старые записи Releases удаляются после скачивания нового APK и проверки SHA-256. Обзор результата есть в журнале сборки.
- При проверке выпуска сравните его тег, загруженный APK и файл SHA256SUMS.txt с результатом workflow.
