# Карта GitHub-веток CORTEX

## Уборка 20.11.2026: 115 → 38 веток, ничего не потеряно

Удалены **76 веток**, содержимое которых уже есть в `main` (ветка — предок `main`) или в базе слитого PR (голова ветки совпадает с головой merged PR). Перед удалением на **тот же коммит** создан аннотированный тег `archive/<имя-ветки>`; совпадение 76/76 тегов и SHA проверено через `git ls-remote`, удаление выполнено одним `--atomic` push с `--force-with-lease` по ожидаемому SHA.

Восстановить любую ветку: `git push origin refs/tags/archive/<имя>^{commit}:refs/heads/<имя>`.

Оставлены (38): `main`; production-источники `fix/cortex-web-safe-recovery-20261118` (сайт) и `feat/cortex-control-hardening-20261117` (cortex-control); `feat/cortex-web-black-glass-20261120` (редизайн сайта, не выкачен); все 25 веток открытых PR (включая Dependabot); 10 веток с собственными коммитами вне `main` без открытого PR — `chore/agent-handoff-release-guard-20261117`, `feat/cortex-island-trace-20261116`, `feat/cortex-platega-readiness-20261117`, `feat/cortex-web-approved-account-20261118`, `fix/android-beta-local-execution-20261118`, `fix/cortex-beta-startup-and-release-inventory-20261119`, `fix/cortex-global-ai-ddos-fuse-20261118`, `ops/cortex-release-1.0.12-20261116`, `release/cortex-beta-readiness-20261116`, `security/stable-guest-device-quota-20261117`. Их не удалять без разбора коммитов.

<details><summary>Архивированные ветки (76)</summary>

