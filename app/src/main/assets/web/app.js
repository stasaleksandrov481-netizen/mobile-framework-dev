"use strict";

(() => {
  const M = Cortex, U = CortexUI, Api = CortexApi, S = M.state, Wave = CortexWave;
  const Markdown = CortexMarkdown, Motion = CortexMotion, Planner = CortexPlanner;
  const { esc, icon, button, iconButton } = U;
  const app = document.querySelector("#app");
  const screen = document.querySelector("#screen");
  const ambient = document.querySelector("#ambient");
  const composition = document.querySelector("#composition");
  const nav = document.querySelector("#navigation");
  const sheet = document.querySelector("#sheet");
  const drawer = document.querySelector("#history");
  const splash = document.querySelector("#splash");
  const toast = document.querySelector("#toast");
  const jumpLatest = document.querySelector("#jump-latest");
  const device = window.CortexDevice;
  const systemMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const routes = new Set([...U.tabs.map(([name]) => name), ...Object.keys(U.parent)]);
  const publicRoutes = new Set(["account", "about", "privacy"]);
  const drafts = new Map(), errors = new Map(), actionReplies = new Map();
  const supportStore = () => "cortex.support.chat.v1:" + (S.account?.id || "guest");
  const loadSupport = () => {
    try {
      const items = JSON.parse(localStorage.getItem(supportStore()) || "[]");
      return Array.isArray(items) ? items.filter(item => ["user", "assistant"].includes(item?.role) &&
        typeof item.text === "string" && item.text.length <= 3000).slice(-30) : [];
    } catch { return []; }
  };
  const supportThread = loadSupport();
  let supportPending = false, supportEpoch = 0;
  const filters = { search: "" };
  const connection = { email: false, emailRegistration: false, profiles: false, checked: false, visualPrivacy: false,
    status: Api.available ? "loading" : "preview" };
  let wakeState = "", islandCamera = "drop", androidVersionCode = 0;
  let phoneInfo = {};
  let deviceSnapshot = null;
  let androidCompatibility = null;
  const permissions = { microphone: false, camera: false, notifications: false, notificationAccess: false, overlay: false, screenLock: false, screenLockSupported: false, brightness: false, verifyApps: false, screenAutomation: false, assistant: false, assistantSupported: false };
  let route = "home", chatId = "";
  let accountMode = "password", accountEmail = "";
  let pending, voice, activeSheet, pageMotion, composerMotion, headingMotion, clearMorph, screenContext, drawerExit, sheetExit, inlineToast, toastTimer;
  let connectionLoad, subscriptionLoad;
  let emailResendUntil = 0, emailResendTimer = 0;
  let subscriptionEpoch = 0;
  let keyboardBaseline = 0, keyboardObserved = false, historySearchTimer = 0;
  let statusEpoch = 0, splashFrame = 0, splashTimer = 0, splashPrevious = null;

  document.body.classList.toggle("web-preview", !Api.android);
  composition.innerHTML = U.composer();
  const form = composition.firstElementChild;
  const input = form.querySelector("#composer-input");
  const send = form.querySelector(".send-button");
  const quotaRing = form.querySelector(".quota-ring");
  const voiceButton = form.querySelector(".voice-button");
  const stop = form.querySelector(".stop-button");
  const voicePanel = form.querySelector("#voice-inline");
  const voiceControl = voicePanel.querySelector(".voice-control");
  const voiceText = voicePanel.querySelector("[data-voice-text]");
  const screenPanel = form.querySelector("#screen-context");
  const attachScreen = screenPanel.querySelector(".attach-screen");
  nav.innerHTML = U.navigation();
  const reduced = () => S.preferences.reduceMotion || systemMotion.matches;
  const current = () => M.chat(chatId);
  const draftKey = () => route === "chat" ? chatId : "home";
  const waveMode = () => ["listening", "hearing"].includes(voice?.phase) ? "voice" :
    pending && pending.chatId === chatId ? "thinking" : document.activeElement === input ? "focus" : "idle";
  const language = () => S.preferences.language === "en-US" ? "en-US" : "ru-RU";

  function appearance() {
    document.documentElement.dataset.quality = S.preferences.quality;
    document.documentElement.classList.toggle("reduce-motion", reduced());
  }

  function sendDevice(operation, data = {}) {
    const control = window.CortexIslandControl;
    const extended = new Set(["overlay-permission", "microphone-permission",
      "overlay-config", "wake-config", "island-options", "island-style-ack"]);
    if (operation === "permissions" && control) {
      try { control.postMessage(JSON.stringify({ operation })); } catch {}
    }
    // Never fall back to the legacy device bridge for native island operations.
    // It cannot handle them, and postMessage() succeeding is not action success.
    if (extended.has(operation) && !control) return false;
    const receiver = extended.has(operation) ? control : device;
    if (!receiver) return false;
    try { receiver.postMessage(JSON.stringify({ operation, ...data })); return true; }
    catch { return false; }
  }

  function syncIslandOptions() {
    return sendDevice("island-options", { profile: S.preferences.model, modelId: S.preferences.aiModel, phoneActions: S.preferences.phoneActions,
      visualAutomation: S.preferences.visualAutomation, visualLaunch: S.preferences.visualLaunch,
      reduceMotion: reduced(), haptics: S.preferences.haptics, energy: S.preferences.energy, voiceReplies: S.preferences.voiceReplies,
      addressName: S.preferences.addressName, appearance: Planner.style() });
  }

  function islandCommand(text) {
    const control = window.CortexIslandCommands?.parse(text, Planner.style(), S.preferences.overlayMode);
    if (!control) return null;
    if (!window.CortexIslandControl) return "Управлять островком можно только в Android-приложении CORTEX.";
    const previous = S.islandStyle, previousMode = S.preferences.overlayMode;
    S.islandStyle = control.style;
    if (control.mode) S.preferences.overlayMode = control.mode;
    if (!syncIslandOptions()) {
      S.islandStyle = previous;
      S.preferences.overlayMode = previousMode;
      return "Не удалось передать настройку островка в Android.";
    }
    if (control.mode) {
      if (control.mode === "off") {
        S.preferences.hotwordEnabled = false;
        sendDevice("wake-config", { enabled: false });
      }
      sendDevice("overlay-config", { mode: control.mode, hideLandscape: S.preferences.hideLandscape, resume: true });
    }
    saved();
    return control.reply;
  }

  function wakeCommand(text) {
    const match = /^(?:кортекс[, ]*)?(включи|выключи) (?:фоновое )?(?:голосовое обращение|активацию по имени|вызов по имени|реакцию на слово кортекс)[.!?]*$/iu.exec(text.trim());
    if (!match) return null;
    if (!window.CortexIslandControl) return "Голосовая активация доступна только в Android-приложении.";
    const enabled = match[1].toLowerCase() === "включи";
    if (enabled && !permissions.microphone) return "Сначала разрешите микрофон в настройках Android.";
    if (enabled && !permissions.overlay) return "Сначала разрешите отображение поверх приложений.";
    const old = S.preferences.hotwordEnabled;
    S.preferences.hotwordEnabled = enabled;
    if (!sendDevice("wake-config", { enabled })) {
      S.preferences.hotwordEnabled = old;
      return "Не удалось изменить голосовую активацию.";
    }
    if (enabled && S.preferences.overlayMode === "off") {
      S.preferences.overlayMode = "wake";
      sendDevice("overlay-config", { mode: "wake", hideLandscape: S.preferences.hideLandscape, resume: true });
    }
    saved(); syncIslandOptions();
    return enabled ? "Голосовая активация включена." : "Голосовая активация выключена.";
  }

  function applyEnergy(mode) {
    if (!Object.hasOwn(Planner.powers, mode)) return;
    const p = S.preferences;
    p.energy = mode;
    p.overlayMode = { economy: "off", balanced: "wake", maximum: "always" }[mode];
    if (mode === "economy") p.hotwordEnabled = false;
    if (mode === "maximum") p.hotwordEnabled = permissions.microphone && permissions.overlay;
    saved();
    syncIslandOptions();
    sendDevice("overlay-config", { mode: p.overlayMode, hideLandscape: p.hideLandscape, resume: true });
    sendDevice("wake-config", { enabled: p.hotwordEnabled });
    if (mode === "maximum" && !p.hotwordEnabled) flash("В разделе «Вызов» выдайте доступы к островку и микрофону, затем включите обращение «Кортекс».");
    render();
  }

  // First-run choices must configure the native island as well as the WebView.
  // Changing local preferences alone left the selected background mode disabled.
  app.addEventListener("cortex-onboarding-energy", event => applyEnergy(event.detail?.mode));
  app.addEventListener("cortex-onboarding-style", syncIslandOptions);

  function haptic() {
    if (S.preferences.haptics) sendDevice("tap");
  }

  function flash(message) {
    if (!String(message || "").trim()) return;
    clearTimeout(toastTimer);
    inlineToast?.remove();
    const dialog = sheet.open ? sheet : drawer.open ? drawer : null;
    if (dialog) {
      toast.hidden = true;
      inlineToast = document.createElement("p");
      inlineToast.className = "inline-toast";
      inlineToast.setAttribute("role", "status");
      inlineToast.textContent = message;
      dialog.firstElementChild.after(inlineToast);
      toastTimer = setTimeout(() => inlineToast?.remove(), 3200);
      return;
    }
    toast.textContent = message;
    toast.hidden = false;
    toastTimer = setTimeout(() => { toast.hidden = true; }, 3200);
  }

  function saved(message) {
    if (M.save()) {
      if (message) flash(message);
      return true;
    }
    flash("На устройстве закончилось место. Изменения доступны в этой сессии.");
    return false;
  }

  function rootTab(page, id = chatId) {
    if (page === "chat") return M.chat(id)?.saved ? "chats" : "home";
    while (U.parent[page] && !U.tabs.some(([name]) => name === page)) page = U.parent[page];
    return page;
  }

  function renderNav() {
    const tab = rootTab(route);
    nav.style.setProperty("--nav-index", U.tabs.findIndex(([name]) => name === tab));
    nav.dataset.center = String(tab === "home");
    for (const control of nav.querySelectorAll("[data-tab]")) {
      if (control.dataset.tab === tab) control.setAttribute("aria-current", "page");
      else control.removeAttribute("aria-current");
    }
  }

  function mountWave() {
    if (!splash.hidden || app.classList.contains("in-onboarding")) { Wave.stop(); return; }
    const main = route === "home" || route === "chat";
    const host = main ? ambient : screen.querySelector("[data-wave-host]");
    if (!host) { Wave.stop(); return; }
    const kind = host === ambient ? route : host.dataset.waveHost || "splash";
    Wave.mount(host, {
      kind, quality: S.preferences.quality, still: reduced(), mode: waveMode(),
      populated: route === "chat" && Boolean(current()?.messages.length)
    });
  }

  // A contextual shortcut that appears only if the reader intentionally scrolled away
  // from the latest message. No permanent extra controls in the chat header.
  function updateJumpLatest() {
    const scroll = route === "chat" ? screen.querySelector(".conversation") : null;
    const distance = scroll ? scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop : 0;
    jumpLatest.hidden = !scroll || distance < 170 || app.classList.contains("in-onboarding");
  }

  jumpLatest.addEventListener("click", () => {
    const scroll = screen.querySelector(".conversation");
    if (!scroll) return;
    const remaining = scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop;
    // A very long smooth scroll can take seconds and feel broken: jump instantly.
    scroll.scrollTo({ top: scroll.scrollHeight, behavior: reduced() || remaining > 1600 ? "instant" : "smooth" });
    jumpLatest.hidden = true;
    haptic();
  });
  // Capture-phase listener survives replacing screen.innerHTML on each render.
  screen.addEventListener("scroll", event => {
    if (event.target.classList?.contains("conversation")) updateJumpLatest();
  }, true);

  function render({ bottom = false, messageEnter = false } = {}) {
    if (!S.account && !publicRoutes.has(route)) {
      route = "account";
      history.replaceState(null, "", "#account");
    }
    const before = screen.querySelector(".scroll");
    const previousTop = before?.scrollTop || 0;
    const previousRoute = screen.dataset.route;
    const previousChat = screen.dataset.chat;
    const same = previousRoute === route && (route !== "chat" || previousChat === chatId);
    app.dataset.route = route;
    document.body.classList.toggle("account-route", route === "account");
    app.dataset.chatContent = route === "chat" && (current()?.messages.length || errors.has(chatId)) ? "filled" : "empty";
    screen.dataset.route = route;
    screen.dataset.chat = route === "chat" ? chatId : "";
    screen.className = "screen " + route + "-screen";
    screen.innerHTML = Planner.routes.has(route) ? Planner.page(route) : U.page(route, {
      connection, permissions, compatibility: androidCompatibility, wakeState, islandCamera,
      native: Boolean(device), chat: current(), messageEnter,
      pending: route === "chat" && pending?.chatId === chatId ? pending : null,
      error: route === "chat" ? errors.get(chatId) : null,
      accountMode, email: accountEmail,
      resendWait: Math.max(0, Math.ceil((emailResendUntil - Date.now()) / 1000))
    });
    if (route === "support") {
      paintSupport();
      if (previousRoute !== "support") void refreshSupportReplies();
    }
    updateCodeCells();
    renderNav();
    nav.hidden = route === "account" || !S.account;
    composition.hidden = route !== "home" && route !== "chat";
    if (!composition.hidden) {
      const draft = drafts.get(draftKey()) || "";
      if (input.value !== draft) input.value = draft;
      input.placeholder = route === "home" ? "Напишите Кортексу…" : "Сообщение";
    }
    syncComposer();
    const scroll = screen.querySelector(".scroll");
    if (scroll && (bottom || same)) scroll.scrollTop = bottom ? scroll.scrollHeight : previousTop;
    updateJumpLatest();
    mountWave();
  }

  function localRect(rect) {
    const root = app.getBoundingClientRect();
    return { x: rect.left - root.left, y: rect.top - root.top, w: rect.width, h: rect.height };
  }

  function clearVisuals() {
    pageMotion?.cancel();
    composerMotion?.cancel();
    headingMotion?.cancel();
    clearMorph?.();
    clearMorph = null;
  }

  const box = node => node ? localRect(node.getBoundingClientRect()) : null;
  const permissionsPage = () => ["phone-tools", "permissions", "notifications"].includes(route);

  function moveComposer(from, to, cinematic) {
    if (!from || !to || !to.w || !to.h) return;
    const x = from.x - to.x, y = from.y - to.y;
    if (Math.abs(x) + Math.abs(y) < 1 && Math.abs(from.h - to.h) < 1) return;
    composerMotion = form.animate([
      { transform: `translate(${x}px,${y}px) scale(${from.w / to.w},${from.h / to.h})` },
      ...(cinematic ? [{ transform: `translate(${x * .23}px,${y * .23}px) scale(1.014,.92)`, offset: .55 }] : []),
      { transform: "none" }
    ], { duration: cinematic ? 320 : 190, easing: "cubic-bezier(.21,.8,.18,1)" });
  }

  function navigate(next, { id, replace = false, origin, newChat = false, messageEnter = false, cinematic = false, animate = true } = {}) {
    if (!routes.has(next)) return;
    if (!S.account && !publicRoutes.has(next)) next = "account";
    const previous = route;
    const previousId = chatId;
    if (next === "chat") id = id && M.chat(id) ? id : current()?.id || M.createChat().id;
    if (previous === next && (next !== "chat" || id === chatId)) return;
    closeVoice();
    closeSheet();
    closeHistory(true);
    clearVisuals();
    const before = !composition.hidden ? box(form) : null;
    const tabDirection = U.tabs.findIndex(([key]) => key === rootTab(next, id)) >=
      U.tabs.findIndex(([key]) => key === rootTab(previous)) ? 1 : -1;
    const title = box(screen.querySelector(".hero-copy h1"));
    if (next !== "chat" && document.activeElement === input) input.blur();
    if (next !== "chat") app.classList.remove("composer-active");
    const animated = animate && !reduced() && typeof screen.animate === "function";
    const intoChat = next === "chat" && previous === "home";
    const intoHome = next === "home";
    const switchesTab = rootTab(previous) !== rootTab(next, id);
    route = next;
    if (next === "chat") chatId = id;
    if (previous === "chat" && (next !== "chat" || chatId !== previousId)) discardTemporary(previousId);
    const hash = "#" + next + (next === "chat" ? "/" + encodeURIComponent(chatId) : "");
    history[replace ? "replaceState" : "pushState"](null, "", hash);
    render({ bottom: next === "chat", messageEnter });
    if (animated) {
      const after = !composition.hidden ? box(form) : null;
      if (intoChat || intoHome || cinematic) moveComposer(before, after, cinematic || intoChat);
      const heading = screen.querySelector(".chat-empty h1");
      const to = box(heading);
      if (intoChat && title && to) {
        const x = title.x + title.w / 2 - to.x - to.w / 2, y = title.y - to.y;
        headingMotion = heading.animate([
          { transform: `translate(${x}px,${y}px) scale(${title.w / to.w})` }, { transform: "none" }
        ], { duration: 460, easing: "cubic-bezier(.22,.74,.21,1)" });
      }
      pageMotion = cinematic ? Motion.revealChat(screen) : Motion.page(screen, tabDirection, switchesTab);
      // No full-screen curtain for ordinary navigation.
      if (switchesTab && !cinematic) Motion.dock(nav.querySelector("[aria-current=page]"));
      if (newChat && origin) {
        const point = box(origin);
        Wave.pulse(point.x + point.w / 2, point.y + point.h / 2);
      }
    }
    if (permissionsPage()) sendDevice("permissions");
    Planner.enter(route);
    if (route === "subscription") void refreshSubscription();
  }

  function readRoute() {
    const previous = route;
    const previousId = chatId;
    closeVoice();
    clearVisuals();
    const [name, id] = location.hash.slice(1).split("/");
    const resolved = { appearance: "motion", connection: "settings", voice: "phone-tools" }[name] || name;
    route = routes.has(resolved) ? resolved : "home";
    if (!S.account && !publicRoutes.has(route)) route = "account";
    if (route !== "chat" && document.activeElement === input) input.blur();
    if (route !== "chat") app.classList.remove("composer-active");
    if (route === "chat") {
      let decoded;
      try { decoded = decodeURIComponent(id || ""); } catch {}
      chatId = M.chat(decoded)?.id || current()?.id || M.createChat().id;
    }
    if (previous === "chat" && (route !== "chat" || chatId !== previousId)) discardTemporary(previousId);
    render({ bottom: route === "chat" });
    if (previous !== route && !reduced() && splash.hidden && typeof screen.animate === "function") {
      const switchesTab = rootTab(previous) !== rootTab(route);
      pageMotion = Motion.page(screen, -1, switchesTab);
      if (switchesTab) Motion.dock(nav.querySelector("[aria-current=page]"));
    }
    if (permissionsPage()) sendDevice("permissions");
    Planner.enter(route);
    if (route === "subscription") void refreshSubscription();
  }

  function back() {
    if (window.CortexFirstExperience?.back()) return true;
    if (window.CortexControl?.back()) return true;
    if (app.classList.contains("in-onboarding")) {
      window.CortexSetup?.back();
      return true;
    }
    if (sheet.open) { dismissSheet(); return true; }
    if (drawer.open) { closeHistory(); return true; }
    if (voice) { closeVoice(); return true; }
    if (route === "account" && !S.account) return false;
    if (route === "home") return false;
    navigate(route === "chat" && current()?.saved ? "chats" : U.parent[route] || "home", { replace: true });
    return true;
  }
  window.cortexBack = back;
  addEventListener("popstate", () => { closeSheet(); closeHistory(true); readRoute(); });

  function syncComposer() {
    const quota = connection.quota;
    if (quotaRing) {
      const known = quota?.unit === "tokens" && (quota.unlimited || Number(quota.limit) > 0);
      quotaRing.hidden = !known;
      if (known) {
        const fraction = quota.unlimited ? 1 : Math.max(0, Math.min(1, Number(quota.remaining) / Number(quota.limit)));
        quotaRing.style.setProperty("--quota-fraction", `${Math.round(fraction * 100)}%`);
        const label = quota.unlimited ? "Токены без лимита" : `Осталось ${Math.max(0, Number(quota.remaining) || 0).toLocaleString("ru-RU")} из ${Number(quota.limit).toLocaleString("ru-RU")} токенов`;
        quotaRing.setAttribute("aria-label", label + ". Подробнее");
        quotaRing.title = label;
      }
    }
    if (composition.hidden) return;
    const filled = Boolean(input.value.trim());
    const working = route === "chat" && pending?.chatId === chatId;
    const scroll = screen.querySelector(".conversation");
    const stick = pinned(scroll);
    if (!CSS.supports("field-sizing", "content")) {
      input.style.height = "43px";
      input.style.height = Math.max(43, Math.min(126, input.scrollHeight + 1)) + "px";
    }
    form.classList.toggle("has-text", filled);
    form.classList.toggle("working", working);
    send.disabled = !filled || working;
    send.hidden = !filled || working;
    voiceButton.hidden = !device || filled || working || Boolean(voice);
    stop.hidden = !working || Boolean(voice);
    app.style.setProperty("--composer-h", form.offsetHeight + "px");
    if (scroll && stick) scroll.scrollTop = scroll.scrollHeight;
    updateJumpLatest();
  }

  app.addEventListener("error", event => {
    const image = event.target;
    if (image instanceof HTMLImageElement && image.classList.contains("ai-provider-icon") &&
        image.nextElementSibling?.classList.contains("ai-provider-initials")) {
      image.hidden = true;
      image.nextElementSibling.hidden = false;
    }
  }, true);

  function rememberSupport(role, text, id = "") {
    supportThread.push({ role, text: String(text).slice(0, 3000), ...(id && { id }) });
    if (supportThread.length > 30) supportThread.splice(0, supportThread.length - 30);
    try { localStorage.setItem(supportStore(), JSON.stringify(supportThread)); }
    catch { /* The support chat remains usable in memory. */ }
  }

  function paintSupport() {
    const host = screen.querySelector("#support-messages");
    if (!host) return;
    host.replaceChildren();
    const entries = supportThread.length ? supportThread : [
      { role: "assistant", text: "Напишите, что случилось. Я помогу разобраться." },
    ];
    for (const entry of entries) {
      const bubble = document.createElement("div");
      bubble.className = "support-message " + (entry.role === "user" ? "support-user" : "support-assistant");
      bubble.textContent = entry.text;
      host.append(bubble);
    }
    if (supportPending) {
      const indicator = document.createElement("div");
      indicator.className = "support-message support-assistant";
      indicator.textContent = "Печатает…";
      host.append(indicator);
    }
    host.scrollTop = host.scrollHeight;
    const submit = screen.querySelector("#support-compose button");
    if (submit) submit.disabled = supportPending;
  }

  async function refreshSupportReplies() {
    if (!Api.available) return;
    const epoch = supportEpoch;
    try {
      const data = await Api.request("support-inbox");
      if (epoch !== supportEpoch) return;
      const known = new Set(supportThread.map(item => item.id).filter(Boolean));
      const replies = Array.isArray(data.replies) ? data.replies : [];
      for (const reply of replies.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))) {
        if (typeof reply.id !== "string" || typeof reply.message !== "string" || known.has(reply.id)) continue;
        known.add(reply.id);
        rememberSupport("assistant", reply.message, reply.id);
      }
      if (route === "support") paintSupport();
    } catch { /* Keep local messages if the support server is unavailable. */ }
  }

  async function sendSupport(message) {
    if (supportPending || !message?.trim()) return;
    const epoch = supportEpoch;
    const text = message.trim().slice(0, 2000);
    const operator = /^(?:оператор|сотрудник|человек|поддержка человека)$/iu.test(text);
    rememberSupport("user", text);
    supportPending = true;
    paintSupport();
    try {
      if (operator) {
        const previous = supportThread.slice(0, -1).filter(entry => entry.role === "user").slice(-2)
          .map(entry => entry.text).join("\n");
        const result = await Api.request("support", { payload: { id: crypto.randomUUID(),
          kind: "contact", text: (previous || "Нужна помощь специалиста.").slice(0, 4000),
          email: "", diagnostics: false, app_version: "", screenshot: "" } });
        if (!result.sent) throw Api.failure("support_delivery");
        if (supportEpoch !== epoch) return;
        rememberSupport("assistant", "Обращение передано специалисту. Ответ появится здесь после обработки.");
      } else {
        const turns = supportThread.slice(-7).map(entry => ({ role: entry.role, content: entry.text }));
        // The dedicated support model is free for the user and has separate abuse limits.
        const result = await Api.request("support-ai", { payload: { messages: turns } });
        if (supportEpoch !== epoch) return;
        if (typeof result.text !== "string" || !result.text.trim()) throw Api.failure("empty");
        rememberSupport("assistant", result.text);
      }
    } catch (error) {
      if (supportEpoch === epoch) rememberSupport("assistant", error.message + " Если нужен специалист, напишите «оператор».");
    } finally {
      if (supportEpoch === epoch) {
        supportPending = false;
        if (route === "support") paintSupport();
      }
    }
  }

  function historyItems() {
    if (drawer.open) drawer.querySelector("#history-items").innerHTML = U.chatItems(filters);
  }

  function placeDialogs() {
    const r = app.getBoundingClientRect();
    const styles = {
      "--dialog-x": r.left + "px", "--dialog-y": r.top + "px", "--dialog-w": r.width + "px",
      "--dialog-h": r.height + "px", "--dialog-right": Math.max(0, innerWidth - r.right) + "px",
      "--dialog-bottom": Math.max(0, innerHeight - r.bottom) + "px"
    };
    for (const dialog of [sheet, drawer]) {
      for (const [key, value] of Object.entries(styles)) dialog.style.setProperty(key, value);
    }
  }
  addEventListener("resize", placeDialogs);

  function openHistory() {
    closeVoice();
    if (drawerExit) {
      drawerExit.cancel();
      drawerExit = null;
    }
    if (drawer.open) return;
    placeDialogs();
    drawer.innerHTML = U.history(filters);
    drawer.showModal();
  }
  function closeHistory(immediate = false) {
    if (!drawer.open) return;
    if (immediate || reduced() || !drawer.animate) {
      drawerExit?.cancel();
      drawerExit = null;
      drawer.close();
      return;
    }
    if (drawerExit) return;
    const exit = drawer.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateX(30px)" }],
      { duration: Wave.duration(160), easing: "ease-in", fill: "forwards" });
    drawerExit = exit;
    exit.finished.then(() => {
      if (drawerExit === exit) {
        drawer.close();
        drawerExit = null;
      }
      exit.cancel();
    }, () => {});
  }
  drawer.addEventListener("cancel", event => { event.preventDefault(); closeHistory(); });

  function showSheet(title, body, options = {}) {
    closeVoice();
    closeSheet();
    placeDialogs();
    activeSheet = options;
    sheet.classList.toggle("visual-beta-sheet", options.visualBeta === true);
    sheet.innerHTML = `<header class="sheet-head"><h2 id="sheet-title">${esc(title)}</h2>${iconButton("close", "Закрыть", "close")}</header>${body}`;
    sheet.showModal();
  }
  function closeSheet() {
    if (!sheet.open) return;
    sheetExit?.cancel();
    sheetExit = null;
    const cleanup = activeSheet?.cleanup;
    activeSheet = null;
    sheet.close();
    sheet.classList.remove("visual-beta-sheet");
    sheet.replaceChildren();
    cleanup?.();
  }

  function dismissSheet() {
    if (!sheet.open || sheetExit) return;
    if (reduced() || !sheet.animate) { closeSheet(); return; }
    const exit = sheet.animate([
      { opacity: 1, transform: "translateX(-50%)" },
      { opacity: 0, transform: "translate(-50%, 19px)" }
    ], { duration: Wave.duration(160), easing: "ease-in", fill: "forwards" });
    sheetExit = exit;
    exit.finished.then(() => { if (sheetExit === exit) closeSheet(); }, () => {});
  }
  sheet.addEventListener("cancel", event => { event.preventDefault(); dismissSheet(); });

  for (const dialog of [drawer, sheet]) dialog.addEventListener("click", event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) {
      if (dialog === sheet) dismissSheet(); else closeHistory();
    }
  });

  function field(name, title, value = "", { max = 90, rows = 0, optional = false, type = "text" } = {}) {
    const required = optional ? "" : " required";
    return `<label class="field"><span>${esc(title)}</span>${rows ?
      `<textarea name="${name}" rows="${rows}" maxlength="${max}"${required}>${esc(value)}</textarea>` :
      `<input type="${type}" name="${name}" value="${esc(value)}" maxlength="${max}"${required}
        ${type === "url" ? 'inputmode="url" autocapitalize="none" spellcheck="false"' : ""}>`}</label>`;
  }

  function editor(title, fields, submit, { label = "Сохранить", extra = "" } = {}) {
    showSheet(title, `<form id="editor" class="stack">${fields}<p class="form-error" role="alert" hidden></p>
      <div class="actions"><button type="submit" class="action primary">${icon("check", 17)}${esc(label)}</button>${extra}</div></form>`, { submit });
  }
  function confirm(title, description, run) {
    showSheet(title, `<div class="stack"><p class="muted">${esc(description)}</p><div class="actions">
      ${button("Отмена", "", "close")}${button("Подтвердить", "check", "confirm", "", "danger")}</div></div>`, { confirm: run });
  }

  function showSplash() {
    if (!splash.hidden && splash.classList.contains("playing") && !splash.classList.contains("leaving")) return;
    cancelAnimationFrame(splashFrame);
    clearTimeout(splashTimer);
    closeVoice();
    closeSheet();
    closeHistory(true);
    splash.hidden = false;
    splash.className = "splash";
    splashPrevious = null;
    screen.inert = nav.inert = composition.inert = true;
    // The CSS splash is self-contained; WebGL startup here causes first-frame stutter.
    Wave.stop();
    let visible = 0;
    function play(now) {
      if (document.hidden || window.cortexAppVisible === false) splashPrevious = null;
      else {
        if (splashPrevious === null) splash.classList.add("playing");
        else visible += now - splashPrevious;
        splashPrevious = now;
      }
      if (visible < (reduced() ? 650 : 1650)) {
        splashFrame = requestAnimationFrame(play);
        return;
      }
      // Place onboarding underneath the splash BEFORE fading it out.
      // Otherwise the home screen flashes for one frame.
      if (S.account) window.CortexSetup?.autoStart();
      splash.classList.add("leaving");
      screen.inert = nav.inert = composition.inert = app.classList.contains("in-onboarding");
      splashTimer = setTimeout(() => {
        splash.hidden = true;
        if (!app.classList.contains("in-onboarding")) mountWave();
      }, reduced() ? 0 : 395);
    }
    splashFrame = requestAnimationFrame(() => {
      splashFrame = requestAnimationFrame(play);
    });
  }

  function setAccount(value) {
    const previousId = S.account?.id;
    const account = M.account(value);
    const changed = previousId !== account?.id;
    if (changed && pending) stopAnswer(false);
    if (changed) {
      closeVoice();
      sendDevice("voice-stop");
      if (!account) sendDevice("action-stop");
    }
    M.useAccount(account);
    if (changed) {
      if (account) {
        sendDevice("overlay-config", { mode: S.preferences.overlayMode,
          hideLandscape: S.preferences.hideLandscape, resume: true });
        sendDevice("wake-config", { enabled: S.preferences.hotwordEnabled, restore: true });
      } else {
        sendDevice("wake-config", { enabled: false });
        sendDevice("overlay-config", { mode: "off" });
      }
      supportEpoch++;
      supportPending = false;
      supportThread.splice(0, supportThread.length, ...loadSupport());
      connection.quota = null;
      connection.subscription = null;
      connection.subscriptionError = "";
      subscriptionEpoch++;
      drafts.clear();
      errors.clear();
      screenContext = null;
      refreshScreen();
      Planner.accountChanged();
      if (route === "chat") navigate("profile", { replace: true });
      dispatchEvent(new Event("cortex-account-changed"));
    }
    saved();
  }

  async function refreshConnection() {
    if (!Api.available) return;
    const epoch = ++statusEpoch;
    try {
      const data = await Api.request("status");
      if (epoch !== statusEpoch) return;
      if (data.fault) throw Api.failure(data.fault);
      connection.checked = true;
      connection.status = "ready";
      connection.emailRegistration = data.email_auth === true;
      connection.email = data.email_login === true || connection.emailRegistration;
      connection.profiles = data.device_profiles === true;
      const restoredSession = !S.account && Boolean(data.account);
      setAccount(data.account);
      connection.quota = data.quota || null;
      if (restoredSession && route === "account") {
        navigate("home", { replace: true, animate: false });
        window.CortexSetup?.autoStart();
      } else if (!S.account && !publicRoutes.has(route)) navigate("account", { replace: true });
      syncComposer();
    } catch {
      if (epoch !== statusEpoch) return;
      connection.status = "offline";
    }
    if (["profile", "models"].includes(route)) render();
    if (route === "account") {
      const status = screen.querySelector("[data-auth-status]");
      if (status) {
        status.textContent = U.accountAvailability(connection, accountMode);
        status.hidden = !status.textContent;
      }
    }
  }

  async function refreshSubscription() {
    const epoch = ++subscriptionEpoch;
    const account = S.account?.id;
    connection.subscriptionError = "";
    subscriptionLoad = Api.request("subscription");
    try {
      const data = await subscriptionLoad;
      if (epoch !== subscriptionEpoch || account !== S.account?.id) return;
      connection.subscription = data;
      connection.quota = data.quota || connection.quota;
    } catch (error) {
      if (epoch !== subscriptionEpoch || account !== S.account?.id) return;
      connection.subscriptionError = error.message;
    } finally {
      if (epoch === subscriptionEpoch) {
        subscriptionLoad = null;
        if (route === "subscription" && account === S.account?.id) render();
      }
    }
  }

  let paymentInProgress = false;
  async function subscriptionAction(operation, value) {
    if (paymentInProgress) return;
    if (!S.account) { navigate("account"); return; }
    paymentInProgress = true;
    const account = S.account.id;
    try {
      const payload = operation === "status" ? { operation, id: value } : { operation, plan: value };
      const result = await Api.request("subscription-payment", { payload });
      if (account !== S.account?.id) return;
      if (result.checkout_url) {
        const url = Markdown.webUrl(result.checkout_url);
        if (!url || !sendDevice("open-link", { url })) flash("Не удалось открыть страницу оплаты.");
      } else if (operation === "status") {
        flash(result.state === "confirmed" ? "Оплата подтверждена." : "Статус платежа обновлён.");
      }
      if (route === "subscription") await refreshSubscription();
    } catch (error) {
      if (account === S.account?.id) flash(error.message);
    } finally {
      paymentInProgress = false;
    }
  }

  addEventListener("cortex-quota", event => {
    const quota = event.detail;
    if (!S.account || quota?.id !== S.account.id) return;
    connection.quota = quota;
    syncComposer();
    if (["profile", "models", "subscription"].includes(route)) render();
  });

  function accountOptions() {
    emailForm("password");
  }

  function updateCodeCells() {
    const field = screen.querySelector("[data-account-code]");
    const input = field?.querySelector(".account-code-input");
    if (!input) return;
    const digits = U.codeDigits(input.value);
    if (input.value !== digits) input.value = digits;
    const active = Math.min(digits.length, 5);
    field.dataset.complete = String(digits.length === 6);
    field.querySelectorAll("[data-code-cell]").forEach((cell, index) => {
      cell.textContent = digits[index] || "";
      cell.dataset.active = String(index === active && digits.length < 6);
    });
  }

  function updateResendButton() {
    const button = screen.querySelector("[data-resend-button]");
    const seconds = Math.max(0, Math.ceil((emailResendUntil - Date.now()) / 1000));
    if (button) {
      button.disabled = seconds > 0;
      button.textContent = seconds ? `Повторить через ${seconds} с` : "Отправить код ещё раз";
    }
    if (!seconds && emailResendTimer) { clearInterval(emailResendTimer); emailResendTimer = 0; }
  }

  function emailResendCooldown() {
    emailResendUntil = Date.now() + 60_000;
    if (emailResendTimer) clearInterval(emailResendTimer);
    emailResendTimer = setInterval(updateResendButton, 1000);
    updateResendButton();
  }

  async function resendCode() {
    if (!["verify", "reset"].includes(accountMode) || Date.now() < emailResendUntil) return;
    const mode = accountMode;
    const field = screen.querySelector("#account-form");
    const email = field?.querySelector('[name="email"]')?.value?.trim().toLowerCase() || "";
    const button = field?.querySelector("[data-resend-button]");
    if (!button || !email) { flash("Укажите электронную почту."); return; }
    button.disabled = true;
    try {
      await Api.request("auth-resend", { payload: { email, kind: mode === "reset" ? "recovery" : "signup" } });
      if (!field.isConnected || accountMode !== mode) return;
      field.querySelector('[name="code"]').value = "";
      updateCodeCells();
      emailResendCooldown();
      flash("Новый код отправлен, проверьте почту.");
    } catch (error) {
      if (field.isConnected && accountMode === mode) {
        flash(error.message);
        updateResendButton();
      }
    }
  }

  function emailForm(mode, email = "") {
    if (!Object.hasOwn(U.accountModes, mode)) return;
    if (route === "account" && screen.querySelector("#account-form")?.getAttribute("aria-busy") === "true") return;
    if (route === "account" && accountMode === mode) return;
    accountMode = mode;
    accountEmail = email;
    if (mode !== "verify" && mode !== "reset") {
      emailResendUntil = 0;
      if (emailResendTimer) { clearInterval(emailResendTimer); emailResendTimer = 0; }
    }
    if (route === "account") render();
    else navigate("account");
    if (!connection.checked && connection.status !== "loading") refreshConnection();
  }

  async function submitAccount(form, values) {
    const mode = form.dataset.mode;
    const email = values.email?.trim().toLowerCase() || "";
    const error = form.querySelector(".form-error");
    const submit = form.querySelector("[type=submit]");
    if (submit.disabled) return;
    error.hidden = true;
    submit.disabled = true;
    form.setAttribute("aria-busy", "true");
    const label = submit.firstElementChild;
    const previousLabel = label.textContent;
    label.textContent = "Подождите…";
    try {
      if (mode === "signup" || mode === "reset") {
        if (values.password !== values.confirmation) {
          form.querySelector('[name="confirmation"]')?.setAttribute("aria-invalid", "true");
          throw new Error("Пароли не совпадают.");
        }
        if (new TextEncoder().encode(values.password).length > 72) throw Api.failure("invalid_password");
      }
      if (!Api.available) throw Api.failure(Api.android ? "webview" : "preview");
      const available = () => mode === "password" ? connection.email : connection.emailRegistration;
      if (!available() || connection.status === "offline") await refreshConnection();
      if (!form.isConnected) return;
      if (connection.status === "offline") throw Api.failure("offline");
      if (!available()) throw new Error(U.accountAvailability(connection, mode));
      const result = await Api.request("auth-" + mode, { payload: {
        name: values.name, email, password: values.password, code: values.code
      } });
      form.removeAttribute("aria-busy");
      if (result.state === "signed_in" && M.account(result.account)) {
        ++statusEpoch;
        setAccount(result.account);
        if (route === "account") navigate("profile", { replace: true });
        refreshConnection();
        window.CortexControl?.refresh();
        window.CortexSetup?.autoStart();
        flash("Вход выполнен");
      } else if (result.state === "check_email" && form.isConnected) {
        emailResendCooldown();
        emailForm(mode === "signup" ? "verify" : "reset", email);
      } else if (result.state === "password_changed" && form.isConnected) {
        setAccount(null);
        emailForm("password", email);
        flash("Пароль изменён");
      } else throw new Error("Не удалось завершить вход. Попробуйте ещё раз.");
    } catch (failure) {
      if (form.isConnected) {
        if (failure.code === "auth_unconfirmed" && mode === "password") {
          form.removeAttribute("aria-busy");
          emailForm("verify", email);
          flash("Подтвердите почту. Если код не пришёл, запросите новый.");
        } else {
          const fieldName = failure.code === "invalid_email" ? "email"
            : failure.code === "invalid_code" || (failure.code === "auth_credentials" && mode !== "password") ? "code"
            : ["invalid_password", "auth_credentials"].includes(failure.code) ? "password" : "";
          const invalid = fieldName ? form.querySelector(`[name="${fieldName}"]`) : null;
          invalid?.setAttribute("aria-invalid", "true");
          // Let the user overwrite a rejected code immediately instead of erasing it digit by digit.
          if (fieldName === "code") invalid?.select?.();
          error.textContent = fieldName === "code" && failure.code === "auth_credentials"
            ? "Код не подошёл или устарел. Введите код из последнего письма или запросите новый."
            : failure.message || "Что-то пошло не так. Попробуйте ещё раз.";
          error.hidden = false;
        }
      }
    } finally {
      submit.disabled = false;
      label.textContent = previousLabel;
      form.removeAttribute("aria-busy");
    }
  }

  window.cortexAdminLogin = accountOptions;

  function logout() {
    confirm("Выйти из аккаунта?", "Локальные чаты останутся на этом устройстве.", async () => {
      if (pending) stopAnswer(false);
      ++statusEpoch;
      try {
        await Api.request("logout");
        setAccount(null);
        window.CortexControl?.refresh();
        render();
        flash("Вы вышли из аккаунта");
      } catch (error) { flash(error.message); }
    });
  }

  function pinned(scroll) {
    return !scroll || scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop < 82;
  }

  function drawDelta(job) {
    if (job !== pending || !job.text.trim() || !appVisible()) return;
    const node = route === "chat" && chatId === job.chatId ? screen.querySelector("[data-stream]") : null;
    if (!node) return;
    const guarded = M.guardReply(job.text);
    const speaking = job.voice;
    if (speaking && voice === speaking && !job.screen && S.preferences.voiceReplies) {
      if (guarded !== job.text && !speaking.deferSpeech) {
        stopVoiceOutput(speaking);
        speaking.deferSpeech = true;
        voiceStatus("thinking", "Думаю…");
      } else if (!speaking.lead && !speaking.deferSpeech) {
        primeVoice(speaking, M.voiceLead(job.text));
      }
    }
    const scroll = screen.querySelector(".conversation");
    const stick = pinned(scroll);
    node.closest(".message").classList.add("has-reply");
    node.innerHTML = Markdown.renderStream(guarded);
    if (!job.streamPainted && !reduced()) Motion.reply(node);
    job.streamPainted = true;
    if (stick) scroll.scrollTop = scroll.scrollHeight;
    updateJumpLatest();
  }

  function nativeAction(job, text) {
    if (!device || job.explain || job.screen) return Promise.resolve(null);
    const id = M.id("action");
    job.nativeRunning = true;
    return new Promise(resolve => {
      const done = value => {
        clearTimeout(timer);
        actionReplies.delete(id);
        job.controller.signal.removeEventListener("abort", cancel);
        job.nativeRunning = false;
        resolve(value);
      };
      const cancel = () => {
        sendDevice("action-stop");
        done(null);
      };
      const timer = setTimeout(() => {
        sendDevice("action-stop");
        done({ text: "Время задачи истекло. Проверьте последний шаг на экране.", local: true, external: !appVisible(), resumable: true });
      }, 740000);
      actionReplies.set(id, value => {
        if (value.phase === "progress") {
          if (pending !== job) return;
          job.action = value.text;
          if (voice && job.voice === voice) voiceStatus("opening", value.text);
          if (activeChat(job) && appVisible()) render({ bottom: true });
        } else if (value.phase === "result") {
          done({ text: value.text, local: true, external: value.external === true || !appVisible(),
            resumable: value.resumable === true, ephemeral: value.ephemeral === true,
            clarificationId: typeof value.clarificationId === "string" ? value.clarificationId : "" });
        } else done(null);
      });
      job.controller.signal.addEventListener("abort", cancel, { once: true });
      if (!sendDevice("action-start", { id, text, profile: S.preferences.model, force: job.force,
        allowPhone: S.preferences.phoneActions, source: job.chatId, clarificationId: job.clarificationId })) done(null);
    });
  }

  const activeChat = job => route === "chat" && chatId === job.chatId;
  const clock = new Intl.DateTimeFormat("ru-RU", { dateStyle: "full", timeStyle: "short" });

  async function respond(chat, job) {
    const request = chat.messages.at(-1)?.text || "";
    const native = await nativeAction(job, request);
    if (native || pending !== job) return native || {};
    // A plain chat completion receives no Android action result.
    const deviceRequest = /^(?:(?:кортекс|пожалуйста|можешь|давай)[,\s]+)*(?:отправь|перешли|передай|опубликуй|выложи|закажи|нажми|открой|пройди|напиши\s+@)/iu.test(request);
    if (deviceRequest && !job.explain && !job.screen) return { local: true,
      text: "Уточните приложение и действие. Пока ни одного шага Android не подтверждено." };
    if (Api.android && navigator.onLine === false) throw Api.failure("offline");
    const screenPolicy = job.screen ? " Пользователь приложил текст экрана как данные: " + JSON.stringify(job.screen) : "";
    const deviceContext = {
      ...phoneInfo, surface: "chat", foreground: appVisible() ? "CORTEX" : "unknown",
      version: U.version, version_code: androidVersionCode || undefined,
      screen_control: Boolean(device && S.preferences.visualAutomation && permissions.screenAutomation),
      microphone: Boolean(device && permissions.microphone), island: Boolean(device && permissions.overlay),
      ...(/телефон|устройств|интернет|сеть|памят|заряд|батаре|уведомлен|wifi|wi-fi/iu.test(request) &&
        deviceSnapshot ? { state: deviceSnapshot } : {})
    };
    const policy = "Встроенный движок Android уже проверил этот запрос на локальные действия. " +
      "Если задача требует уточнения, спроси, что именно нужно сделать и в каком приложении. " +
      "Опирайся на доступы и реальные результаты Android. " +
      "Контекст устройства: " + JSON.stringify(deviceContext) + ". Дата: " + clock.format(new Date()) + "." + screenPolicy;
    const sharedQuestion = !job.screen && M.canSharePublicQuestion(chat, request);
    const result = await Api.request("chat", {
      payload: { messages: sharedQuestion ? [{ role: "user", content: request }] : M.turns(chat, policy),
        style: M.profile().style, web_search: !sharedQuestion,
        ...((connection.profiles || !connection.checked) && { profile: S.preferences.model }),
        ...(S.preferences.aiModel !== "auto" && { model_id: S.preferences.aiModel }) },
      notify: S.preferences.notifyReplies
    }, {
      signal: job.controller.signal,
      onStatus(status) {
        if (pending !== job) return;
        if (status === "text_ready") {
          const spoken = job.voice;
          if (!deviceRequest && !job.screen && spoken && voice === spoken && !spoken.lead &&
              !spoken.deferSpeech && appVisible() && S.preferences.voiceReplies && M.guardReply(job.text) === job.text) {
            primeVoice(spoken, job.text.trim().slice(0, 550));
          }
          return;
        }
        job.action = status === "web_search" ? "Ищу информацию в интернете…"
          : status === "web_ready" ? "Проверяю, нужны ли свежие данные…" : "Пробую резервную модель…";
        if (status === "web_ready") job.webEnabled = true;
        if (status === "web_search") job.webSearching = true;
        if (activeChat(job)) render({ bottom: true });
      },
      onDelta(delta) {
        if (pending !== job || deviceRequest) return;
        job.action = "";
        job.text += delta;
        if (!job.streamPainted && job.text.trim() && appVisible() && activeChat(job)) { drawDelta(job); return; }
        const cadence = job.text.length > 12000 ? 140 : job.text.length > 3500 ? 70 : 28;
        if (!job.renderTimer && !job.renderFrame) job.renderTimer = setTimeout(() => {
          job.renderTimer = 0;
          job.renderFrame = requestAnimationFrame(() => { job.renderFrame = 0; drawDelta(job); });
        }, cadence);
      }
    });
    job.action = "";
    const response = typeof result.text === "string" ? result.text : "";
    const claim = /(?<![\p{L}\p{N}_])(?:отправил|переслал|отправлено|доставлен[аоы]?|выложил|опубликовал|опубликовано|купил|заказал|прошёл)(?![\p{L}\p{N}_])/iu;
    return { text: deviceRequest && claim.test(response)
      ? "Android пока не подтвердил действие." : response };
  }

  async function answer(chat, text, { retry = false, from, voiceTurn, explain = false, includeScreen = true, force = false } = {}) {
    if (!chat || !text || pending) return;
    if (voiceTurn && voice === voiceTurn) voiceStatus("thinking", "Думаю…");
    const question = chat.messages.at(-1)?.clarification;
    if (!retry) {
      if (!chat.messages.length) chat.title = text.replace(/\s+/g, " ").slice(0, 72);
      chat.messages.push({ role: "user", text });
      drafts.delete(chat.id);
    }
    const attachment = includeScreen && !question && screenContext?.attached ? { app: screenContext.app, text: screenContext.text } : null;
    if (attachment) { screenContext = null; refreshScreen(); }
    errors.delete(chat.id);
    M.touch(chat);
    if (chat.saved) saved();
    const clarificationId = !retry && !explain ? question?.id : undefined;
    const job = { chatId: chat.id, text: "", completed: false, renderTimer: 0, controller: new AbortController(),
      voice: voiceTurn, explain, force, screen: attachment, clarificationId };
    pending = job;
    if (from) navigate("chat", { id: chat.id, origin: from, messageEnter: true });
    else if (activeChat(job)) render({ bottom: true, messageEnter: !retry });
    historyItems();
    try {
      const localReply = retry || clarificationId ? null : wakeCommand(text) ?? islandCommand(text) ?? M.memoryCommand(text);
      const outcome = localReply === null ? await respond(chat, job) : { text: localReply, local: true };
      if (pending !== job) return;
      if (!outcome.text?.trim()) throw Api.failure("empty");
      if (outcome.local) chat.messages.at(-1).local = true;
      if (outcome.ephemeral) chat.messages.at(-1).ephemeral = true;
      if (!outcome.local) outcome.text = M.guardReply(outcome.text);
      const message = { role: "assistant", text: outcome.text, ...(job.webSearching && { webSearch: true }), ...(outcome.local && { local: true }),
        ...(outcome.ephemeral && { ephemeral: true }), ...(outcome.resumable && !outcome.clarificationId && { resumable: true }) };
      if (outcome.clarificationId) {
        message.clarification = { id: outcome.clarificationId };
        setTimeout(() => {
          if (message.clarification?.id !== outcome.clarificationId) return;
          delete message.clarification;
          if (activeChat(job)) render();
        }, 180000);
      }
      chat.messages.push(message);
      job.completed = true;
      M.touch(chat);
      const memorized = localReply === null && !outcome.local && M.learnFromUser(text);
      if (chat.saved || localReply !== null || memorized) saved();
      if (voiceTurn && voice === voiceTurn) {
        if (outcome.external) closeVoice();
        else voiceReplyReady(voiceTurn, outcome.text);
      }
    } catch (error) {
      if (pending !== job) return;
      errors.set(chat.id, Object.assign(error, { explain }));
      if (error.code === "sign_in" && S.account) setAccount(null);
      if (voiceTurn && voice === voiceTurn) {
        stopVoiceOutput(voiceTurn);
        voiceStatus("error", error.message);
      }
    } finally {
      if (pending === job) {
        pending = null;
        clearTimeout(job.renderTimer);
        cancelAnimationFrame(job.renderFrame);
        if (activeChat(job)) render({ bottom: pinned(screen.querySelector(".conversation")), messageEnter: job.completed && !job.streamPainted });
        else if (route === "home") Wave.state(waveMode());
        historyItems();
      }
    }
  }

  function stopAnswer(keep = true) {
    if (!pending) return;
    const job = pending;
    pending = null;
    job.controller.abort();
    clearTimeout(job.renderTimer);
    cancelAnimationFrame(job.renderFrame);
    if (job.voice && voice === job.voice) {
      stopVoiceOutput(job.voice);
      voiceStatus("waiting", "Готов слушать");
    }
    const chat = M.chat(job.chatId);
    if (!chat || !keep) return;
    if (job.text.trim()) {
      chat.messages.push({ role: "assistant", text: M.guardReply(job.text.trim()) });
      M.touch(chat);
      if (chat.saved) saved();
    } else errors.set(chat.id, Object.assign(new Error("Действие остановлено."), { explain: job.explain }));
    render();
    historyItems();
  }

  function newChat(control) {
    const item = M.createChat(true);
    saved();
    navigate("chat", { id: item.id, origin: control, newChat: true });
    haptic();
  }

  function homeChat() {
    const chat = M.createChat();
    if (drafts.get("home")) drafts.set(chat.id, drafts.get("home"));
    drafts.delete("home");
    return chat;
  }

  function discardTemporary(id) {
    if (M.chat(id)?.saved !== false) return;
    if (pending?.chatId === id) stopAnswer(false);
    S.chats = S.chats.filter(chat => chat.id !== id);
    drafts.delete(id);
    errors.delete(id);
    sendDevice("conversation-clear", { source: id });
  }

  function submitMessage(text, control) {
    if (!text) return;
    if (!S.account) { navigate("account"); return; }
    if (pending) { flash("Сначала дождитесь текущего ответа."); return; }
    const home = route === "home";
    const chat = home ? homeChat() : current();
    if (!chat) return;
    closeVoice();
    haptic();
    void answer(chat, text, { from: home ? control : null });
  }

  function rateAnswer(index, rating) {
    const chat = current();
    const message = chat?.messages[Number(index)];
    if (message?.role !== "assistant" || !["up", "down"].includes(rating)) return;
    message.feedback = message.feedback === rating ? undefined : rating;
    if (chat.saved) saved();
    render();
    flash(message.feedback === "down" ? "Учту оценку в следующих ответах." :
      message.feedback === "up" ? "Буду придерживаться этого стиля." : "Оценка снята.");
  }

  function regenerate(index) {
    const chat = current(), position = Number(index);
    if (!chat || pending || chat.messages[position]?.role !== "assistant") return;
    const previous = chat.messages.slice(0, position).reverse().find(item => item.role === "user");
    if (!previous) return;
    if (position === chat.messages.length - 1) {
      chat.messages.pop();
      if (chat.saved) saved();
      void answer(chat, previous.text, { retry: true });
    } else void answer(chat, "Ответь заново на мой предыдущий вопрос: " + previous.text.slice(0, 2800) +
      ". Учти контекст беседы, не дублируй предыдущий ответ.");
  }

  function submitExample(text, control, explain = false) {
    if (pending) { flash("Сначала дождитесь текущего ответа."); return; }
    const here = route === "chat" && !current()?.messages.length;
    const chat = here ? current() : M.createChat();
    if (!chat) return;
    haptic();
    void answer(chat, text, { from: here ? null : control, explain, includeScreen: false });
  }

  function chatMenu(id) {
    const chat = M.chat(id);
    if (!chat) return;
    showSheet(chat.title, `<div class="stack">
      ${button(chat.pinned ? "Открепить чат" : "Закрепить чат", "pin", "pin-chat", id, "primary")}
      ${button("Переименовать", "note", "rename-chat", id)}
      ${button("Удалить чат", "trash", "delete-chat", id, "danger")}</div>`);
  }

  function pinChat(id) {
    const chat = M.chat(id);
    if (!chat?.saved) return;
    chat.pinned = !chat.pinned;
    closeSheet();
    if (!saved(chat.pinned ? "Чат закреплён" : "Чат откреплён")) chat.pinned = !chat.pinned;
    render();
    historyItems();
  }

  function deleteChats(test, message) {
    const before = S.chats;
    S.chats = before.filter(chat => !test(chat));
    if (!saved(message)) { S.chats = before; return; }
    if (pending && !M.chat(pending.chatId)) stopAnswer(false);
    for (const chat of before) if (!M.chat(chat.id)) { drafts.delete(chat.id); errors.delete(chat.id); }
    if (!current()) {
      chatId = route === "chat" ? M.createChat().id : "";
      if (route === "chat") history.replaceState(null, "", "#chat/" + encodeURIComponent(chatId));
    }
    render();
    historyItems();
  }

  function memoryEditor(id) {
    const memory = M.memory();
    const entry = memory.entries.find(item => item.id === id);
    editor(entry ? "Запись памяти" : "Запомнить факт",
      field("title", "Название", entry?.title || "", { max: 65 }) +
      field("value", "Что запомнить", entry?.value || "", { rows: 3, max: 600 }),
      values => {
        if (entry) Object.assign(entry, values);
        else memory.entries.unshift({ id: M.id("fact"), enabled: true, ...values });
        closeSheet(); saved("Факт сохранён"); render();
      }, { extra: entry ? button("Удалить", "trash", "memory-delete", entry.id, "danger") : "" });
  }

  function exportChats() {
    const chats = S.chats.filter(chat => chat.saved && chat.messages.some(message => !message.ephemeral))
      .map(chat => ({ ...chat, messages: chat.messages.filter(message => !message.ephemeral) }));
    if (!chats.length) { flash("Сохранённых чатов пока нет."); return; }
    const text = JSON.stringify({ cortex: U.version, exported: new Date().toISOString(), chats }, null, 2);
    if (device) {
      if (text.length > 1_850_000) { flash("История слишком велика для одного файла."); return; }
      if (!sendDevice("export", { text })) flash("Не удалось открыть сохранение файла.");
      return;
    }
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "cortex-chats.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 2500);
  }

  function support(kind) {
    const titles = { contact: "Написать разработчику", bug: "Сообщить об ошибке", idea: "Предложить функцию", complaint: "Отправить жалобу" };
    if (!Object.hasOwn(titles, kind)) return;
    const draft = { screenshot: "", id: crypto.randomUUID() };
    editor(titles[kind], field("text", "Сообщение", "", { rows: 4, max: 4000 }) +
      (S.account ? "" : field("email", "Email для ответа (необязательно)", "", { type: "email", max: 254, optional: true })) +
      `<label class="check-row"><input name="diagnostics" type="checkbox"><span>Приложить версию приложения</span></label>
      <div class="attachment">
        ${button("Приложить скриншот", "image", "choose-image")}<span data-attachment class="muted"></span>
        <button type="button" class="action quiet" data-action="remove-image" hidden>Убрать</button>
      </div>`, async ({ text, email, diagnostics }) => {
        const result = await Api.request("support", { payload: {
          id: draft.id, kind, text, email: email || "", diagnostics: Boolean(diagnostics),
          app_version: diagnostics ? U.version : "", screenshot: draft.screenshot
        } });
        if (!result.sent) throw Api.failure("support_delivery");
        if (activeSheet?.support !== draft) { flash("Обращение отправлено"); return; }
        showSheet("Обращение отправлено", `<div class="support-success"><span class="success-check">${icon("check", 26)}</span>
          ${result.reference ? `<p>Номер обращения ${esc(result.reference)}</p>` : ""}${button("Готово", "", "close", "", "primary")}</div>`);
      }, { label: "Отправить" });
    activeSheet.support = draft;
  }

  function attachment(data) {
    if (!activeSheet?.support) return;
    activeSheet.support.screenshot = data;
    sheet.querySelector("[data-attachment]").textContent = data ? "Скриншот прикреплён" : "";
    sheet.querySelector('[data-action="remove-image"]').hidden = !data;
  }

  function appVisible() {
    return !document.hidden && window.cortexAppVisible !== false;
  }

  function refreshScreen() {
    screenPanel.hidden = !screenContext;
    screenPanel.querySelector("[data-screen-title]").textContent = screenContext ?
      (screenContext.attached ? "Приложен текст · " : "Текст экрана · ") + (screenContext.app || "Android") : "";
    screenPanel.querySelector("[data-screen-preview]").textContent = screenContext?.text || "";
    attachScreen.setAttribute("aria-pressed", String(Boolean(screenContext?.attached)));
    syncComposer();
  }

  function acceptScreen(context) {
    if (typeof context?.text !== "string" || !context.text.trim()) {
      flash("Android не передал текст этого экрана.");
      return;
    }
    screenContext = { text: context.text.slice(0, 2600), app: String(context.app || "").slice(0, 90), attached: false };
    if (route !== "chat" && route !== "home") navigate("home");
    screenPanel.querySelector("details").open = false;
    refreshScreen();
  }

  function transcript(text) {
    voiceText.textContent = text || "";
    voiceText.hidden = !voiceText.textContent;
  }

  function voiceStatus(phase, text) {
    if (!voice) return;
    voice.phase = phase;
    voicePanel.dataset.voicePhase = phase;
    Wave.state(waveMode());
    voicePanel.querySelector("[data-voice-status]").textContent = text;
    const labels = { starting: "Включаю микрофон", listening: "Завершить запись", hearing: "Завершить запись",
      recognizing: "Распознаю речь", thinking: "Перебить", opening: "Выполняю действие", preparing: "Перебить", speaking: "Перебить",
      waiting: "Говорить", error: "Повторить" };
    voiceControl.innerHTML = icon(["waiting", "error", "starting"].includes(phase) ? "mic" : "stop", 17);
    voiceControl.setAttribute("aria-label", labels[phase]);
    voiceControl.title = labels[phase];
    voiceControl.disabled = ["starting", "recognizing"].includes(phase);
    if (!["listening", "hearing"].includes(phase)) voicePanel.style.setProperty("--voice-level", "0");
    syncComposer();
  }

  function closeVoice() {
    if (!voice) return;
    const job = voice;
    voice = null;
    stopVoiceOutput(job);
    if (job.recognition) sendDevice("voice-cancel", { id: job.recognition });
    voicePanel.hidden = true;
    delete voicePanel.dataset.voicePhase;
    Wave.state(waveMode());
    transcript("");
    syncComposer();
  }

  function listen(job) {
    if (voice !== job) return;
    if (!appVisible()) { voiceStatus("waiting", "Разговор приостановлен"); return; }
    stopVoiceOutput(job);
    job.deferSpeech = false;
    job.recognition = M.id("voice");
    transcript("");
    voiceStatus("starting", "Включаю микрофон…");
    if (!sendDevice("voice-start", { id: job.recognition, language: language(), dictation: job.dictation })) {
      job.recognition = null;
      voiceStatus("error", "Не удалось запустить микрофон.");
    } else {
      job.timer = setTimeout(() => {
        if (voice !== job || job.phase !== "starting") return;
        sendDevice("voice-cancel", { id: job.recognition });
        job.recognition = null;
        voiceStatus("error", "Не удалось подключить микрофон.");
      }, 10000);
    }
  }

  function startVoice(dictation, control) {
    if (!S.account) { navigate("account"); return; }
    if (!device || pending) return;
    closeVoice();
    const selection = [input.selectionStart, input.selectionEnd];
    input.blur();
    if (route === "home") navigate("chat", { id: homeChat().id, origin: control });
    voice = { dictation, key: draftKey(), chatId, selection, phase: "starting", timer: 0 };
    voicePanel.hidden = false;
    haptic();
    listen(voice);
  }

  function recognizing(job) {
    if (job.phase === "recognizing") return;
    voiceStatus("recognizing", "Распознаю речь…");
    clearTimeout(job.timer);
    job.timer = setTimeout(() => {
      if (voice !== job || !job.recognition) return;
      sendDevice("voice-cancel", { id: job.recognition });
      job.recognition = null;
      voiceStatus("error", "Распознавание заняло слишком много времени.");
    }, 12000);
  }

  function useVoice() {
    const job = voice;
    if (!job) return;
    if (["listening", "hearing"].includes(job.phase)) {
      recognizing(job);
      sendDevice("voice-finish", { id: job.recognition });
    } else if (["thinking", "opening", "preparing", "speaking"].includes(job.phase)) {
      if (pending?.voice === job) stopAnswer();
      stopVoiceOutput(job);
      voiceStatus("waiting", "Готовлю микрофон…");
      job.timer = setTimeout(() => listen(job), 180);
    } else if (job.phase === "waiting" || job.phase === "error") listen(job);
  }

  function stopVoiceOutput(job) {
    clearTimeout(job.timer);
    const id = job.speechId;
    job.speechId = null;
    job.lead = "";
    job.leadOk = false;
    job.finalSpeech = null;
    if (id) sendDevice("voice-stop", { id });
  }

  function startVoiceSegment(job, text) {
    clearTimeout(job.timer);
    const id = M.id("speech");
    job.speechId = id;
    if (!sendDevice("voice-speak", { id, text })) { job.speechId = null; return false; }
    voiceStatus("preparing", "Готовлю голос…");
    job.timer = setTimeout(() => {
      if (voice !== job || job.speechId !== id) return;
      sendDevice("voice-stop", { id });
      voiceSegmentDone(job, false);
    }, 44000);
    return true;
  }

  function primeVoice(job, text) {
    if (text && startVoiceSegment(job, text)) job.lead = text;
  }

  function voiceReplyReady(job, answer) {
    if (!S.preferences.voiceReplies) { voiceSpoken(job, false); return; }
    const text = answer.trim().slice(0, 550);
    if (job.lead) {
      if (!text.startsWith(job.lead)) { voiceSpoken(job, false); return; }
      job.finalSpeech = text.slice(job.lead.length).trim();
      if (!job.speechId) voiceSegmentDone(job, job.leadOk);
    } else if (!startVoiceSegment(job, text)) voiceSpoken(job, false);
  }

  function voiceSegmentDone(job, ok) {
    clearTimeout(job.timer);
    job.speechId = null;
    if (job.lead) {
      if (job.finalSpeech == null) {
        job.leadOk = ok;
        voiceStatus("thinking", "Думаю…");
        return;
      }
      const rest = job.finalSpeech;
      job.lead = "";
      job.finalSpeech = null;
      if (ok && rest && S.preferences.voiceReplies && startVoiceSegment(job, rest)) return;
    }
    voiceSpoken(job, ok);
  }

  function voiceSpoken(job, ok) {
    stopVoiceOutput(job);
    voiceStatus("waiting", ok ? "Готов слушать" : "Ответ в чате");
    if (S.preferences.voiceContinue && appVisible()) job.timer = setTimeout(() => listen(job), 220);
  }

  function finishDictation(job, text) {
    const previous = drafts.get(job.key) || "";
    const [start, end] = job.selection;
    const left = previous.slice(0, start), right = previous.slice(end);
    const prefix = left && !/\s$/u.test(left) ? " " : "";
    const suffix = right && !/^[\s.,!?;:)]/u.test(right) ? " " : "";
    const value = (left + prefix + text + suffix + right).slice(0, 6000);
    const caret = Math.min(value.length, left.length + prefix.length + text.length);
    drafts.set(job.key, value);
    closeVoice();
    input.value = value;
    input.setSelectionRange(caret, caret);
    syncComposer();
  }

  function recognitionEvent(job, message) {
    switch (message.phase) {
      case "ready": clearTimeout(job.timer); voiceStatus("listening", "Слушаю…"); break;
      case "hearing": clearTimeout(job.timer); voiceStatus("hearing", "Слышу вас"); break;
      case "level":
        if (job.phase === "listening" || job.phase === "hearing") {
          const level = Math.max(0, Math.min(1, Number(message.level) || 0));
          voicePanel.style.setProperty("--voice-level", String(level));
          Wave.state("voice", level);
        }
        break;
      case "partial": transcript(message.text); break;
      case "finishing": recognizing(job); break;
      case "error":
        clearTimeout(job.timer);
        job.recognition = null;
        voiceStatus("error", message.text || "Не удалось распознать речь.");
        break;
      case "result": {
        clearTimeout(job.timer);
        job.recognition = null;
        const text = typeof message.text === "string" ? message.text.trim().slice(0, 6000) : "";
        if (!text) { voiceStatus("error", "Речь не распознана. Попробуйте ещё раз."); return; }
        if (job.dictation) { finishDictation(job, text); return; }
        if (/^(?:(?:кортекс|cortex)[ ,]+)?(?:стоп|закончи разговор|закрой голосовой режим|stop)[.!?]*$/iu.test(text)) {
          closeVoice();
          return;
        }
        const chat = M.chat(job.chatId);
        if (!chat || pending) { voiceStatus("error", "Подождите завершения текущего действия."); return; }
        transcript(text);
        void answer(chat, text, { voiceTurn: job });
        break;
      }
    }
  }

  function deviceEvent(event) {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (Planner.handle(message)) return;
    if (message.type === "voice" && voice?.recognition && message.id === voice.recognition) {
      recognitionEvent(voice, message);
    }
    if (message.type === "voice-output" && message.id?.startsWith("manual-") && message.ok !== true &&
        S.preferences.voiceReplies) flash("Android не смог воспроизвести голос. Проверьте синтез речи и громкость.");
    if (voice?.speechId && message.id === voice.speechId) {
      if (message.type === "voice-output-start") voiceStatus("speaking", "Озвучиваю ответ…");
      if (message.type === "voice-output") {
        voiceSegmentDone(voice, message.ok === true);
        if (!pending && !voice?.speechId) void refreshConnection();
      }
    }
    if (message.type === "wake-command") {
      const text = typeof message.text === "string" ? message.text.trim().slice(0, 2400) : "";
      if (text && !pending && !app.classList.contains("in-onboarding")) {
        const chat = route === "chat" ? current() : M.createChat();
        if (chat) void answer(chat, text, { from: route === "chat" ? null : nav });
      }
    }
    if (message.type === "action") actionReplies.get(message.id)?.(message);
    if (message.type === "action-history") {
      const entries = Array.isArray(message.entries) ? message.entries : [];
      showSheet("Журнал действий", entries.length ? '<ol class="action-log">' +
        entries.map(entry => '<li><time>' + esc(new Date(entry.at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })) +
        '</time><span>' + esc(entry.message) + '</span></li>').join("") + '</ol>' : '<p class="muted">Действий пока нет.</p>');
    }
    if (message.type === "notification-journal-cleared") {
      if (message.ok) flash("Журнал уведомлений очищен.");
    }
    if (message.type === "visual-privacy") {
      connection.visualPrivacy = message.enabled === true;
      if (route === "privacy") render();
    }
    if (message.type === "background") closeVoice();
    if (message.type === "screen-context") acceptScreen(message.context);
    if (message.type === "island-style-sync" && message.appearance && typeof message.appearance === "object" &&
        !Array.isArray(message.appearance)) {
      S.islandStyle = message.appearance;
      S.islandStyle = Planner.style();
      saved();
      sendDevice("island-style-ack");
      if (route === "phone-tools") render();
    }
    if (message.type === "permissions") {
      if (typeof message.versionName === "string") U.setVersion(message.versionName);
      if (Number.isInteger(message.versionCode)) androidVersionCode = message.versionCode;
      if (device && typeof message.phoneModel === "string") phoneInfo = {
        manufacturer: message.manufacturer, model: message.phoneModel, android_version: message.androidRelease
      };
      if (message.deviceSnapshot && typeof message.deviceSnapshot === "object" && !Array.isArray(message.deviceSnapshot)) {
        deviceSnapshot = message.deviceSnapshot;
      }
      if (message.compatibility && typeof message.compatibility === "object" && !Array.isArray(message.compatibility)) {
        androidCompatibility = message.compatibility;
      }
      if (["drop", "punch", "left", "right", "none"].includes(message.islandCamera)) islandCamera = message.islandCamera;
      for (const key of Object.keys(permissions)) if (Object.hasOwn(message,key)) permissions[key] = Boolean(message[key]);
      window.CortexSetup?.updatePermissions(permissions);
      if (permissionsPage()) render();
    }
    if (message.type === "wake-state") {
      wakeState = message.message || "";
      if (route === "phone-tools") render();
    }
    if (message.type === "wake-paused" || message.type === "wake-shutdown") {
      if (S.preferences.hotwordEnabled) {
        S.preferences.hotwordEnabled = false;
        saved();
        if (route === "phone-tools") render();
      }
      if (message.type === "wake-shutdown") {
        closeVoice();
        if (pending && !pending.nativeRunning) {
          stopAnswer(false);
          render();
        }
      }
    }
    if (message.type === "wake-config" && !message.ok) {
      S.preferences.hotwordEnabled = false; saved(); render();
      flash(message.message || "Голосовая активация пока недоступна на этом устройстве.");
    }
    if (message.type === "overlay-mode" && !message.ok) {
      flash(message.message || "Разрешите отображение поверх приложений.");
    }
    if (message.type === "copy") flash(message.ok ? "Скопировано" : "Не удалось скопировать");
    if (message.type === "link" && !message.ok) flash("Не удалось открыть ссылку.");
    if (message.type === "settings" && !message.ok) flash("Не удалось открыть настройки Android.");
    if (message.type === "image" && !message.cancelled) {
      if (message.ok && typeof message.data === "string") attachment(message.data);
      else flash("Не удалось подготовить скриншот.");
    }
    if (message.type === "assistant-permission" && !message.ok) flash("Не удалось открыть выбор помощника Android.");
    if (message.type === "export" && !message.cancelled) flash(message.ok ? "Чаты экспортированы" : "Не удалось сохранить файл");
  }
  if (device) device.onmessage = deviceEvent;
  if (window.CortexIslandControl) window.CortexIslandControl.onmessage = deviceEvent;

  async function copyText(text) {
    if (!text) return;
    if (sendDevice("copy", { text })) return;
    try { await navigator.clipboard.writeText(text); flash("Скопировано"); }
    catch { flash("Браузер ограничил доступ к буферу обмена."); }
  }

  function preference(key, value) {
    S.preferences[key] = value;
    saved();
    appearance();
    if (["model", "aiModel", "phoneActions", "visualAutomation", "visualLaunch", "reduceMotion", "haptics", "voiceReplies"].includes(key)) syncIslandOptions();
    if (key === "voiceReplies" && !value) {
      sendDevice("voice-stop");
      if (voice?.speechId) {
        if (pending?.voice === voice) {
          stopVoiceOutput(voice);
          voice.deferSpeech = true;
          voiceStatus("thinking", "Думаю…");
        } else voiceSpoken(voice, false);
      }
    }
    render();
  }

  function changeVisualBeta(checkbox) {
    if (!checkbox.checked || S.preferences.visualBetaSeen) {
      preference("visualAutomation", checkbox.checked);
      if (!checkbox.checked) sendDevice("action-stop");
      return;
    }
    checkbox.checked = false;
    // A dismissed notice counts as seen; the checkbox only changes on approval.
    S.preferences.visualBetaSeen = true;
    saved();
    showSheet("Визуальное управление · БЕТА", `<div class="visual-beta-content">
      <svg class="visual-beta-face" viewBox="0 0 120 120" aria-hidden="true">
        <rect x="8" y="8" width="104" height="104" rx="35" fill="#f2cf58"/>
        <path d="M39 51v8m42-8v8m-34 19c7-6 19-6 26 0" fill="none" stroke="#252010" stroke-width="5" stroke-linecap="round"/>
        <path d="M58 30h4" stroke="#252010" stroke-width="5" stroke-linecap="round"/>
      </svg>
      <p>Функция экспериментальная. CORTEX может ошибаться при распознавании элементов и действиях на экране.</p>
      <p>Следите за ходом задачи. Остановить её можно в чате или на островке.</p>
      <div class="actions">${button("Включить", "", "confirm", "", "primary")}
        ${button("Закрыть", "", "close", "", "quiet")}</div></div>`,
      { visualBeta: true, confirm: () => preference("visualAutomation", true) });
  }

  function filterFaq() {
    const faq = screen.querySelector("[data-faq]");
    if (!faq) return;
    const query = faq.querySelector("#faq-search").value.trim().toLocaleLowerCase("ru-RU").replaceAll("ё", "е");
    let found = false;
    for (const row of faq.querySelectorAll("[data-faq-category]")) {
      const text = (row.dataset.faqCategory + " " + row.textContent).toLocaleLowerCase("ru-RU").replaceAll("ё", "е");
      row.hidden = !text.includes(query);
      if (!row.hidden) found = true;
    }
    for (const group of faq.querySelectorAll("[data-faq-group]")) {
      group.hidden = !group.querySelector("details:not([hidden])");
    }
    faq.querySelector("[data-faq-empty]").hidden = found;
  }

  const actions = {
    "support-inbox": () => window.CortexControl?.openInbox(),
    tab(value, control) {
      if (value === "home") {
        if (route === "chat" && !current()?.saved) return;
        const switchToCore = rootTab(route) !== "home";
        if (switchToCore) haptic();
        navigate("chat", { id: homeChat().id, origin: control, cinematic: switchToCore, animate: switchToCore });
        return;
      }
      if (route === value) return;
      haptic(); navigate(value, { origin: control });
    },
    go: (value, control) => navigate(value, { origin: control }),
    "subscription-info": page => {
      if (!["privacy", "terms", "support"].includes(page)) return;
      if (!sendDevice("open-link", { url: "https://cortexapp.ru/" + page })) flash("Не удалось открыть ссылку.");
    },
    "subscription-refresh": () => { if (!subscriptionLoad) void refreshSubscription(); },
    "subscription-checkout": value => void subscriptionAction("checkout", value),
    "subscription-renew": value => void subscriptionAction("renew", value),
    "subscription-status": value => void subscriptionAction("status", value),
    back, close: dismissSheet,
    confirm() {
      const run = activeSheet?.confirm;
      closeSheet();
      Promise.resolve().then(() => run?.()).catch(error => flash(error.message));
    },
    "new-chat": (_, control) => newChat(control),
    "clear-temporary": () => confirm("Очистить временный чат?", "Сообщения текущего сеанса будут удалены.", () => {
      navigate("chat", { id: M.createChat().id, replace: true });
    }),
    "address-name": () => editor("Как к вам обращаться", field("name", "Имя или обращение", S.preferences.addressName, { max: 60, optional: true }),
      ({ name }) => { S.preferences.addressName = name.slice(0, 60); saved("Обращение сохранено."); syncIslandOptions(); closeSheet(); render(); }),
    history: openHistory,
    "close-history": closeHistory,
    "open-chat": id => { closeHistory(true); navigate("chat", { id }); },
    "chat-menu": chatMenu,
    "pin-chat": pinChat,
    "rename-chat"(id) {
      const chat = M.chat(id);
      if (!chat) return;
      editor("Название чата", field("title", "Название", chat.title, { max: 72 }), ({ title }) => {
        chat.title = title; saved(); closeSheet(); historyItems();
      });
    },
    "delete-chat": id => confirm("Удалить чат?", "Переписка будет удалена с устройства.", () => deleteChats(chat => chat.id === id, "Чат удалён")),
    "clear-chats": () => confirm("Очистить сохранённые чаты?", "Эти беседы исчезнут из истории и памяти.", () => deleteChats(chat => chat.saved, "Сохранённые чаты удалены")),
    "clear-local": () => confirm("Сбросить локальные данные?", "Чаты, память, журнал уведомлений и настройки будут удалены с устройства.", () => {
      if (!M.clearLocalData()) { flash("Не удалось удалить локальные данные."); return; }
      supportThread.length = 0;
      localStorage.removeItem(supportStore());
      sendDevice("private-data-clear");
      if (pending) stopAnswer(false);
      drafts.clear(); errors.clear();
      chatId = "";
      syncIslandOptions(); appearance(); render(); flash("Локальные данные сброшены");
    }),
    stop: () => stopAnswer(),
    retry() {
      const chat = current(), last = chat?.messages.at(-1);
      if (last?.role === "user") void answer(chat, last.text, { retry: true, explain: errors.get(chat.id)?.explain });
    },
    copy(index) { return copyText(current()?.messages[Number(index)]?.text); },
    "voice-preview"() {
      if (voice) closeVoice();
      if (S.preferences.voiceReplies && !sendDevice("voice-speak", {
        id: "manual-" + M.id("speech"), text: "Привет, я Кортекс. Голосовые ответы включены."
      })) flash("Озвучка доступна в приложении Android.");
    },
    "speak-answer"(index) {
      const answer = current()?.messages[Number(index)];
      if (answer?.role !== "assistant" || answer.ephemeral || !S.preferences.voiceReplies) return;
      if (voice) closeVoice();
      if (!sendDevice("voice-speak", { id: "manual-" + M.id("speech"), text: answer.text.slice(0, 550) })) {
        flash("Озвучка доступна в приложении Android.");
      }
    },
    regenerate,
    "feedback-up": index => rateAnswer(index, "up"),
    "feedback-down": index => rateAnswer(index, "down"),
    "clarification-focus"() { input.focus(); },
    "clarification-dismiss"() {
      const chat = current(), message = chat?.messages.at(-1);
      if (!message?.clarification || pending) return;
      sendDevice("action-clarification-dismiss", { source: chat.id, clarificationId: message.clarification.id });
      delete message.clarification;
      render();
    },
    "refine-answer": index => {
      const message = current()?.messages[Number(index)];
      if (!message || message.role !== "assistant") return;
      drafts.set(draftKey(), "Уточни предыдущий ответ: ");
      input.value = drafts.get(draftKey());
      syncComposer();
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    },
    "quota-detail": () => {
      const quota = connection.quota;
      if (!quota || quota.unit !== "tokens") return flash("Баланс пока недоступен.");
      showSheet("Лимиты ИИ", U.usageSheet(quota));
    },
    "copy-code"(_, control) { return copyText(control.closest(".code-block")?.querySelector("code")?.textContent); },
    dictate: (_, control) => startVoice(true, control),
    "voice-chat": (_, control) => startVoice(false, control),
    "voice-turn": useVoice,
    "voice-close": closeVoice,
    "attach-screen"() {
      if (!screenContext) return;
      screenContext.attached = !screenContext.attached;
      refreshScreen();
    },
    "drop-screen"() { screenContext = null; refreshScreen(); },
    capabilities: (_, control) => submitExample("Что ты умеешь?", control),
    "try-tool": (text, control) => submitExample(text, control),
    "resume-visual"() { const chat = current(); if (chat) return answer(chat, "Продолжи", { force: true }); },
    "visual-privacy"() { sendDevice("visual-privacy", { enabled: !connection.visualPrivacy }); },
    "assistant-permission": () => sendDevice("assistant-permission"),
    "verification-permission": () => window.CortexSetup?.openPermission("screenAutomation"),
    "microphone-permission": () => {
      if (!window.CortexIslandControl) {
        if (sendDevice("open-settings")) flash("Выберите «Разрешения» → «Микрофон» в настройках CORTEX.");
        else flash("Откройте разрешения приложения CORTEX в Android.");
      } else sendDevice("microphone-permission");
    },
    "notification-permission": () => sendDevice("notification-permission"),
    "brightness-permission": () => sendDevice("brightness-permission"),
    "background-permission": () => { if (!sendDevice("background-permission")) flash("Настройка доступна в приложении Android."); },
    "first-experience": () => {
      if (!window.CortexFirstExperience?.open()) flash("Знакомство доступно в Android-приложении CORTEX.");
    },
    "camera-permission": () => sendDevice("camera-permission"),
    "notification-listener-permission": () => sendDevice("notification-listener-permission"),
    "notification-journal-clear": () => confirm("Очистить журнал уведомлений?", "История новых событий будет удалена. Это не удалит уведомления из других приложений.", () => {
      if (!sendDevice("notification-journal-clear")) flash("Очистка доступна только в приложении Android.");
    }),
    "overlay-permission": () => {
      if (!window.CortexIslandControl) flash("Островок доступен только в Android-приложении CORTEX.");
      else if (!sendDevice("overlay-permission")) flash("Не удалось открыть разрешение Android.");
    },
    "open-setup": () => window.CortexSetup?.start(true),
    "surface-mode"(mode) {
      if (!["always", "wake", "off"].includes(mode)) return;
      if (mode === "off" && S.preferences.hotwordEnabled) preference("hotwordEnabled", false);
      preference("overlayMode", mode);
      if (!window.CortexIslandControl) {
        flash(mode === "off" ? "Плавающее окно выключено." : "Выбор сохранён. Островок работает только в Android-приложении.");
      } else if (!sendDevice("overlay-config", { mode, hideLandscape: S.preferences.hideLandscape, resume: true }))
        flash("Не удалось применить режим. Проверьте разрешения Android.");
    },
    "model-profile"(value) { if (Object.hasOwn(M.models, value)) preference("model", value); },
    "ai-model"(value) {
      const selected = M.aiModels.find(item => item.id === value);
      if (!selected) return;
      if (selected.paid && !["start", "pro", "ultra"].includes(connection.quota?.plan || "")) {
        flash("Для этой модели нужна подписка CORTEX.");
        navigate("subscription");
        return;
      }
      preference("aiModel", value);
      if (route === "ai-models") back();
    },
    starter(value) {
      // Starters only fill the composer: phone actions still need the user's own send.
      input.value = String(value || "").slice(0, 300);
      syncComposer();
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    },
    "account-options": accountOptions,
    "email-auth": mode => emailForm(mode, screen.querySelector('#account-form input[name="email"]')?.value || ""),
    "resend-code": resendCode,
    "refresh-connection": refreshConnection,
    "password-visibility": (_, control) => {
      const field = control.parentElement.querySelector("input");
      const show = field.type === "password";
      field.type = show ? "text" : "password";
      control.setAttribute("aria-label", show ? "Скрыть пароль" : "Показать пароль");
      control.setAttribute("aria-pressed", String(show));
    },
    logout,
    export: exportChats,
    "open-settings": () => { if (!sendDevice("open-settings")) flash("Этот экран доступен в Android."); },
    "support-form": support,
    "action-history": () => { if (!sendDevice("action-history")) flash("Журнал доступен в приложении Android."); },
    "choose-image": () => { if (!sendDevice("choose-image")) flash("Выбор скриншота доступен в Android."); },
    "remove-image": () => attachment(""),
    "memory-edit": memoryEditor,
    "memory-delete": id => confirm("Удалить факт?", "CORTEX перестанет использовать эту запись.", () => {
      const memory = M.memory();
      memory.entries = memory.entries.filter(item => item.id !== id);
      saved("Факт удалён"); render();
    }),
    "personality-edit"() {
      const person = M.profile();
      editor("Манера общения", field("tone", "Тон", person.tone, { max: 90 }), values => {
        Object.assign(S.edits.cortex, values); saved("Манера общения сохранена"); closeSheet(); render();
      });
    },
    "reply-style"(value) {
      if (!Object.hasOwn(M.styles, value)) return;
      S.edits.cortex.style = value;
      saved(); render();
    },
    quality(value) { if (Object.hasOwn(M.motion, value)) preference("quality", value); },
    language(value) { if (Object.hasOwn(M.languages, value)) preference("language", value); },
    toggle(key) {
      if (key === "hotwordEnabled" && !window.CortexIslandControl) {
        flash("Активация по слову «Кортекс» недоступна: обновите приложение.");
        return;
      }
      if (key === "memory") { M.memory().enabled = !M.memory().enabled; saved(); render(); return; }
      if (!Object.hasOwn(M.defaults, key) || typeof M.defaults[key] !== "boolean") return;
      preference(key, !S.preferences[key]);
      if (key === "notifyReplies") {
        if (S.preferences[key]) sendDevice("notification-permission");
        sendDevice("support-notify-config", { enabled: S.preferences[key] });
      }
      if (key === "phoneActions" && !S.preferences[key]) sendDevice("action-stop");
      if (key === "hideLandscape") sendDevice("overlay-config", {mode:S.preferences.overlayMode,hideLandscape:S.preferences.hideLandscape});
      if (key === "hotwordEnabled") {
        if (S.preferences.hotwordEnabled && S.preferences.overlayMode === "off" && permissions.overlay) {
          preference("overlayMode", "wake");
          sendDevice("overlay-config", {mode:"wake", hideLandscape:S.preferences.hideLandscape});
        }
        if (!sendDevice("wake-config", {enabled:S.preferences.hotwordEnabled})) {
          preference("hotwordEnabled", false);
          flash("Не удалось запустить голосовую службу Android.");
        }
      }
    }
  };

  document.addEventListener("click", event => {
    const control = event.target.closest?.("button, summary");
    if (control?.matches(".dock-core")) return;
    if (control && !reduced()) Motion.press(control);
  }, { capture: true });

  app.addEventListener("click", event => {
    const link = event.target.closest(".markdown a[href]");
    if (link && device) {
      event.preventDefault();
      const url = Markdown.webUrl(link.getAttribute("href"));
      if (!url || !sendDevice("open-link", { url })) flash("Не удалось открыть ссылку.");
      return;
    }
    const control = event.target.closest("[data-action]");
    if (control && Object.hasOwn(actions, control.dataset.action)) actions[control.dataset.action](control.dataset.value || "", control);
  });

  app.addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.target;
    const data = Object.fromEntries(Array.from(new FormData(form), ([key, value]) =>
      [key, ["password", "confirmation"].includes(key) ? String(value) : String(value).trim()]));
    if (form.id === "account-form") { await submitAccount(form, data); return; }
    if (form.id === "support-compose") {
      const field = form.querySelector("textarea");
      if (!data.message || supportPending) return;
      field.value = "";
      void sendSupport(data.message);
      return;
    }
    if (form.id === "composer") submitMessage(data.message, form.querySelector(".send-button"));
    if (form.id === "editor" && activeSheet?.submit) {
      const error = form.querySelector(".form-error");
      const submit = form.querySelector('[type="submit"]');
      if (submit.disabled) return;
      error.hidden = true;
      if (Array.from(form.querySelectorAll("[required]")).some(input => !input.value.trim())) {
        error.textContent = "Заполните обязательные поля."; error.hidden = false; return;
      }
      submit.disabled = true;
      try { await activeSheet.submit(data); }
      catch (failure) { error.textContent = failure.message; error.hidden = false; }
      finally { submit.disabled = false; }
    }
  });

  Planner.bind({ root: app, route: () => route, native: Boolean(device), open: navigate, send: sendDevice,
    render, confirm, sheet: showSheet, close: closeSheet, toast: flash,
    updateStyle() { saved(); syncIslandOptions(); }, power: applyEnergy });

  app.addEventListener("change", event => {
    if (event.target.matches("[data-visual-beta]")) changeVisualBeta(event.target);
  });

  app.addEventListener("paste", event => {
    const input = event.target;
    if (!input.classList?.contains("account-code-input")) return;
    // maxlength would cut "Код действует 10 минут: 482913" before the code is reached.
    const text = event.clipboardData?.getData("text") || "";
    if (!text) return;
    event.preventDefault();
    input.value = U.codeDigits(text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

  app.addEventListener("input", event => {
    const input = event.target;
    if (input.closest?.("#account-form")) {
      input.removeAttribute("aria-invalid");
      const error = input.form?.querySelector(".form-error");
      if (error) error.hidden = true;
    }
    if (input.classList?.contains("account-code-input")) {
      updateCodeCells();
      // Email confirmation needs only the code: submit once the sixth digit arrives (typing,
      // paste or Android one-time-code autofill). Password reset still needs its password fields.
      const form = input.form;
      if (form?.dataset.mode === "verify" && input.value.length === 6 && form.getAttribute("aria-busy") !== "true" &&
          form.checkValidity()) form.requestSubmit();
    }
    if (input.id === "composer-input") { drafts.set(draftKey(), input.value); syncComposer(); }
    if (input.id === "faq-search") filterFaq();
    if (input.id === "history-search") {
      filters.search = input.value;
      clearTimeout(historySearchTimer);
      historySearchTimer = setTimeout(historyItems, 160);
    }
  });
  function visibleViewportHeight() {
    return Math.round(Math.min(innerHeight, window.visualViewport?.height || innerHeight));
  }
  function updateKeyboardLayout() {
    const height = visibleViewportHeight();
    if (!keyboardBaseline) keyboardBaseline = height;
    if (document.activeElement !== input) {
      // Learn the natural viewport height only while the keyboard is closed.
      if (!keyboardObserved) keyboardBaseline = Math.max(keyboardBaseline, height);
      app.classList.remove("composer-active");
    } else {
      const keyboardOpen = keyboardBaseline - height > 115;
      if (keyboardOpen) keyboardObserved = true;
      // On Android, after observing a real IME resize, restore the dock when
      // the keyboard closes even if the textarea retains focus.
      app.classList.toggle("composer-active", !Api.android || !keyboardObserved || keyboardOpen);
    }
    updateJumpLatest();
  }
  form.addEventListener("focusin", event => {
    if (event.target !== input) return;
    closeVoice();
    if (route === "home") { navigate("chat", { id: homeChat().id, origin: form }); haptic(); }
    updateKeyboardLayout();
    Wave.state(waveMode());
  });
  form.addEventListener("focusout", () => requestAnimationFrame(() => {
    updateKeyboardLayout();
    Wave.state(waveMode());
  }));
  window.visualViewport?.addEventListener("resize", updateKeyboardLayout);
  window.addEventListener("resize", updateKeyboardLayout);
  window.addEventListener("orientationchange", () => {
    keyboardObserved = false;
    keyboardBaseline = 0;
    requestAnimationFrame(updateKeyboardLayout);
  });
  form.addEventListener("keydown", event => {
    // Hardware keyboard: Enter sends and Shift+Enter inserts a line break.
    // On touch phones, Enter should insert a line break; the arrow sends.
    if (event.target === input && event.key === "Enter" && !event.shiftKey &&
        !event.isComposing && event.keyCode !== 229 && !matchMedia("(pointer: coarse)").matches) {
      event.preventDefault();
      if (!pending && event.target.value.trim()) event.target.form.requestSubmit();
    }
  });
  systemMotion.addEventListener("change", () => { clearVisuals(); appearance(); syncIslandOptions(); mountWave(); });
  addEventListener("cortex-onboarding-end", event => {
    if (event.detail?.configured && S.account) {
      syncIslandOptions();
      sendDevice("overlay-config", { mode: S.preferences.overlayMode, hideLandscape: S.preferences.hideLandscape });
      if (S.preferences.hotwordEnabled) sendDevice("wake-config", { enabled: true });
    }
    mountWave();
    updateJumpLatest();
  });
  addEventListener("cortex-first-experience-end", event => {
    if (event.detail?.finished) navigate("home");
    mountWave();
    updateJumpLatest();
  });
  function visibilityChanged() {
    splashPrevious = null;
    const hidden = document.hidden || window.cortexAppVisible === false;
    document.documentElement.classList.toggle("app-background", hidden);
    if (!hidden) {
      // Pick up voice-only island changes made while the WebView was backgrounded.
      syncIslandOptions();
      if (["profile", "models", "account"].includes(route)) refreshConnection();
      if (route === "schedule") Planner.enter(route);
    }
  }
  document.addEventListener("visibilitychange", visibilityChanged);
  addEventListener("cortex-app-visibility", visibilityChanged);

  appearance();
  keyboardBaseline = visibleViewportHeight();
  readRoute();
  screen.inert = nav.inert = composition.inert = true;
  if (Api.android && device && !window.cortexFrameReady) {
    const begin = () => {
      clearTimeout(fallback);
      removeEventListener("cortex-frame-ready", begin);
      showSplash();
    };
    const fallback = setTimeout(begin, 1400);
    addEventListener("cortex-frame-ready", begin, { once: true });
  } else showSplash();
  sendDevice("permissions");
  sendDevice("visual-privacy");
  syncIslandOptions();
  sendDevice("support-notify-config", { enabled: S.preferences.notifyReplies });
  if (S.account && S.preferences.hotwordEnabled && S.preferences.overlayMode !== "off") {
    sendDevice("wake-config", { enabled: true, restore: true });
  } else {
    sendDevice("wake-config", { enabled: false });
    if (!S.account) sendDevice("overlay-config", { mode: "off" });
  }
  sendDevice("screen-context");
  connectionLoad = refreshConnection();
})();
