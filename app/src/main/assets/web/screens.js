"use strict";

const CortexUI = (() => {
  const M = Cortex;
  const icon = CortexIcons;
  let version = "1.0.15";
  const tabs = [
    ["chats", "Чаты", "message"], ["phone-tools", "Вызов", "mic"], ["home", "Кортекс", ""],
    ["scenarios", "Сценарии", "layers"], ["profile", "Профиль", "user"]
  ];
  const parent = {
    settings: "profile", subscription: "settings", motion: "settings", models: "settings", language: "settings",
    notifications: "settings", data: "profile", memory: "profile", permissions: "profile",
    support: "profile", faq: "support", about: "profile", privacy: "about", guide: "home", "tool-list": "phone-tools", personality: "memory",
    chat: "home", "phone-tools": "settings", schedule: "profile", scenarios: "phone-tools",
    "island-editor": "phone-tools", energy: "settings",
    account: "profile"
  };
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const sign = '<img class="brand-mark" src="art/mark.svg" alt="">';
  const attributes = (action, value = "") => `data-action="${action}" data-value="${esc(value)}"`;

  function iconButton(name, label, action, value = "", extra = "") {
    return `<button type="button" class="icon-btn ${extra}" aria-label="${esc(label)}" title="${esc(label)}" ${attributes(action, value)}>${icon(name, 19)}</button>`;
  }
  function button(label, name, action, value = "", extra = "") {
    return `<button type="button" class="action ${extra}" ${attributes(action, value)}>${name ? icon(name, 17) : ""}<span>${esc(label)}</span></button>`;
  }
  function tile(title, description, name, action, value = "", extra = "") {
    return `<button type="button" class="tile ${extra}" ${attributes(action, value)}>
      <span class="tile-glyph">${icon(name, 20)}</span>
      <span class="tile-copy"><strong>${esc(title)}</strong>${description ? `<small>${esc(description)}</small>` : ""}</span>
      ${icon("chevron", 15)}
    </button>`;
  }
  function switchRow(label, description, on, value) {
    return `<button type="button" class="switch-row" role="switch" aria-checked="${on}" aria-label="${esc(label)}" ${attributes("toggle", value)}>
      <span class="tile-copy"><strong>${esc(label)}</strong><small>${esc(description)}</small></span>
      <span class="switch-track" aria-hidden="true"><i></i></span></button>`;
  }
  function pill(label, action, value, on, name = "") {
    return `<button type="button" class="pill" aria-pressed="${on}" ${attributes(action, value)}>${name ? icon(name, 14) : ""}${esc(label)}</button>`;
  }
  function choices(values, selected, action) {
    return `<div class="filters">${Object.entries(values).map(([value, label]) => pill(label, action, value, selected === value)).join("")}</div>`;
  }
  function modelLogo(item) {
    const src = item.domain ? `/favicons/${esc(item.domain)}` : "art/mark.svg";
    return `<span class="ai-provider-badge"><img class="ai-provider-icon" src="${src}" alt="${esc(item.brand)}" loading="lazy"><span class="ai-provider-initials" hidden aria-hidden="true">${esc(item.brand.slice(0, 1))}</span></span>`;
  }
  function modelChoices(selected, compact = false) {
    return `<div class="ai-model-list ${compact ? "compact" : ""}">${M.aiModels.map(item =>
      `<button type="button" class="ai-model-option" aria-pressed="${selected === item.id}" ${attributes("ai-model", item.id)}>
        ${modelLogo(item)}<span class="ai-model-copy"><strong>${esc(item.name)}</strong><small>${esc(item.brand)}${item.paid || !compact ? " · " + esc(item.detail) : ""}</small></span>
        ${item.paid ? '<span class="ai-model-tier">PRO</span>' : ""}
      </button>`).join("")}</div>`;
  }
  function heading(title, subtitle, actions = "") {
    return `<header class="section-header">
      ${iconButton("back", "Назад", "back", "", "section-back")}
      <div class="section-heading"><h1>${esc(title)}</h1>${subtitle ? `<p>${esc(subtitle)}</p>` : ""}</div>${actions}
    </header>`;
  }
  function detail(title, subtitle, content, actions = "") {
    return heading(title, subtitle, actions) + `<div class="scroll detail-scroll stack">${content}</div>`;
  }
  const label = text => `<h2 class="group-label">${esc(text)}</h2>`;
  const group = content => `<section class="tile-group">${content}</section>`;
  function portrait(account, size = "") {
    const name = account?.name || account?.email || "";
    const initials = name.trim().split(/\s+/u).slice(0, 2).map(word => Array.from(word)[0] || "").join("").toLocaleUpperCase("ru");
    return `<span class="portrait ${size}" aria-hidden="true">${account?.avatar ?
      `<img src="${esc(account.avatar)}" alt="">` : initials ? esc(initials) : icon("user", size === "large" ? 29 : 21)}</span>`;
  }
  function composer() {
    return `<form class="composer" id="composer" autocomplete="off">
      <div id="screen-context" class="screen-context" hidden>
        <details><summary data-screen-title></summary><p data-screen-preview></p></details>
        ${iconButton("link", "Приложить текст экрана", "attach-screen", "", "attach-screen")}
        ${iconButton("close", "Удалить текст экрана", "drop-screen", "", "voice-close")}
      </div>
      <div id="voice-inline" class="voice-inline" hidden>
        <span class="voice-meter" aria-hidden="true"><i class="voice-lens"></i><span class="voice-bars">
          ${Array.from({length: 7}, (_, i) => `<i style="--i:${i};--rise:${1.4 + (3 - Math.abs(3 - i)) * .4}"></i>`).join("")}</span></span>
        <div class="voice-copy"><p data-voice-status role="status"></p><p data-voice-text hidden></p></div>
        ${iconButton("stop", "Завершить запись", "voice-turn", "", "voice-control")}
        ${iconButton("close", "Закончить голосовой режим", "voice-close", "", "voice-close")}
      </div>
      <div class="composer-input-row">
        <textarea id="composer-input" name="message" aria-label="Сообщение" rows="1" maxlength="6000"
          enterkeyhint="send" placeholder="Спросите CORTEX..."></textarea>
        <div class="composer-send-actions">
          <button class="composer-button voice-button" type="button" aria-label="Голосовой разговор" ${attributes("voice-chat")}>${icon("wave", 22)}</button>
          <button class="composer-button send-button" type="submit" aria-label="Отправить сообщение" hidden disabled>${icon("sendUp", 23)}</button>
          <button class="composer-button stop-button" type="button" aria-label="Остановить задачу" ${attributes("stop")} hidden>${icon("stop", 19)}</button>
        </div>
      </div>
      <div class="composer-footer">
        <details class="ai-model-picker"><summary aria-label="Выбрать модель ИИ" title="Выбрать модель ИИ">
          ${modelLogo(M.aiModels.find(item => item.id === M.state.preferences.aiModel) || M.aiModels[0])}
          <span class="ai-model-label">${esc((M.aiModels.find(item => item.id === M.state.preferences.aiModel) || M.aiModels[0]).name)}</span>
          <span class="ai-model-chevron" aria-hidden="true"></span></summary>
          <div class="ai-model-popover"><header>Выбрать модель</header>
          ${modelChoices(M.state.preferences.aiModel, true)}</div>
        </details>
        <button class="quota-ring" type="button" aria-label="Остаток токенов" title="Остаток токенов" ${attributes("quota-detail")} hidden>
          <span class="quota-ring-art" aria-hidden="true"></span>
        </button>
      </div>
    </form>`;
  }

  function home() {
    return `<header class="home-header"><div class="brand">${sign}<span>CORTEX</span></div></header>
      <section class="home-hero" aria-labelledby="home-title">
        <div class="hero-core" data-home-core aria-hidden="true"><i class="core-orbit"></i><i class="core-orbit"></i><i class="core-orbit"></i>
          <i class="core-glass"></i>${sign}</div>
        <div class="hero-copy"><h1 id="home-title">Чем помочь?</h1></div>
      </section>`;
  }

  function thinking() {
    return `<div class="thinking cortex-processing" role="status" aria-label="CORTEX обрабатывает запрос">
      <span class="thinking-core" aria-hidden="true">${sign}</span>
      <span class="thinking-label">CORTEX <span class="thinking-dots" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span></span>
      </div>`;
  }

  function actionProgress(job) {
    return `<div class="action-progress" role="status"><span class="action-pulse">${icon(job.webEnabled || job.webSearching ? "globe" : job.waiting ? "history" : "bolt", 18)}</span>
      <span><strong>${job.webSearching ? "Поиск в интернете" : job.webEnabled ? "Интернет" : job.waiting ? "План на паузе" : "Выполняю…"}</strong>
        <small>${esc(job.waiting ? "Вернитесь в чат, чтобы продолжить" : job.action === "Выполняю…" ? "" : job.action)}</small></span></div>`;
  }

  function webSourceBadges(text, active) {
    if (!active) return "";
    const hosts = new Set();
    for (const match of text.matchAll(/\]\((https?:\/\/[^\s)]+)\)/gu)) {
      if (hosts.size >= 5) break;
      const href = CortexMarkdown.webUrl(match[1]);
      if (!href) continue;
      const host = new URL(href).hostname.toLowerCase();
      if (/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)) hosts.add(host);
    }
    return hosts.size ? `<div class="web-source-badges" aria-label="Сайты-источники">${icon("globe", 14)}<span>Источники</span>` +
      [...hosts].map(host => `<span class="web-source-badge"><img src="/favicons/${esc(host)}" alt="" loading="lazy">${esc(host)}</span>`).join("") +
      "</div>" : "";
  }

  const replyMark = `<span class="reply-mark" aria-hidden="true">${sign}</span>`;

  function chat(ctx) {
    const item = ctx.chat;
    const messages = (item?.messages || []).map((message, index) => message.role === "user"
      ? `<article class="message user${ctx.messageEnter && index === item.messages.length - 1 ? " new-turn" : ""}" aria-label="Вы">${esc(message.text)}</article>`
      : `<article class="message assistant${ctx.messageEnter && index === item.messages.length - 1 ? " new-response" : ""}" aria-label="Ответ CORTEX">
        ${replyMark}${webSourceBadges(message.text, message.webSearch)}<div class="message-body markdown">${CortexMarkdown.render(message.text)}</div>
        ${message.resumable && index === item.messages.length - 1 ? button("Продолжить", "", "resume-visual", "", "outline") : ""}
        <div class="message-actions">${iconButton("copy", "Копировать ответ", "copy", index)}
        ${M.state.preferences.voiceReplies && !message.ephemeral ? iconButton("play", "Озвучить ответ", "speak-answer", index) : ""}
          ${iconButton("refresh", "Перегенерировать", "regenerate", index)}
          ${iconButton("thumb-up", "Полезный ответ", "feedback-up", index, message.feedback === "up" ? "feedback-selected" : "")}
          ${iconButton("thumb-down", "Неудачный ответ", "feedback-down", index, message.feedback === "down" ? "feedback-selected" : "")}
          ${iconButton("note", "Уточнить ответ", "refine-answer", index)}
        </div></article>`).join("");
    const pending = ctx.pending ? `<article class="message assistant pending${ctx.pending.text ? " has-reply" : ""}" aria-label="Ответ CORTEX">
      ${replyMark}${webSourceBadges(ctx.pending.text, ctx.pending.webSearching)}<div class="message-body markdown stream-text" data-stream>${ctx.pending.text ? CortexMarkdown.renderStream(ctx.pending.text) :
      (ctx.pending.action || ctx.pending.waiting ? actionProgress(ctx.pending) : thinking())}</div></article>` : "";
    const error = ctx.error?.code === "offline" ? `<div class="notice chat-offline" role="alert">
      <span class="chat-offline-symbol" aria-hidden="true">${icon("alert", 22)}</span><div><strong>Нет подключения к ИИ</strong>
      <p>Проверьте Wi-Fi или мобильный интернет. Команды телефона доступны без сети.</p>
      ${button("Повторить", "refresh", "retry", "", "outline")}</div></div>` : ctx.error ? `<div class="notice error" role="alert">${icon("alert", 19)}<div><p>${esc(ctx.error.message)}</p>
      <div class="actions">
        ${ctx.error.code === "sign_in" && ctx.native ? button("Войти", "user", "go", "profile", "primary") : ""}
        ${button("Повторить", "refresh", "retry")}
      </div></div></div>` : "";
    return `<header class="chat-header">
      <button type="button" class="chat-control" aria-label="Чаты" ${attributes("go", "chats")}>${icon("back", 19)}<span>Чаты</span></button>
      <div class="chat-brand" data-chat-logo>${sign}<span>CORTEX<small>${item?.saved ? "Сохранённый" : "Временный"}</small></span></div>
      ${item?.saved ? iconButton("dots", "Настройки чата", "chat-menu", item.id) :
        iconButton("trash", "Очистить временный чат", "clear-temporary")}
    </header>
    <div class="scroll conversation" aria-label="Переписка">
      ${messages || pending || error ? `<div class="message-list${ctx.messageEnter ? " entering" : ""}">${messages}${pending}${error}</div>` :
        `<section class="chat-empty" aria-label="CORTEX">${sign}</section>`}
    </div>`;
  }

  const date = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" });
  const time = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" });
  function dateLabel(value) {
    const stamp = new Date(value);
    if (!Number.isFinite(stamp.valueOf())) return "";
    return stamp.toDateString() === new Date().toDateString() ? time.format(stamp) : date.format(stamp);
  }
  function chatItems(ctx) {
    const query = ctx.search.trim().toLocaleLowerCase("ru");
    const items = M.state.chats.filter(item => item.saved &&
      (!query || item.title.toLocaleLowerCase("ru").includes(query) ||
        item.messages.some(message => message.text.toLocaleLowerCase("ru").includes(query))))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated.localeCompare(a.updated));
    if (!items.length) return `<div class="empty-panel">${icon("message", 30)}
      <h3>${query ? "Совпадений нет" : ctx.onlySaved ? "Сохранённых чатов пока нет" : "История пока пуста"}</h3>
      <p>${query ? "Попробуйте другой запрос." : "Диалоги появятся здесь после отправки сообщения."}</p></div>`;
    return items.map(item => `<div class="history-row">
      <button class="history-open" type="button" ${attributes("open-chat", item.id)}>
        <span class="history-glyph">${icon(item.pinned ? "pin" : "message", 17)}</span>
        <span class="tile-copy"><strong>${esc(item.title)}</strong><small>${esc(dateLabel(item.updated))}${item.saved ? " · Сохранён" : " · На эту сессию"}</small></span>
      </button>${iconButton("dots", "Действия с чатом", "chat-menu", item.id)}</div>`).join("");
  }
  function history(ctx) {
    return `<header class="drawer-head"><h2 id="history-title">История чатов</h2>
      ${iconButton("close", "Закрыть историю", "close-history")}</header>
      <label class="search-box">${icon("search", 19)}<input id="history-search" type="search" aria-label="Поиск по чатам"
        placeholder="Поиск по чатам" value="${esc(ctx.search)}"></label>
      <div class="drawer-scroll" id="history-items">${chatItems(ctx)}</div>`;
  }

  function chats() {
    return `<header class="profile-header chats-header"><h1>Чаты</h1>
      ${iconButton("search", "Поиск по чатам", "history")}</header>
      <div class="scroll detail-scroll stack">${button("Новый чат", "plus", "new-chat", "", "primary")}
        ${chatItems({ search: "" })}</div>`;
  }

  function profile(ctx) {
    const account = M.state.account;
    const type = { Email: "Вход по почте", Yandex: "Яндекс ID", Google: "Существующий аккаунт" }[account?.provider];
    return `<header class="profile-header"><h1>Профиль</h1></header>
      <div class="scroll profile-scroll stack">
        <section class="profile-identity glass-card">
          ${portrait(account, "large")}
          <div class="account-copy"><strong>${esc(account?.name || "Войдите в CORTEX")}</strong>
            <p>${esc(account?.email || "Для работы нужен аккаунт")}</p>
            ${type ? `<small class="muted">${esc(type)}</small>` : ""}
          </div>
          ${!account && ctx.native ? `<div class="profile-signin actions">
            ${button("Войти", "user", "account-options", "", "primary")}
            ${button("Создать аккаунт", "", "email-auth", "signup", "outline")}</div>` : ""}
        </section>
        ${CortexSubscription.balance(ctx.connection?.quota || ctx.connection?.subscription?.quota, esc)}
        ${group(tile("Напоминания", "Созданные голосом и вручную", "bell", "go", "schedule") +
          tile("Настройки", "", "sliders", "go", "settings") +
          tile("Данные и чаты", "", "folder", "go", "data") +
          tile("Память и персонализация", "", "memory", "go", "memory"))}
        ${group(tile("Разрешения Android", "", "shield", "go", "permissions") +
          tile("Помощь и поддержка", "", "help", "go", "support") +
          tile("О приложении", "Версия и конфиденциальность", "info", "go", "about"))}
        ${account ? button("Выйти из аккаунта", "logout", "logout", "", "quiet") : ""}
      </div>`;
  }

  const accountModes = {
    password: ["Войдите в CORTEX", "Продолжите с электронной почтой.", "Войти"],
    signup: ["Создайте аккаунт", "Код подтверждения придёт на почту.", "Получить код"],
    verify: ["Подтвердите почту", "Введите код из письма CORTEX.", "Подтвердить и войти"],
    recover: ["Восстановите доступ", "Получите код для смены пароля.", "Получить код"],
    reset: ["Задайте новый пароль", "Введите код из письма и новый пароль.", "Сменить пароль"]
  };

  function accountAvailability(connection, mode = "password") {
    if (connection.status === "preview") return "Вход доступен в Android-приложении.";
    if (connection.status === "offline") return "Проверьте подключение к интернету и повторите попытку.";
    if (connection.status === "loading") return "Проверяем доступность входа…";
    if (mode === "password") return connection.email ? "" : "Вход по почте пока недоступен.";
    return connection.emailRegistration ? "" : "Подтверждение по почте станет доступно после подключения отправки писем.";
  }

  function account(ctx) {
    const { connection, email, accountMode, resendWait = 0 } = ctx;
    const [title, description, submit] = accountModes[accountMode];
    const newPassword = accountMode === "signup" || accountMode === "reset";
    const code = accountMode === "verify" || accountMode === "reset";
    const password = (name, caption) => `<label class="field"><span>${caption}</span><span class="account-password">
      <input name="${name}" type="password" required maxlength="72" ${newPassword ? 'minlength="10" autocomplete="new-password"' : 'autocomplete="current-password"'}>
      ${iconButton("eye", "Показать пароль", "password-visibility")}</span></label>`;
    return `<header class="section-header account-top">${M.state.account ? iconButton("back", "К профилю", "back", "", "section-back") : ""}
      <span class="brand">${sign}<span>CORTEX</span></span></header>
      <div class="scroll account-scroll"><div class="account-page">
        <div class="account-hero"><div class="account-art glass-card" aria-hidden="true">${sign}<i></i><i></i></div>
          <section class="account-heading"><h1>${title}</h1><p>${description}</p></section></div>
        ${["password", "signup"].includes(accountMode) ? `<div class="account-tabs" aria-label="Способ входа">
          ${pill("Вход", "email-auth", "password", accountMode === "password")}${pill("Регистрация", "email-auth", "signup", accountMode === "signup")}</div>` : ""}
        <form id="account-form" class="account-fields" data-mode="${accountMode}">
          ${accountMode === "signup" ? '<label class="field"><span>Имя</span><input name="name" type="text" autocomplete="name" maxlength="100" placeholder="По желанию"></label>' : ""}
          <label class="field"><span>Электронная почта</span><input name="email" type="email" maxlength="254" required autocomplete="email"
            placeholder="name@example.com" value="${esc(email)}" autocapitalize="none" spellcheck="false"></label>
          ${code ? `<label class="field account-code-field"><span>Шестизначный код из письма</span>
            <span class="account-code" data-account-code>
              <input name="code" class="account-code-input" type="text" inputmode="numeric" required
                aria-label="Шестизначный код подтверждения" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6">
              ${Array.from({ length: 6 }, (_, index) => `<span class="account-code-cell" aria-hidden="true" data-code-cell="${index}"></span>`).join("")}
            </span></label>
            <div class="account-resend">
              <span class="muted">Не пришло письмо? Проверьте папку «Спам».</span>
              <button type="button" class="action quiet" data-action="resend-code" ${resendWait > 0 ? "disabled" : ""}
                data-resend-button>${resendWait > 0 ? `Повторить через ${resendWait} с` : "Отправить код ещё раз"}</button>
            </div>` : ""}
          ${accountMode === "password" || newPassword ? password("password", newPassword ? "Новый пароль" : "Пароль") : ""}
          ${newPassword ? password("confirmation", "Повторите пароль") + '<small class="muted">Минимум 10 символов.</small>' : ""}
          <p class="account-availability" data-auth-status role="status" ${accountAvailability(connection, accountMode) ? "" : "hidden"}>${accountAvailability(connection, accountMode)}</p>
          <p class="form-error" role="alert" hidden></p>
          <button class="action primary account-submit" type="submit"><span>${submit}</span>${icon("chevron", 18)}</button>
          ${accountMode === "password" ? `<div class="account-links">${button("Забыли пароль?", "", "email-auth", "recover", "quiet")}
            ${button("Подтвердить почту", "", "email-auth", "verify", "quiet")}</div>` : ""}
        </form>
        ${!["password", "signup"].includes(accountMode) ? button("Вернуться ко входу", "back", "email-auth", "password", "quiet") : ""}
      </div></div>`;
  }
  function settings() {
    return detail("Настройки", "", group(
      tile("Вызов CORTEX", "Островок, голос и управление телефоном", "mic", "go", "phone-tools") +
      tile("Как к вам обращаться", M.state.preferences.addressName || "Без имени", "user", "address-name") +
      tile("Энергопотребление", "", "bolt", "go", "energy") +
      tile("Подписка", "Тарифы, лимиты и платежи", "spark", "go", "subscription") +
      tile("Модели ИИ", "Профили моделей", "spark", "go", "models") +
      tile("Язык", "Язык ответа и распознавания", "globe", "go", "language") +
      tile("Анимации и отклик", "Движение интерфейса и вибрация", "wave", "go", "motion") +
      tile("Уведомления", "Оповещения о готовом ответе", "bell", "go", "notifications")
      + tile("Повторить знакомство с CORTEX", "Настоящее управление телефоном", "refresh", "first-experience")
    ));
  }
  function motion() {
    const p = M.state.preferences;
    return detail("Анимации и отклик", "", `<section class="panel stack"><h2>Фоновая анимация</h2>
      ${choices(M.motion, p.quality, "quality")}
      ${switchRow("Уменьшить движение", "Убрать движение точек и переходы", p.reduceMotion, "reduceMotion")}
      ${switchRow("Тактильный отклик", "Лёгкий импульс при переходе, отправке и записи", p.haptics, "haptics")}
    </section>`);
  }
  function phoneTools(ctx) {
    const p = M.state.preferences;
    const native = Boolean(window.CortexIslandControl);
    const perm = (ctx && ctx.permissions) || {};
    let status = "Островок и обращение «Кортекс» работают только в Android-приложении CORTEX.", fix = "";
    if (native && !perm.overlay) {
      status = "Разрешите показ поверх приложений — тогда островок появится у камеры.";
      fix = tile("Показ поверх приложений", "Откроется системная настройка Android", "focus", "overlay-permission");
    } else if (native) {
      status = p.overlayMode === "off" ? "Выберите режим ниже, чтобы включить островок." : "Нажмите на островок, чтобы написать Кортексу и получить ответ.";
    }
    const voiceRow = native
      ? switchRow("Обращение «Кортекс»", perm.microphone ? (p.hotwordEnabled && ctx?.wakeState || "Скажите «Кортекс», затем команду. Ответ появится в островке.") : "Сначала выдайте доступ к микрофону.", p.hotwordEnabled, "hotwordEnabled") +
        (perm.microphone ? "" : tile("Доступ к микрофону", "Нужен для обращения «Кортекс»", "mic", "microphone-permission"))
      : `<div class="feature-detail"><strong>Голосовое обращение</strong><small>Доступно в Android-приложении CORTEX.</small></div>`;
    const options = [
      ["always", "Постоянный островок", "Кортекс виден поверх приложений. В горизонтальном режиме его можно скрывать."],
      ["wake", "Появляется по вызову", "Островок появляется только при активации. Слово «Кортекс» включается ниже, в блоке «Голосовое обращение»."],
      ["off", "Без островка", "Управление из приложения и системных способов запуска."]
    ];
    return detail("Вызов CORTEX", "Островок и управление телефоном",
      `<section class="call-overview glass-card">
        <div class="call-preview" aria-hidden="true"><span>${sign}</span></div>
        <div class="call-overview-copy"><h2>Островок</h2><p>${esc(status)}</p></div>
      </section>
      ${fix ? group(fix) : ""}
      ${group(tile("Оформление островка", "Размер, положение, цвета и индикаторы", "sliders", "go", "island-editor"))}
      <h2 class="group-label">Когда показывать</h2>
      <section class="surface-choices" role="radiogroup" aria-label="Режим островка">
        ${options.map(([value, title, hint]) => `<button type="button" class="surface-option" role="radio"
          aria-checked="${p.overlayMode === value}" ${attributes("surface-mode", value)}>
          <span class="surface-radio" aria-hidden="true"></span><span><strong>${esc(title)}</strong><small>${esc(hint)}</small></span>
          <span class="surface-preview ${value}" aria-hidden="true"><i></i></span>
        </button>`).join("")}
      </section>
      ${group(switchRow("Скрывать в альбомном режиме", "Например, в играх и видео", p.hideLandscape, "hideLandscape"))}
      <h2 class="group-label">Способы вызова</h2>
      ${group((perm.assistantSupported ? tile("Цифровой помощник Android",
        perm.assistant ? "CORTEX выбран · открывает островок" : "Выбрать CORTEX для системного жеста",
        "focus", "assistant-permission") : "") + voiceRow +
        switchRow("Продолжать голосовой ввод", "Слушать следующую команду после ответа", p.voiceContinue, "voiceContinue") +
        switchRow("Озвучивать ответы", "Голосовой режим и кнопка воспроизведения в чате", p.voiceReplies, "voiceReplies") +
        (p.voiceReplies ? tile("Проверить голос", "", "play", "voice-preview") : ""))}
      <h2 class="group-label">Управление телефоном</h2>
      ${group(switchRow("Команды телефона", "Фонарик, громкость и запуск приложений через Android", p.phoneActions, "phoneActions") +
        `<label class="switch-row call-beta-row">
          <span class="tile-copy"><strong>Визуальное управление <span class="call-beta-badge">БЕТА</span></strong>
          <small>Нажатия, свайпы и чтение экрана по запросу</small></span>
          <input type="checkbox" data-visual-beta aria-label="Визуальное управление (бета)" ${p.visualAutomation ? "checked" : ""}>
        </label>` +
        switchRow("Показывать, как открываются приложения", "Для сценариев и визуальных команд", p.visualLaunch, "visualLaunch"))}
      <h2 class="group-label">Инструменты</h2>
      ${group(tile("Сценарии", "Сохранённые цепочки действий", "layers", "go", "scenarios") +
        tile("Разрешения Android", "Микрофон, островок и доступ к экрану", "shield", "go", "permissions") +
        tile("Как управлять экраном", "Примеры команд и подтверждения действий", "focus", "go", "tool-list") +
        tile("Настроить заново", "Открыть пошаговую настройку", "sliders", "open-setup"))}`);
  }

  function toolList() {
    return detail("Управление экраном", "Доступность зависит от Android и открытого приложения",
      '<section class="panel stack"><p>Назовите цель или путь по экрану. Например, «Открой Настройки → Дисплей».</p>' +
      '<p>«Проверь, почему отключается Wi-Fi» запускает проверку сети. «Почини Wi-Fi, включается режим модема» также позволяет изменить связанные переключатели.</p>' +
      '<p>Для действий с отправкой или удалением CORTEX запросит подтверждение. Защищённые экраны требуют ручного ввода.</p></section>');
  }
  function guide() {
    return detail("Как пользоваться", "Вы управляете — CORTEX помогает", `<section class="guide-steps">
      <div>${icon("message", 22)}<strong>Сформулируйте цель</strong><p>Напишите обычными словами, что нужно сделать. Не требуется запоминать команды.</p></div>
      <div>${icon("mic", 22)}<strong>Говорите голосом</strong><p>Голосовой ввод работает внутри приложения. Фоновое обращение «Кортекс» включается в настройках.</p></div>
      <div>${icon("focus", 22)}<strong>Выберите способ вызова</strong><p>Выберите предпочитаемый режим. Островок у камеры показывает, что CORTEX слушает и выполняет.</p></div>
      <div>${icon("shield", 22)}<strong>Контролируйте доступ</strong><p>Разрешения выдаются для отдельных функций и всегда управляются через Android.</p></div>
      </section>` + button("Настроить CORTEX", "sliders", "go", "phone-tools", "primary"));
  }
  function models(ctx) {
    return detail("Модели ИИ", "", `<section class="panel stack">
      ${modelChoices(M.state.preferences.aiModel)}
      <h2 class="group-label">Режим авто</h2>${choices(M.models, M.state.preferences.model, "model-profile")}
    </section>`);
  }
  function language() {
    return detail("Язык", "Ответы и распознавание речи", `<section class="panel stack"><h2>Язык CORTEX</h2>
      ${choices(M.languages, M.state.preferences.language, "language")}
      <p class="muted">В режиме «Авто» CORTEX отвечает на языке сообщения. Для диктовки в этом режиме используется русский.</p></section>`);
  }
  function notifications(ctx) {
    return detail("Уведомления", "Ответы в фоновом режиме", `<section class="panel stack">
      ${switchRow("Ответы поддержки", "Уведомлять о новых сообщениях в обращениях", M.state.preferences.notifyReplies, "notifyReplies")}
      <p class="muted">${ctx.native && ctx.permissions.notifications ? "Android разрешает уведомления." : "Для оповещений нужен доступ в настройках Android."}</p>
    </section>` + group(tile("Сводка событий телефона",
      ctx.permissions.notificationAccess ? "CORTEX считает новые уведомления. Тексты не сохраняются." : "Разрешите доступ, чтобы спрашивать «Что нового?»",
      "bell", "notification-listener-permission") +
      (ctx.permissions.notificationAccess ? tile("Очистить журнал уведомлений", "Удалить сохранённые сведения о событиях", "trash", "notification-journal-clear") : "")));
  }
  function data() {
    const p = M.state.preferences;
    return detail("Данные и чаты", "", `<section class="panel stack">
      ${switchRow("Контекст прошлых чатов", "Учитывать сохранённые беседы", p.rememberSaved, "rememberSaved")}
    </section>` + group(
      tile("Экспорт чатов", "JSON", "download", "export") +
      tile("Очистить историю", "", "trash", "clear-chats", "", "danger") +
      tile("Сбросить данные", "", "trash", "clear-local", "", "danger")
    ));
  }
  function memory() {
    const data = M.memory();
    return detail("Память и персонализация", "",
      `<section class="panel">${switchRow("Память", "Учитывать сохранённые факты", data.enabled, "memory")}</section>` +
      group(tile("Стиль ответов", M.styles[M.profile().style], "sliders", "go", "personality")) +
      label("Факты") + (data.entries.length ? group(data.entries.map(entry =>
        tile(entry.title, entry.value, "memory", "memory-edit", entry.id)).join("")) :
        '') + button("Добавить факт", "plus", "memory-edit", "", "outline"));
  }
  function personality() {
    const person = M.profile();
    return detail("Манера общения", "Как CORTEX отвечает", `<section class="panel stack">
      <h2>Длина ответа</h2>${choices(M.styles, person.style, "reply-style")}
      <div class="readout"><strong>Тон</strong><p>${esc(person.tone)}</p></div>
      ${button("Изменить", "note", "personality-edit")}
    </section>`);
  }
  function permissions(ctx) {
    const a = ctx.permissions;
    const compatibility = ctx.compatibility;
    const support = compatibility ? [
      ["Голосовой ввод", compatibility.speech],
      ["Фоновый вызов по имени", compatibility.offlineWake],
      ["Камера", compatibility.camera], ["Фонарик", compatibility.flashlight],
      ["Wi-Fi", compatibility.wifi], ["Bluetooth", compatibility.bluetooth],
      ["NFC", compatibility.nfc], ["Мобильная связь", compatibility.telephony]
    ] : [];
    const compatibilityPanel = compatibility ? `<details class="panel stack"><summary>Совместимость с этим телефоном</summary>
      <p class="muted">${esc(compatibility.manufacturer || "Android")} ${esc(compatibility.model || "")} · Android API ${esc(String(compatibility.sdk || "?"))}</p>
      <div class="access-list">${support.map(([name, available]) => `<div class="access-row"><div class="tile-copy"><strong>${esc(name)}</strong>
        <small>${available ? "Доступно на устройстве" : "Нет системной поддержки или компонента"}</small></div></div>`).join("")}</div>
      <p class="quiet-copy">Без локального распознавания можно использовать текстовый чат и доступный голосовой ввод в приложении.
      Некоторые оболочки дополнительно ограничивают фоновые службы. Для них может потребоваться настройка энергосбережения вручную.</p></details>` : "";
    const item = (glyph, title, desc, enabled, action, required = false) =>
      `<div class="access-row"><span class="access-symbol">${icon(glyph, 21)}</span><div class="tile-copy"><strong>${esc(title)}</strong>
        <small>${esc(desc)}</small><span class="access-state">${enabled ? "Разрешено" : required ? "Требуется разрешение" : "Необязательно"}</span></div>
        <button class="access-open" type="button" ${attributes(action)}>${enabled ? "Проверить" : "Настроить"}</button></div>`;
    return detail("Доступы Android", "Давайте только те разрешения, которые нужны вам", `<section class="access-list">
      ${item("mic", "Микрофон", "Речь и активация по имени. Фоновое прослушивание отдельно включается в настройках.", a.microphone, "microphone-permission")}
      ${item("focus", "Поверх приложений", "Показывать островок поверх других окон. Не даёт доступа к содержимому экрана.", a.overlay, "overlay-permission")}
      ${item("focus", "Фонарик", "Доступ к вспышке через Android. CORTEX только переключает вспышку.", a.camera, "camera-permission")}
      ${item("bell", "Уведомления", "Статус задач, кнопка остановки и новые ответы поддержки.", a.notifications, "notification-permission")}
      ${item("bell", "Чтение уведомлений", "По вашему разрешению считает новые события. Содержимое не сохраняет и не отправляет ИИ.", a.notificationAccess, "notification-listener-permission")}
      ${item("check", "Управление экраном", "Системная шторка, нажатия и свайпы. Для визуальных команд отдельно включите БЕТА в разделе «Вызов».", a.screenAutomation, "verification-permission")}
      ${item("sliders", "Изменение яркости", "Для изменения и восстановления яркости в интерактивном знакомстве.", a.brightness, "brightness-permission")}
      ${a.assistantSupported ? item("focus", "Цифровой помощник", "Выбрать CORTEX для системного жеста вызова помощника.", a.assistant, "assistant-permission") : ""}
      </section>
      ${compatibilityPanel}
      <p class="quiet-copy">Некоторые разрешения Android показывает в отдельных системных меню. Нажатие «Настроить» не означает, что доступ уже выдан.</p>
      <div class="actions">${button("Журнал действий", "history", "action-history", "", "outline")}
      ${button("Повторить начальную настройку", "refresh", "open-setup", "", "outline")}</div>`);
  }
  function support() {
    return heading("Поддержка", "", button("FAQ", "help", "go", "faq", "outline faq-shortcut")) + `<section class="support-chat" id="support-chat">
      <div class="support-messages" id="support-messages" aria-live="polite"><div class="support-message support-assistant">Напишите, что случилось. Я помогу разобраться.</div></div>
      <form class="support-compose" id="support-compose"><textarea name="message" rows="1" maxlength="3000" required placeholder="Сообщение поддержке" aria-label="Сообщение поддержке"></textarea>
        <button type="submit" aria-label="Отправить">${icon("sendUp", 21)}</button></form>
    </section>`;
  }

  const questions = [
    ["Быстрый старт", "Что работает без интернета?", "Поддерживаемые команды телефона, напоминания и сценарии выполняются на устройстве. Для ответов облачного ИИ нужно подключение."],
    ["Быстрый старт", "Как запустить сценарий голосом?", "Откройте «Сценарии», сохраните цепочку и скажите «Запусти сценарий» и его название. Можно указать свою фразу запуска."],
    ["Островок", "Как открыть островок кнопкой «Домой»?", "В разделе «Вызов» выберите CORTEX цифровым помощником Android и разрешите показ поверх приложений. Используйте жест или кнопку вызова помощника на вашем устройстве."],
    ["Островок", "Почему островок не виден?", "Проверьте разрешение показа поверх приложений и режим в разделе «Вызов». Для альбомной ориентации действует отдельная настройка."],
    ["Островок", "Как включить визуальное управление?", "Включите «Визуальное управление» в разделе «Вызов». Затем в специальных возможностях Android разрешите службу CORTEX. Защищённые экраны требуют ручного ввода."],
    ["Напоминания", "Где посмотреть то, о чём я попросил напомнить?", "Откройте «Профиль» → «Напоминания». Там появятся записи, которые CORTEX успешно сохранил после голосовой или текстовой команды."],
    ["Напоминания", "Почему напоминание пришло позже?", "Android может задержать сигнал, если точные напоминания или уведомления ограничены. Их можно настроить в разделе «Напоминания»."],
    ["Аккаунт и лимиты", "Где виден лимит ИИ?", "Остаток, дневной максимум и время обновления видны в профиле. В разделе «Подписка» указаны лимиты тарифов. Локальные команды не расходуют облачные токены."],
    ["Аккаунт и лимиты", "Как вернуть доступ к аккаунту?", "Выберите «Вход по почте», затем «Забыли пароль?». Введите код, который придёт на вашу почту, и задайте новый пароль."]
  ];
  function faq() {
    return detail("Частые вопросы", "", `<section class="faq faq-page" data-faq>
      <label class="faq-search search-box">${icon("search", 18)}
        <input type="search" id="faq-search" placeholder="Найти ответ" aria-label="Поиск по вопросам" maxlength="80"></label>
      ${[...new Set(questions.map(([category]) => category))].map(category =>
        `<section class="faq-group" data-faq-group><h2>${esc(category)}</h2>
          ${questions.filter(([key]) => key === category).map(([, question, answer]) => `<details data-faq-category="${esc(category)}">
            <summary><span>${esc(question)}</span>${icon("chevron", 15)}</summary><p>${esc(answer)}</p></details>`).join("")}
        </section>`).join("")}
      <p class="muted" data-faq-empty hidden role="status">Совпадений нет. Попробуйте другие слова.</p>
    </section>`);
  }
  function about(ctx) {
    const publicId = M.state.account?.public_id || "";
    const idType = M.state.account ? "ID аккаунта" : "ID гостя";
    return detail("О приложении", "", `<section class="panel about-card">
      <div class="brand">${sign}<span>CORTEX</span></div><p class="muted">Версия ${version}</p>
    </section>${publicId ? `<details class="profile-id-details"><summary>Данные приложения</summary>
      <p class="muted">${idType}: <code>${esc(publicId)}</code></p>
      <p class="muted">Идентификатор для обращения в поддержку.</p></details>` : ""}` + group(tile("Конфиденциальность", "", "shield", "go", "privacy") +
      tile("Поддержка", "", "help", "go", "support")));
  }
  function privacy(ctx) {
    return detail("Конфиденциальность", "Данные, необходимые для работы", `<section class="panel stack prose">
      <h2>Профиль</h2><p>CORTEX получает имя и адрес почты при входе. Пароли и одноразовые коды обрабатывает Supabase Auth. История чатов остаётся на вашем устройстве.</p>
      <h2>Сообщения</h2><p>Сохранённые чаты остаются на устройстве. Команды, которые выполняет локальный движок, остаются на телефоне. Для разговорных ответов и сложных задач CORTEX передаёт серверу запрос и нужный контекст. Сервер обращается к OpenRouter.</p>
      <h2>Голос и команды</h2><p>Речь распознаёт служба Android. Распознанная команда проходит ту же обработку, что и текстовая. CORTEX читает элементы и распознаёт текст на телефоне. При вашем согласии для сложной задачи сервер и OpenRouter могут получить краткое описание экрана. Снимки экрана остаются на телефоне.</p>
      ${window.CortexDevice ? button(ctx.connection.visualPrivacy ? "Отключить передачу текста экрана ИИ" : "Разрешить передачу текста экрана ИИ", "shield", "visual-privacy", "", "outline") : ""}
      <h2>Поддержка</h2><p>Разработчик получает текст обращения и приложенные вами email, скриншот и версию приложения.</p>
    </section>`);
  }

  function page(route, ctx) {
    const pages = { home, chat, chats, profile, account, settings, subscription: ctx => CortexSubscription.page(ctx, { detail, esc, button }), motion, "phone-tools": phoneTools, language, notifications,
      data, memory, personality, permissions, support, faq, about, privacy, guide, models, "tool-list": toolList };
    return pages[route](ctx);
  }
  function navigation() {
    return '<span class="dock-glass" aria-hidden="true"></span><span class="nav-indicator" aria-hidden="true"></span>' +
      tabs.map(([key, title, name]) => key === "home" ?
        `<button type="button" class="dock-core" data-tab="home" aria-label="Кортекс" ${attributes("tab", "home")}>
          <span class="dock-emblem">${sign}</span></button>` :
        `<button type="button" class="dock-tab" data-tab="${key}" ${attributes("tab", key)}>
          <span class="nav-icon">${icon(name, 20)}</span><span>${title}</span></button>`).join("");
  }
  return { esc, icon, iconButton, button, tile, detail, get version() { return version; },
    setVersion(value) { if (/^\d+\.\d+\.\d+(?:[-.][a-z0-9.]+)?$/i.test(value)) version = value; },
    tabs, parent, page, composer, navigation, history, chatItems, accountModes, accountAvailability };
})();
