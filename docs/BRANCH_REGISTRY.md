# Карта GitHub-веток CORTEX

## Актуальная сверка: 18.11.2026, `main` `7a92fea`

Подтверждено через GitHub API и `git fetch` всех refs: **76 веток** (включая `main`).

| Группа | Количество | Действие |
| --- | ---: | --- |
| `main` — Android 1.0.17 | 1 | Основная ветка; production Vercel на `7a92fea` |
| Уже полностью входят в `main` | 20 | Кандидаты на архивирование только после проверки внешних зависимостей |
| Отличаются от `main` собственными коммитами | 41 | Сохранять, разбирать через отдельные PR |
| Dependabot | 14 | Обновлять/закрывать поштучно только после CI |

Открыто **19 PR**, в том числе 5 не от Dependabot:

- [#64 — регистрация / шесть цифр / Redis](https://github.com/stasaleksandrov481-netizen/mobile-framework-dev/pull/64) — draft; содержит нужную правку веб-кода, но **не сливать вместе с пропавшими компонентами опубликованного UI**.
- [#61 — кабинет после регистрации и баланс ИИ](https://github.com/stasaleksandrov481-netizen/mobile-framework-dev/pull/61) — открыт, проверять вместе с одобренным web UI.
- [#57 — Android-история, навигация и поддержка](https://github.com/stasaleksandrov481-netizen/mobile-framework-dev/pull/57) — draft; нельзя перезаписывать Android 1.0.17 старой веткой.
- [#41 — локальные команды 1.0.14](https://github.com/stasaleksandrov481-netizen/mobile-framework-dev/pull/41) — старый Android, требует выборочного переноса.
- [#11 — аудит стабильности](https://github.com/stasaleksandrov481-netizen/mobile-framework-dev/pull/11) — draft; отдельно от релизных изменений.

Новые полностью вошедшие в `main` ветки: `release/cortex-1-0-17`, `fix/cortex-glass-voice-117`, `fix/cortex-verified-actions-116`, `fix/cortex-island-version-and-actions`, `fix/cortex-island-controls-20261118`, `feat/cortex-control-remembered-login-20261117`, `feat/cortex-private-pricing-credits-20261117` — помимо перечисленных в старом снимке ниже.

Крупные разошедшиеся ветки без автоматического слияния: `fix/cortex-web-safe-recovery-20261118` (+19 коммитов), `feat/cortex-web-approved-account-20261118` (+17), `release/cortex-unified-20261117` (+21), `security/sync-edge-runtime-v44-20261117` (+12), `chore/agent-handoff-release-guard-20261117` (+11). Числа — собственные коммиты относительно текущего `main`, а не оценка качества.

Правила наведения порядка: один дефект — один небольшой PR; сначала исправление шести OTP-ячеек, отдельно — Android 1.0.17/Gemini/отключение гостей, отдельно — сохранение дизайна сайта и платежи. Не делать массовых merge/delete/force-push. Отсутствие активного PR ещё не доказывает, что ветку можно удалить.

## Исторический снимок: 17.11.2026

Снимок 17.11.2026, сравнение каждой ветки с `main` (`7b7c6393`). **53 ветки всего**, включая `main`: 13 полностью уже входящих в `main`, 3 только впереди `main`, 22 разошедшиеся и 14 автоматических Dependabot. На момент проверки ничего не удалено.

## Нельзя потерять: впереди `main` (3)

- `chore/agent-handoff-release-guard-20261117` (+7 коммита)
- `feat/cortex-island-trace-20261116` (+7 коммита)
- `security/stable-guest-device-quota-20261117` (+5 коммита)

- `feat/cortex-island-trace-20261116` соответствует открытому [PR #46](https://github.com/stasaleksandrov481-netizen/mobile-framework-dev/pull/46) с работой другого агента над островком, разметкой и командами; **не смешивать с Android из `main` до проверки UI**.
- `security/stable-guest-device-quota-20261117` соответствует открытому [PR #47](https://github.com/stasaleksandrov481-netizen/mobile-framework-dev/pull/47): безопасная правка Android-заголовка, интерфейс не меняет.
- `chore/agent-handoff-release-guard-20261117` соответствует [PR #48](https://github.com/stasaleksandrov481-netizen/mobile-framework-dev/pull/48): правила/документация/CI, изменения без runtime.

## Полностью входят в `main` (13)

Эти ветки **не содержат коммитов, отсутствующих в `main`**, на момент снимка. Возможные кандидаты для последующего архивирования **после проверки PR, deployments и согласования владельца**. Самостоятельно не удалять.

- `codex/cortex-legal-grid-20261115`
- `codex/cortex-mail-ownership-20261115`
- `codex/cortex-phone-redesign-20261115`
- `codex/cortex-prereg-migration-version`
- `codex/cortex-prereg-web-20261115`
- `codex/cortex-real-ui-20261115`
- `codex/cortex-register-grid-20261115`
- `codex/cortex-ui-refine-20261115`
- `codex/cortex-website-20261115`
- `feat/ai-settings-device-guard-20261116`
- `feat/cortex-closed-beta-20261115`
- `fix/cortex-trust-answers-20261116`
- `fix/cortex-web-release-resilience-20261116`

## Разошлись с `main` (22)

Ветки содержат собственные коммиты, не вошедшие в `main`, и одновременно отстают. **Не сливать и не удалять автоматически**: могут быть пропущенные функции, эксперименты, миграции, защиты и отдельные UI-дизайны.

Обозначения: `+N` своих коммитов, `-M` коммитов позади `main`.

- `audit/beta-stability-20261116` (+5 / -21)
- `codex/cortex-platega-readiness-20261116` (+1 / -21)
- `codex/cortex-subscriptions-admin-beta` (+2 / -35)
- `feat/cortex-assistant-local-first-1.0.14` (+1 / -5)
- `feat/cortex-voice-compression-20261116` (+1 / -6)
- `fix/android-screen-tts-20261116` (+2 / -11)
- `fix/attach-debug-apk-20261116` (+1 / -19)
- `fix/cortex-admin-today-20261116` (+1 / -12)
- `fix/cortex-backend-hardening-20261116` (+1 / -18)
- `fix/cortex-beta-ui-singleflight-20261116` (+4 / -3)
- `fix/cortex-edge-security-20261116` (+1 / -10)
- `fix/cortex-legal-roles-secure-20261116` (+1 / -1)
- `fix/cortex-load-resilience-20261116` (+1 / -7)
- `fix/cortex-release-certificate-20261116` (+1 / -13)
- `fix/cortex-resource-security-20261116` (+1 / -8)
- `fix/cortex-security-analytics-20261116` (+2 / -20)
- `fix/cortex-web-traffic-20261116` (+2 / -2)
- `fix/registration-grid-capacity-20261116` (+1 / -13)
- `ops/cortex-release-1.0.12-20261116` (+2 / -12)
- `release/cortex-1.0.14-20261116` (+5 / -5)
- `release/cortex-beta-readiness-20261116` (+1 / -19)
- `security/cortex-android-privacy-20261116` (+3 / -4)

## Dependabot (14)

- `dependabot/github_actions/actions/checkout-7`
- `dependabot/github_actions/actions/setup-java-5`
- `dependabot/github_actions/actions/upload-artifact-7`
- `dependabot/github_actions/gradle/actions-6`
- `dependabot/gradle/androidx.browser-browser-1.10.0`
- `dependabot/gradle/androidx.core-core-1.19.1`
- `dependabot/gradle/gradle-wrapper-9.9.1`
- `dependabot/gradle/org.jetbrains.kotlinx-kotlinx-coroutines-android-1.11.0`
- `dependabot/npm_and_yarn/cortex-control/esbuild-0.28.2`
- `dependabot/npm_and_yarn/cortex-control/supabase/supabase-js-2.119.0`
- `dependabot/npm_and_yarn/cortex-web/react-19.3.1`
- `dependabot/npm_and_yarn/cortex-web/supabase/supabase-js-2.119.0`
- `dependabot/npm_and_yarn/cortex-web/types/node-26.6.6`
- `dependabot/npm_and_yarn/cortex-web/typescript-7.0.2`

Сначала дождаться CI и проверить несовместимости Gradle/React/SDK. Не объединять все обновления пакетов одним непроверенным релизом.

## Правила на будущее

1. Новая фича/исправление: отдельный PR с конкретной целью и записью в `docs/AGENT_HANDOFF.md`.
2. Указать источник Android UI и runtime Supabase; нельзя использовать только `main` как доказательство правильной сборки.
3. После merge помечать ветку «слита»; удаление только если нет открытого PR, активного деплоя и явных внешних зависимостей.
4. Если ветка разошлась: сначала сравнить коммиты и файлы, выбрать cherry-pick конкретных изменений или новый PR, а не перезаписывать её.
5. Обновлять карту после крупных релизов; эта таблица не является автоматическим источником правды и устаревает.
