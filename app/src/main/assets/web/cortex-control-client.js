"use strict";

window.CortexControl = (() => {
  const api = CortexApi;
  if (!api?.available) return { back: () => false, refresh() {} };
  const { esc, icon } = CortexUI;
  const device = window.CortexDevice;
  const visible = () => !document.hidden && window.cortexAppVisible !== false;
  const send = (operation, fields = {}) => device?.postMessage(JSON.stringify({ operation, ...fields }));
  const layer = document.createElement("section");
  layer.className = "cortex-guard";
  layer.hidden = true;
  layer.setAttribute("aria-labelledby", "gate-title");
  layer.innerHTML = '<div class="cortex-guard-card"><div class="cortex-guard-halo" aria-hidden="true"><i></i>' +
    '<img src="art/mark.svg" alt=""></div><h1 id="gate-title"></h1><p class="cortex-guard-copy"></p>' +
    '<div class="cortex-guard-actions"><button type="button" data-gate-update hidden>Обновить CORTEX</button>' +
    '<button type="button" data-gate-retry>Проверить снова</button><button type="button" data-gate-login hidden>Войти в профиль</button></div></div>';
  document.body.append(layer);
  const update = layer.querySelector("[data-gate-update]");
  let gate = { mode: "open" }, checking = false, again = false;
  function applyGate(value, canSignIn) {
    if (!["open", "maintenance", "update", "beta"].includes(value?.mode)) return;
    gate = value;
    layer.hidden = gate.mode === "open";
    send("gate-state", { mode: gate.mode });
    if (layer.hidden) return;
    const titles = { maintenance: "Скоро вернёмся", update: "Обновите CORTEX", beta: "Закрытая бета" };
    const descriptions = {
      maintenance: "Мы обслуживаем CORTEX. Попробуйте проверить доступ чуть позже.",
      update: "Установите свежую версию, чтобы продолжить.",
      beta: "Войдите в аккаунт, допущенный к закрытому тестированию."
    };
    layer.querySelector("h1").textContent = titles[gate.mode];
    const copy = descriptions[gate.mode];
    layer.querySelector(".cortex-guard-copy").textContent = String(gate.message || copy).slice(0, 400);
    layer.dataset.mode = gate.mode;
    layer.querySelector("[data-gate-login]").hidden = !canSignIn;
    update.hidden = gate.mode !== "update" || !/^https:\/\//.test(gate.update_url || "");
  }

  async function check() {
    if (!visible()) return;
    if (checking) { again = true; return; }
    checking = true;
    try { const status = await api.request("status"); applyGate(status.gate, status.email_login === true || status.email_auth === true); }
    catch { /* Keep the last verified state until the connection returns. */ }
    finally {
      checking = false;
      if (again) { again = false; void check(); }
    }
  }
  layer.querySelector("[data-gate-retry]").addEventListener("click", check);
  layer.querySelector("[data-gate-login]").addEventListener("click", () => window.cortexAdminLogin?.());
  update.addEventListener("click", () => {
    if (/^https:\/\//.test(gate.update_url || "")) send("open-link", { url: gate.update_url });
  });

  let session = crypto.randomUUID();
  let wasVisible = visible();
  let hiddenAt = 0;
  let lastHeartbeat = 0;
  async function heartbeat() {
    if (!visible() || Date.now() - lastHeartbeat < 42_000) return;
    lastHeartbeat = Date.now();
    try {
      const result = await api.request("presence", { payload: { session_id: session,
        screen: document.querySelector("#screen")?.dataset.route || "home" } });
      if (typeof result.guest_id === "string" && /^@g\d{6,17}$/.test(result.guest_id)) {
        window.dispatchEvent(new CustomEvent("cortex-guest-id", { detail: result.guest_id }));
      }
    }
    catch { /* Presence is retried on the next interval. */ }
  }

  const inbox = document.createElement("dialog");
  inbox.className = "cortex-inbox";
  inbox.setAttribute("aria-labelledby", "inbox-title");
  inbox.innerHTML = '<header class="inbox-header"><button type="button" data-thread-back aria-label="К списку обращений" hidden>' +
    icon("back", 20) + '</button><div><h2 id="inbox-title">Мои обращения</h2><small data-thread-state hidden></small></div>' +
    '<button type="button" data-close aria-label="Закрыть">' + icon("close", 20) + '</button></header>' +
    '<div class="cortex-inbox-main"></div>';
  document.body.append(inbox);
  inbox.querySelector("[data-close]").addEventListener("click", () => inbox.close());
  inbox.querySelector("[data-thread-back]").addEventListener("click", closeThread);
  inbox.addEventListener("cancel", event => { if (closeThread()) event.preventDefault(); });
  inbox.addEventListener("close", () => { activeThread = ""; inboxData = null; host.textContent = ""; });
  const host = inbox.querySelector(".cortex-inbox-main");
  const statusLabels = {
    new: "Новое", open: "Открыто", received: "Получено", pending: "Ожидает", in_progress: "В работе",
    answered: "Есть ответ", resolved: "Решено", closed: "Закрыто"
  };
  let inboxRequest;
  const repliesOf = data => Array.isArray(data?.replies) ? data.replies : [];
  const replyIds = data => repliesOf(data).map(reply => reply.id).filter(id => typeof id === "string");
  function fetchInbox() {
    const owner = Cortex.state.account?.id || "";
    if (inboxRequest?.owner === owner) return inboxRequest.result;
    inboxRequest?.controller.abort();
    const pending = { owner, controller: new AbortController() };
    pending.result = api.request("support-inbox", {}, { signal: pending.controller.signal }).then(data => {
      if ((Cortex.state.account?.id || "") !== owner) throw api.failure("sign_in");
      return data;
    }).finally(() => { if (inboxRequest === pending) inboxRequest = null; });
    inboxRequest = pending;
    return pending.result;
  }
  let activeThread = "", inboxData = null;
  const categories = { contact: "Связь с разработчиком", bug: "Ошибка", idea: "Предложение", complaint: "Жалоба" };
  const timeFormat = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" });
  const dateFormat = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" });
  function time(value, format) {
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? "" : format.format(date);
  }
  function closeThread() {
    if (!activeThread) return false;
    const previous = activeThread;
    activeThread = "";
    renderInbox(inboxData);
    [...host.querySelectorAll("[data-ticket]")].find(button => button.dataset.ticket === previous)?.focus();
    return true;
  }
  function renderInbox(data) {
    inboxData = data;
    const replies = repliesOf(data);
    const tickets = Array.isArray(data?.tickets) ? data.tickets : [];
    const ticket = tickets.find(item => item.id === activeThread);
    if (!ticket) activeThread = "";
    const status = item => statusLabels[item.status] || item.status || "";
    const title = item => categories[item.category] || "Обращение";
    const subtitle = inbox.querySelector("[data-thread-state]");
    inbox.querySelector("[data-thread-back]").hidden = !ticket;
    inbox.querySelector("#inbox-title").textContent = ticket ? title(ticket) : "Мои обращения";
    subtitle.hidden = !ticket;
    subtitle.textContent = ticket ? status(ticket) + " · №" + String(ticket.id).slice(0, 8).toUpperCase() : "";
    inbox.classList.toggle("in-thread", Boolean(ticket));
    if (!tickets.length) {
      host.innerHTML = '<div class="inbox-empty">' + icon("message", 30) +
        '<strong>Обращений пока нет</strong><p>Здесь появятся ваши сообщения и ответы поддержки.</p></div>';
      return;
    }
    if (ticket) {
      const rows = replies.filter(reply => reply.ticket_id === ticket.id)
        .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
      const bubble = (item, mine) => '<div class="ticket-bubble ' + (mine ? 'mine' : 'theirs') + '"><small>' +
        (mine ? "Вы" : "Поддержка CORTEX") + '</small><p>' + esc(item.message) + '</p><time>' +
        esc(time(item.created_at, timeFormat)) + '</time></div>';
      const bottom = host.scrollHeight - host.scrollTop - host.clientHeight < 80;
      host.innerHTML = '<div class="ticket-date">' + esc(time(ticket.created_at, dateFormat)) + '</div>' +
        bubble(ticket, true) + rows.map(reply => bubble(reply, false)).join("");
      if (bottom) host.scrollTop = host.scrollHeight;
      return;
    }
    const sorted = tickets.map(item => ({ item, last: replies.find(reply => reply.ticket_id === item.id) || item }))
      .sort((a, b) => String(b.last.created_at).localeCompare(String(a.last.created_at)));
    host.innerHTML = sorted.map(({ item, last }) => '<button type="button" class="thread-row" data-ticket="' + esc(item.id) +
      '"><span class="inbox-avatar">' + icon("message", 19) + '</span><span class="inbox-preview"><strong>' +
      esc(title(item)) + '</strong><span>' + esc(last.message) + '</span></span><span class="thread-meta"><time>' +
      esc(time(last.created_at, dateFormat)) + '</time><small>' + esc(status(item)) + '</small></span></button>').join("");
  }
  host.addEventListener("click", event => {
    const row = event.target.closest("[data-ticket]");
    if (!row || !inboxData?.tickets?.some(item => item.id === row.dataset.ticket)) return;
    activeThread = row.dataset.ticket;
    renderInbox(inboxData);
    host.scrollTop = host.scrollHeight;
    inbox.querySelector("[data-thread-back]").focus();
  });
  async function openInbox() {
    if (!inbox.open) inbox.showModal();
    host.textContent = "Загружаю обращения…";
    try {
      const data = await fetchInbox();
      if (!inbox.open) return;
      renderInbox(data);
      send("support-notification", { ids: replyIds(data), seen: true });
    } catch {
      if (!inbox.open) return;
      host.innerHTML = '<div class="inbox-empty"><p>Не удалось загрузить обращения.</p><button class="action outline" type="button" data-inbox-retry>Повторить</button></div>';
      host.querySelector("[data-inbox-retry]").addEventListener("click", openInbox);
    }
  }
  let lastInboxCheck = 0;
  async function checkReplies() {
    if (!visible() || !Cortex.state.preferences.notifyReplies || Date.now() - lastInboxCheck < 45_000) return;
    lastInboxCheck = Date.now();
    try {
      const data = await fetchInbox();
      if (inbox.open) renderInbox(data);
      send("support-notification", { ids: replyIds(data), seen: inbox.open });
    } catch { /* Retry at the next interval. */ }
  }
  function refresh() {
    if (!visible()) return;
    void check();
    void heartbeat();
    void checkReplies();
  }
  function visibilityChanged() {
    const nowVisible = visible();
    if (!nowVisible && wasVisible) hiddenAt = Date.now();
    if (nowVisible && !wasVisible && Date.now() - hiddenAt >= 45_000) {
      session = crypto.randomUUID();
      lastHeartbeat = 0;
    }
    wasVisible = nowVisible;
    refresh();
  }
  document.addEventListener("visibilitychange", visibilityChanged);
  window.addEventListener("cortex-app-visibility", visibilityChanged);
  window.addEventListener("cortex-account-changed", () => {
    inboxRequest?.controller.abort();
    inboxRequest = null;
    if (inbox.open) inbox.close();
    host.textContent = "";
    lastInboxCheck = 0;
    // Separate presence sessions when switching between guest and account.
    session = crypto.randomUUID();
    lastHeartbeat = 0;
    refresh();
  });
  setTimeout(refresh, 1100);
  setInterval(refresh, 45_000);

  return { refresh, openInbox, back() { if (!inbox.open) return false; if (!closeThread()) inbox.close(); return true; } };
})();