- `chore/cortex-release-handoff-20261117` → `archive/chore/cortex-release-handoff-20261117` (`526f06d`)
- `codex/cortex-legal-grid-20261115` → `archive/codex/cortex-legal-grid-20261115` (`ae0fd23`)
- `codex/cortex-mail-ownership-20261115` → `archive/codex/cortex-mail-ownership-20261115` (`521c3d6`)
- `codex/cortex-phone-redesign-20261115` → `archive/codex/cortex-phone-redesign-20261115` (`3a02de0`)
- `codex/cortex-platega-readiness-20261116` → `archive/codex/cortex-platega-readiness-20261116` (`fb41c59`)
- `codex/cortex-prereg-migration-version` → `archive/codex/cortex-prereg-migration-version` (`55f9b32`)
- `codex/cortex-prereg-web-20261115` → `archive/codex/cortex-prereg-web-20261115` (`5cb6e5b`)
- `codex/cortex-real-ui-20261115` → `archive/codex/cortex-real-ui-20261115` (`e57edab`)
- `codex/cortex-register-grid-20261115` → `archive/codex/cortex-register-grid-20261115` (`9fbefa8`)
- `codex/cortex-subscriptions-admin-beta` → `archive/codex/cortex-subscriptions-admin-beta` (`e0831a3`)
- `codex/cortex-ui-refine-20261115` → `archive/codex/cortex-ui-refine-20261115` (`35d2858`)
- `codex/cortex-website-20261115` → `archive/codex/cortex-website-20261115` (`b2f8397`)
- `docs/agent-rules-edge-v45-20261117` → `archive/docs/agent-rules-edge-v45-20261117` (`8c7fe21`)
- `docs/cortex-verified-release-20261118` → `archive/docs/cortex-verified-release-20261118` (`7adfe8f`)
- `docs/edge-v48-ddos-release-20261118` → `archive/docs/edge-v48-ddos-release-20261118` (`af48b0e`)
- `docs/security-handoff-merged-20261117` → `archive/docs/security-handoff-merged-20261117` (`35417fe`)
- `docs/security-v45-release-20261117` → `archive/docs/security-v45-release-20261117` (`26df74d`)
- `feat/ai-settings-device-guard-20261116` → `archive/feat/ai-settings-device-guard-20261116` (`b1dbf89`)
- `feat/cortex-closed-beta-20261115` → `archive/feat/cortex-closed-beta-20261115` (`806994a`)
- `feat/cortex-control-beta-release-20261119` → `archive/feat/cortex-control-beta-release-20261119` (`e6c300f`)
- `feat/cortex-control-redesign-20261119` → `archive/feat/cortex-control-redesign-20261119` (`6e98cd5`)
- `feat/cortex-control-remembered-login-20261117` → `archive/feat/cortex-control-remembered-login-20261117` (`462e1d1`)
- `feat/cortex-control-website-stats-20261119` → `archive/feat/cortex-control-website-stats-20261119` (`197c6ed`)
- `feat/cortex-first-experience-20261119` → `archive/feat/cortex-first-experience-20261119` (`a194361`)
- `feat/cortex-gemini-tts-android-117-20261118` → `archive/feat/cortex-gemini-tts-android-117-20261118` (`6474fda`)
- `feat/cortex-private-pricing-credits-20261117` → `archive/feat/cortex-private-pricing-credits-20261117` (`d3e6d4c`)
- `feat/cortex-public-registration-20261117` → `archive/feat/cortex-public-registration-20261117` (`ed31805`)
- `feat/cortex-robokassa-site-20261119` → `archive/feat/cortex-robokassa-site-20261119` (`4bc3d17`)
- `feat/cortex-voice-compression-20261116` → `archive/feat/cortex-voice-compression-20261116` (`84effe7`)
- `fix/android-screen-tts-20261116` → `archive/fix/android-screen-tts-20261116` (`daca4ec`)
- `fix/attach-debug-apk-20261116` → `archive/fix/attach-debug-apk-20261116` (`4ee861f`)
- `fix/cortex-admin-today-20261116` → `archive/fix/cortex-admin-today-20261116` (`17bafc5`)
- `fix/cortex-ai-global-ddos-fuse-updated-20261118` → `archive/fix/cortex-ai-global-ddos-fuse-updated-20261118` (`df459dd`)
- `fix/cortex-android-local-commands-demo-20261119` → `archive/fix/cortex-android-local-commands-demo-20261119` (`21d6412`)
- `fix/cortex-apk-release-20261119` → `archive/fix/cortex-apk-release-20261119` (`9fd3f21`)
- `fix/cortex-backend-hardening-20261116` → `archive/fix/cortex-backend-hardening-20261116` (`9e1d601`)
- `fix/cortex-beta-brain-budget-20261118` → `archive/fix/cortex-beta-brain-budget-20261118` (`993a7cd`)
- `fix/cortex-beta-readiness-20261119` → `archive/fix/cortex-beta-readiness-20261119` (`069763a`)
- `fix/cortex-beta-ui-singleflight-20261116` → `archive/fix/cortex-beta-ui-singleflight-20261116` (`c212ef4`)
- `fix/cortex-beta10-integration-20261119` → `archive/fix/cortex-beta10-integration-20261119` (`30a8483`)
- `fix/cortex-calculator-operator-20261119` → `archive/fix/cortex-calculator-operator-20261119` (`d4902ba`)
- `fix/cortex-control-20261119` → `archive/fix/cortex-control-20261119` (`d1092f2`)
- `fix/cortex-cross-oem-first-experience-20261119` → `archive/fix/cortex-cross-oem-first-experience-20261119` (`9d46ccc`)
- `fix/cortex-demo-choreography-20261119` → `archive/fix/cortex-demo-choreography-20261119` (`5aa9e5f`)
- `fix/cortex-demo-lifecycle-20261119` → `archive/fix/cortex-demo-lifecycle-20261119` (`c13df8d`)
- `fix/cortex-demo-verification-20261119` → `archive/fix/cortex-demo-verification-20261119` (`9aedee6`)
- `fix/cortex-edge-security-20261116` → `archive/fix/cortex-edge-security-20261116` (`0c5de76`)
- `fix/cortex-glass-voice-117` → `archive/fix/cortex-glass-voice-117` (`ee220ec`)
- `fix/cortex-island-controls-20261118` → `archive/fix/cortex-island-controls-20261118` (`9bd63e1`)
- `fix/cortex-island-version-and-actions` → `archive/fix/cortex-island-version-and-actions` (`03ab696`)
- `fix/cortex-legal-roles-secure-20261116` → `archive/fix/cortex-legal-roles-secure-20261116` (`61005e2`)
- `fix/cortex-load-resilience-20261116` → `archive/fix/cortex-load-resilience-20261116` (`5442e52`)
- `fix/cortex-oem-operator-glyphs-beta9-20261119` → `archive/fix/cortex-oem-operator-glyphs-beta9-20261119` (`a12e5c8`)
- `fix/cortex-otp-six-web-20261118` → `archive/fix/cortex-otp-six-web-20261118` (`456cb99`)
- `fix/cortex-payment-copy-20261120` → `archive/fix/cortex-payment-copy-20261120` (`9f7c38e`)
- `fix/cortex-prod-ui-freeze-20261118` → `archive/fix/cortex-prod-ui-freeze-20261118` (`e209f2f`)
- `fix/cortex-release-certificate-20261116` → `archive/fix/cortex-release-certificate-20261116` (`1155b76`)
- `fix/cortex-resource-security-20261116` → `archive/fix/cortex-resource-security-20261116` (`7d6ad03`)
- `fix/cortex-security-analytics-20261116` → `archive/fix/cortex-security-analytics-20261116` (`ee0ad67`)
- `fix/cortex-telegram-youtube-semantic-20261119` → `archive/fix/cortex-telegram-youtube-semantic-20261119` (`e81c4ae`)
- `fix/cortex-trust-answers-20261116` → `archive/fix/cortex-trust-answers-20261116` (`0446f8a`)
- `fix/cortex-verified-actions-116` → `archive/fix/cortex-verified-actions-116` (`0c615d9`)
- `fix/cortex-web-auth-experience-20261117` → `archive/fix/cortex-web-auth-experience-20261117` (`f4ac846`)
- `fix/cortex-web-release-resilience-20261116` → `archive/fix/cortex-web-release-resilience-20261116` (`a03c39b`)
- `fix/cortex-web-release-tbd-20261120` → `archive/fix/cortex-web-release-tbd-20261120` (`3c7f9d9`)
- `fix/cortex-web-traffic-20261116` → `archive/fix/cortex-web-traffic-20261116` (`114bd6c`)
- `fix/registration-grid-capacity-20261116` → `archive/fix/registration-grid-capacity-20261116` (`535450f`)
- `hotfix/cortex-web-eight-digit-otp-20261117` → `archive/hotfix/cortex-web-eight-digit-otp-20261117` (`e097daf`)
- `release/cortex-1-0-17` → `archive/release/cortex-1-0-17` (`5a067ac`)
- `release/cortex-1-0-18-beta-8-20261119` → `archive/release/cortex-1-0-18-beta-8-20261119` (`8b97447`)
- `release/cortex-1.0.14-20261116` → `archive/release/cortex-1.0.14-20261116` (`dc27014`)
- `release/cortex-unified-20261117` → `archive/release/cortex-unified-20261117` (`cae7db6`)
- `security/cortex-android-privacy-20261116` → `archive/security/cortex-android-privacy-20261116` (`bc5aec4`)
- `security/cortex-beta-device-binding-20261119` → `archive/security/cortex-beta-device-binding-20261119` (`01cdc85`)
- `security/sync-edge-runtime-v44-20261117` → `archive/security/sync-edge-runtime-v44-20261117` (`f664136`)
- `security/three-hardening-fixes-20261117` → `archive/security/three-hardening-fixes-20261117` (`ee3afe9`)

</details>

## Актуальная сверка: 18.11.2026, `main` `7a92fea`

Подтверждено через GitHub API и `git fetch` всех refs, затем создано два новых feature refs: **78 веток** (включая `main`).

| Группа | Количество | Действие |
| --- | ---: | --- |
| `main` — Android 1.0.17 | 1 | Основная ветка; production Vercel на `7a92fea` |
| Уже полностью входят в `main` | 20 | Кандидаты на архивирование только после проверки внешних зависимостей |
| Отличаются от `main` собственными коммитами | 43 | Сохранять, разбирать через отдельные PR |
| Dependabot | 14 | Обновлять/закрывать поштучно только после CI |

Открыт **21 PR**, в том числе 7 не от Dependabot:

- [#69 — ровно шесть цифр в форме регистрации](https://github.com/stasaleksandrov481-netizen/mobile-framework-dev/pull/69) — новый небольшой draft PR для безопасного релиза OTP.
- [#70 — Gemini TTS / обязательная авторизация поверх Android 1.0.17](https://github.com/stasaleksandrov481-netizen/mobile-framework-dev/pull/70) — отдельный draft PR с серверными и Android проверками.

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
