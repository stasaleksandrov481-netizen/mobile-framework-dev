# Инвентаризация релизов CORTEX

## 2026-11-21 UTC · Supabase Edge CORTEX v52 (production)

- **ACTIVE v52**, `verify_jwt=false`, SHA256 `9fe00d8c8d91fa77942d7f492967fe4a8b5276097df7ba3a8eb2c70f3c5f7be6`. Деплой основан на побайтно полученных 11 исходниках v51 и меняет ровно `redis.ts`, `provider.ts` и `singleflight.ts`. После выкладки 11/11 файлов проверены по исходникам: `handler.ts` сохраняет тройной fallback v51, остальные неизменённые файлы совпали с rollback baseline `6a6a9dc`, новые `provider.ts` и `redis.ts` совпали с `main`, а `singleflight.ts` — с точечным добавлением `text_ready` к live.
- Тестирование PR #115: Edge **77/77**, billing и GitHub handoff, security scan и UI успешны. `main` коммит `4eddc60`, PR объединён. SQL, Android APK, Vercel и настройки тарифов не менялись. Внешний HTTP smoke и физическое устройство не проверены; провайдер веб-просмотра возвращает ошибку доступа к Supabase URL.
- **Rollback**: Edge v51, SHA256 `313bf1f4969d35b61353a3361d70ee188cc459ec18023f83c85baa6be15db72f` (исходники 11 файлов: GitHub `6a6a9dc` и три правки `handler.ts` из PR #114). Никогда не выкладывать `main` без сверки 11 файлов: голос/stream могут отличаться.

## 2026-11-21 UTC · Кандидат: Redis Vault retry и ранняя готовность речи

- Перед изменениями Supabase Edge `cortex` ACTIVE **v51**, `verify_jwt=false`, SHA256 `313bf1f4969d35b61353a3361d70ee188cc459ec18023f83c85baa6be15db72f`. Наличие `text_ready` проверено: `main` уже передаёт событие после текстовой генерации, live v51 пока не передаёт. Redis `redis.ts` в `main` совпадает с live v51; обнаружено 5-минутное удержание отрицательной конфигурации Vault.
- Кандидат релиза изменяет Redis credential retry (15 секунд при сбое; 5 минут при успехе) и добавляет тест совместного SSE-потока. CI расширен до запуска всех Edge тестов. Запланированное включение `text_ready` в live Edge не требует SQL, Android или Vercel деплоя, но обязано сохранять исходники v51 и пройти сверку 11/11 файлов после релиза.

## 2026-11-21 UTC · Кандидат Edge: третий резерв визуального планировщика

- Подготовлен [PR #114](https://github.com/stasaleksandrov481-netizen/mobile-framework-dev/pull/114) из `main` `eeae28e`. Изменены `handler.ts`, интеграционный тест и документы. Резервная модель для визуального планирования добавляется только после отказов первых двух моделей; настройки и обычный чат не затронуты, 20-секундный общий deadline сохраняется.
- **Production Supabase Edge `cortex` ACTIVE v51** (2026-11-21 UTC; deployment SHA256 `313bf1f4969d35b61353a3361d70ee188cc459ec18023f83c85baa6be15db72f`), `verify_jwt=false`. Деплой собран **поверх точных 11 файлов живой v50**, с тремя проверенными изменениями только в `handler.ts`. После публикации 10/11 файлов совпали с v50 побайтно, `handler.ts` совпал с ожидаемыми тремя заменами. **Rollback** — комплект v50 = GitHub `6a6a9dc` (11/11 побайтно совпали до деплоя). CI: 57/57 серверных тестов, биллинг, handoff, security scan и UI успешны. HTTP smoke из браузера-инструмента не получен (инструмент не смог открыть URL); на реальном Android поведение не проверено. `main` всё ещё отличается от Edge по функциям озвучки и стриминга: будущий деплой обязан сохранять live v51.

## 2026-11-20 UTC · Кандидат потоковой озвучки Android

- В [PR #108](https://github.com/stasaleksandrov481-netizen/mobile-framework-dev/pull/108) вошли Android и Edge. База `f4e0e3c` побайтно совпала с 11 файлами действующего `cortex` ACTIVE v50, `verify_jwt=false`. Этот комплект сохраняет состояние для отката.
- В кандидате Edge изменены `handler.ts`, `provider.ts`, `singleflight.ts` и `audio.ts`. Остальные 7 файлов совпадают с v50. Миграций БД нет. `text_ready` совместим с beta.11, которая игнорирует незнакомый статус.
- Код Android и Edge объединён в `main` (`735b226`, итог проверен против `ccb009f`). Публичный APK подтверждён как `v1.0.18-beta.11`, versionCode 128. Edge подтверждён как ACTIVE v50. Android release build, CodeQL и 15/15 сценариев эмулятора прошли. Фактическая задержка синтеза и точность распознавания на физическом телефоне пока не измерены.

## 2026-11-20 UTC · Итоги проверки сайта и Android

- Веб-релиз `fe6630a` опубликован из `fix/cortex-web-quality-20261120`: Vercel `dpl_4KtfshurZ7wriji7neTZ8VFSkRNZ`, алиасы `cortexapp.ru` и `www.cortexapp.ru`. Откат: `dpl_45YgM4ECZzMyH4L1bPiSkfWYinWB` (`62b3dd6`).
- Веб: 51 тест, сборка, TypeScript, проверка релиза, четыре ширины Chromium на production и 10 публичных HTTP-проверок. Входящие запросы оплаты и внутреннего уведомления без полномочий получили HTTP 401. Redis отвечает `ok`; Telegram Stars доступны. Сценарий восстановления согласия проверен в Chromium с имитацией ответов Supabase.
- Android [PR #105](https://github.com/stasaleksandrov481-netizen/mobile-framework-dev/pull/105) объединён в `main` (`29825ac`). Дерево совпало с проверенным PR head `3229230`. Зелёные сборка/JVM/lint, CodeQL, 91 локальная JS-проверка, 73 Edge-теста и 15 интеграционных тестов на Android API 34. Публичный APK остаётся beta.11.
- В `AGENTS.md` закреплены правила четырёх предоставленных скиллов. Улучшения отдельной панели CORTEX Control прошли тесты в [PR #104](https://github.com/stasaleksandrov481-netizen/mobile-framework-dev/pull/104).
- Supabase Edge ACTIVE v50 совпал с исходниками по 11 файлам, RLS включён на 33 таблицах CORTEX в public. Для проверки физического поведения One UI, HyperOS и других оболочек нужны соответствующие устройства. Реальные письмо, вход и платёж не выполнялись.

## 20.11.2026 · обновление Supabase Edge

- Edge `cortex` v50 ACTIVE. Перед выкладкой все 11 файлов v49 сверены с репозиторием. В выкладку вошли только изменения `handler.ts` и `provider.ts` из 6a6a9dc. После выкладки вновь проверены 11 файлов и публичный статус. 82 проверки Edge, оплаты и защиты служебных инструкций прошли. Миграций нет.
- Предыдущий комплект Edge v49 для отката соответствует `8e56d8a`. После отката повторить сверку файлов и запрос статуса.

## 20.11.2026 — Supabase Edge `cortex`: сверка live v49 перед деплоем PR #100

- Live: `cortex` **ACTIVE v49**, `verify_jwt=false`, entrypoint `index.ts`. Все 11 файлов live (`index, handler, provider, device, tool_targets, control, redis, visual, settings, audio, singleflight`) **побайтно совпадают с `origin/main`** (сверка через `get_edge_function`, нормализация CRLF).
- Ветка `fix/cortex-webview-ota-native-pin-20261120` (PR #100) отличается от live только в двух файлах: `handler.ts` (один мужской голос `Charon`, без чтения `cortex_voice_preferences`) и `provider.ts` (запрет раскрытия служебных инструкций). Остальные 9 файлов идентичны. Миграций БД нет.
- Локально `node --experimental-transform-types --test` Edge/billing: 78/78. **Деплой одобрен владельцем 20.11.2026, ещё не выполнен** (нужен вход Supabase CLI); после деплоя записать новую версию и rollback-кандидат v49.

## 19.11.2026 — подтверждённая опубликованная бета 1.0.18-beta.8

- GitHub release [v1.0.18-beta.8](https://github.com/stasaleksandrov481-netizen/mobile-framework-dev/releases/tag/v1.0.18-beta.8), source `ae790b946539d4c07cec934e62b26afe15693d8a`, versionCode 125, published 2026-11-19 14:06:51 UTC. Asset `CORTEX-1.0.18-beta.8.apk`, 19,052,020 bytes, GitHub digest `sha256:7e12d17f215039f2dfcc5627e8c393481af17d16d8d4b3cf524cfb9aa6f2b8ed`. Workflow Android 44539159455 and CodeQL 44539160225 SUCCESS.
- The current cross-OEM first-experience work in `fix/cortex-cross-oem-first-experience-20261119` is **not contained** in this signed APK. It must go through separate PR/instrumentation and explicit new version; never replace an existing release or its signing materials. Physical Samsung/vivo and other OEM behavior remains unverified.

## 19.11.2026 — Android 1.0.18-beta.7: проверка всего сценария калькулятора

- PR [#89](https://github.com/stasaleksandrov481-netizen/mobile-framework-dev/pull/89) слит; release source `b14532caf3d08051a3d7432dd401b60c9205ed96`, tag `v1.0.18-beta.7`, code **124**. Его дерево совпадает с проверенным PR head `9aedee6cdcdca94671ece7b6de66a65319359059`. Android/JVM/lint/release build, UI screenshots, CodeQL и Handoff прошли. Подписанный main workflow `44524652691` — **SUCCESS**, включая проверку реально скачанного релиза.
- Убраны проверки промежуточной строки, останавливавшие сценарий после оператора; ввод идёт по локальному скрипту с реальными проверенными нажатиями. Каждый результат после = обязателен. Следующее вычисление заново вводит предыдущий подтверждённый результат. Учтены отключённые поля и меняющиеся accessibility-описания. Итоговое поле имеет приоритет даже пока оно пустое; предпросмотр, история и клавиши не подтверждают ответ. Локальное OCR читает только распознанную область результата с двумя согласованными кадрами; исправлена ошибка большого пустого поля, дававшая 088 вместо 588. Без запросов к ИИ.
- Новый native workflow `44523659186`: **8/8 интеграционных тестов Android API34 прошли**, включая 588, предсказания 1/17/99, недоступный как текст результат/OCR, задержку =, неверный ответ, недоступную кнопку, отмену и восстановление реальной яркости. Кадры и логи просмотрены. Отдельный QA APK служит тестам и не включён в приложение. Это проверка интеграции в эмуляторе; Samsung A23 и фактический FPS физически не проверены.
- [CORTEX-1.0.18-beta.7.apk](https://github.com/stasaleksandrov481-netizen/mobile-framework-dev/releases/download/v1.0.18-beta.7/CORTEX-1.0.18-beta.7.apk), **19 051 796 байт**, SHA256 `20a18b61b06474c75b670ebbf93088e18447c2d4b9af81c24e0eddc6003f5f81`. Независимо скачан и проверен: checksum/GitHub digest, постоянный сертификат beta.6, package/versionCode, 25 WebView-файлов и наличие новой нативной логики совпали; тестовых классов в релизе нет. Release ID `451323758`.
- Паузы, плавная яркость и покадровая обводка из beta.5 сохранены. Старые теги и APK не заменены. Supabase ACTIVE v48 и Vercel production `dpl_HRA7RyqX7unzAG4QuMWSVHiFavrY` / `3d8c81e` не менялись; Edge/БД/сайт не публиковались. Полная запись и оставшиеся проверки — `docs/AGENT_HANDOFF.md`.

## 19.11.2026 — Android 1.0.18-beta.6: продолжение после оператора

- PR #87, release source `01cdc85e028d6aae3d6dfd115fbf7f420125a678`, tag `v1.0.18-beta.6`, code **123**. PR CI `44502651774` и signed-release workflow `44503438919` **SUCCESS**; JVM/lint, UI/CodeQL/Handoff и проверка опубликованного скачивания прошли.
- Убрано ожидание буквальной строки вида N× после реального нажатия оператора. Следующая цифра проверяется по формуле или текущему операнду, а после каждого = обязателен настоящий ожидаемый результат. Операторы не нажимаются повторно вслепую. Учтены Unicode-символы и невидимое форматирование; сообщения об ошибке указывают неподтверждённую кнопку/результат. Темп, яркость и отрисовка остаются из beta.5.
- [CORTEX-1.0.18-beta.6.apk](https://github.com/stasaleksandrov481-netizen/mobile-framework-dev/releases/download/v1.0.18-beta.6/CORTEX-1.0.18-beta.6.apk), **19 046 444 байта**, SHA256 `909a2d4da78290ab82e39371b4511f416cad17272a6258e32919c73403f8be11`. Файл независимо скачан; checksum, сертификат beta.5, package/version, все 25 WebView-файлов и новые нативные helper-методы проверены. Release ID `451174099`.
- Физическое исправление на Samsung A23 ещё требует повторного прогона. Пять новых протокольных тестов воспроизводят скрытый оператор/текущий операнд и неверный результат, но не являются испытанием устройства. Сервер, БД и сайт не обновлялись; старые теги и файлы сохранены. Тег закреплён за release source, а не за последующим журналом.

## 19.11.2026 — Android 1.0.18-beta.5: сценарий, темп и плавность знакомства

- PR #86, source `531e6f3f7a8c10ad68454f56e6cad575df8d5ec5`, tag `v1.0.18-beta.5`, code **122**. Финальный PR Android CI `44492909734`, UI/CodeQL/Handoff и signed-release workflow `44493376972` **SUCCESS**; публикация и скачивание проверены.
- Калькулятор: фиксированный локальный запуск через настоящий Home и установленный пакет, паузы по 2 с, отдельная проверка каждого нажатия, 650 мс между клавишами и 2,2 с на результат. Неактивная после C кнопка = не считается потерей интерфейса; пустая формула не подменяется описанием поля и имеет приоритет над старым preview. Запрос числа независим от успеха первого примера, а прогноз раскрывается только после четырёх реальных подтверждённых результатов.
- Яркость: 60 небольших шагов за 2,2 с в каждую сторону, видимые паузы, поддержка целочисленного ползунка, отмена и прежнее точное восстановление яркости/авторежима. Обводка островка синхронизирована с кадрами экрана вместо таймера 48 мс; геометрия и текст кэшируются. Фактический FPS на устройстве не измерен.
- [CORTEX-1.0.18-beta.5.apk](https://github.com/stasaleksandrov481-netizen/mobile-framework-dev/releases/download/v1.0.18-beta.5/CORTEX-1.0.18-beta.5.apk), **19 045 736 байт**, SHA256 `d0e7a1e02407d763522c649a13fd65abb542c25ab7f94484a81776b2f65d64c8`. Независимо проверены checksum, сертификат beta.4, package/version, 25 WebView-файлов и нативные классы нового сценария. Release ID `451104408`.
- Все 10 новых JVM-регрессий и остальные проверки прошли. Физический повтор на Samsung A23 ещё нужен: предыдущая beta.4 действительно пропустила вычисления, и её успешная сборка не доказывала работу фокусов. Предыдущие релизы сохранены; сайт, сервер и БД не обновлялись. Тег остаётся на release source, а не на последующем журнале.

## 19.11.2026 — Android 1.0.18-beta.4: исправление ложной остановки знакомства

- PR #85, release commit `8175e925e962b7deb32960bdcd93efa3d7f7e489`, tag `v1.0.18-beta.4`, code **121**. PR CI `44482037805` и signed-release workflow `44482541491` **SUCCESS**: сборки, JVM-тесты, lint, подпись, публикация и проверка скачивания; UI/CodeQL/Handoff также прошли.
- Исправлена гонка запуска: уже видимый островок больше не подтверждает ещё не обработанный service intent, а анимация прозрачности не считается потерей разрешений. Реальная потеря доступа, блокировка, ориентация и исчезновение кнопки остановки по-прежнему прекращают действия с восстановлением яркости и отдельным сообщением о причине.
- [CORTEX-1.0.18-beta.4.apk](https://github.com/stasaleksandrov481-netizen/mobile-framework-dev/releases/download/v1.0.18-beta.4/CORTEX-1.0.18-beta.4.apk), **19 034 320 байт**, SHA256 `43be570bbcb2c65358a899dbdc2156b4d3390484ccf450bdb56199c7b77ea3c6`. Файл независимо скачан; checksum, сертификат beta.3, package/version, все 25 WebView-файлов и нативные классы исправления проверены. Release ID `451026924`.
- На физическом Samsung beta.4 ещё требует повторного запуска знакомства. Сообщение пользователя о beta.3 не считать доказательством отсутствия разрешений. Дизайн, сервер, сайт и БД не менялись; предыдущие релизы сохранены. Тег указывает на release commit и не переносится на этот журнал.

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
