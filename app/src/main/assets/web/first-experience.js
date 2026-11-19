"use strict";

/** Presentation only. Android owns every action, result, timeout and persistent first-run flag. */
window.CortexFirstExperience = (() => {
  const root = document.getElementById("app");
  const { esc } = CortexUI;
  const phases = new Set(["idle", "offer", "running", "number", "sealed", "reveal", "finish", "stopped"]);
  let view = null, current = null, previousFocus = null, signature = "", pending = null;
  let entered = "", finishing = false, requestPending = false;

  function send(action, data = {}) {
    if (!window.CortexDevice) return false;
    try {
      window.CortexDevice.postMessage(JSON.stringify({ operation: "first-experience-" + action, session: current?.session || "", ...data }));
      return true;
    } catch { return false; }
  }

  const button = (action, text, primary = false, disabled = false) =>
    `<button type="button" class="action ${primary ? "primary" : "quiet"}" data-experience="${action}" ${disabled ? "disabled" : ""}>${text}</button>`;
  const validNumber = value => /^[1-9][0-9]?$/.test(value);

  function permissions(state) {
    return `<div class="experience-permissions">
      ${!state.accessibility ? button("accessibility", "Разрешить управление экраном") : ""}
      ${!state.overlay ? button("overlay", "Разрешить островок") : ""}
      ${!state.brightnessPermission ? `<p>Без доступа к системным настройкам фокус с яркостью будет пропущен.</p>${button("brightness", "Разрешить управление яркостью")}` : ""}
    </div>`;
  }

  function notices(state) {
    const items = Array.isArray(state.notices) ? state.notices.filter(item => typeof item === "string").slice(0, 4) : [];
    return items.length ? `<details class="experience-notices"><summary>Как прошло знакомство</summary>${items.map(item => `<p>${esc(item)}</p>`).join("")}</details>` : "";
  }

  function card(revealed) {
    return `<div class="experience-card ${revealed ? "revealed" : "sealed"}" aria-label="${revealed ? "Прогноз: 5" : "Закрытая карточка прогноза"}">
      <span>CORTEX / ПРОГНОЗ</span><strong>${revealed ? "5" : "?"}</strong><small>${revealed ? "ПРОГНОЗ ПОДТВЕРЖДЁН" : "ПРОГНОЗ ЗАКРЫТ"}</small>
      ${revealed ? '<i aria-hidden="true"></i>' : ""}</div>`;
  }

  function content(state) {
    const stop = button("stop", "Остановить");
    switch (state.phase) {
      case "offer": return {
        body: `<div class="experience-mark" aria-hidden="true"><img src="art/mark.svg" alt=""></div>
          <h1 id="experience-title">Хочешь увидеть,<br>на что я способен?</h1>
          <p class="experience-lead">Убери руки с экрана.<br>Дальше я сам.</p>
          <p class="experience-note">Настоящие приложения. Настоящие действия.</p>
          ${state.message ? `<p class="experience-feedback" role="status">${esc(state.message)}</p>` : ""}
          ${permissions(state)}`,
        actions: button("start", "Показать", true, !state.ready || requestPending) + button("later", "Позже")
      };
      case "number": return {
        body: `<span class="experience-step">03 / ПРЕДСКАЗАНИЕ</span>
          <h1 id="experience-title">Последний фокус.</h1><p>Проверим, умею ли я предсказывать результат?</p>
          <form id="experience-number-form" class="experience-number-form">
            <label for="experience-number">Выбери любое целое число от 1 до 99</label>
            <input id="experience-number" name="number" type="text" inputmode="numeric" pattern="[1-9][0-9]?" maxlength="2" autocomplete="off" required value="${esc(entered)}" placeholder="17" aria-describedby="experience-number-hint">
            <small id="experience-number-hint">Введи своё число. Дальше телефон снова возьму я.</small>
            <button type="submit" class="action primary" ${!validNumber(entered) || requestPending ? "disabled" : ""}>Продолжить</button>
          </form>`,
        actions: stop
      };
      case "sealed": return {
        body: `<span class="experience-step">03 / ПРЕДСКАЗАНИЕ</span><h1 id="experience-title">Мой прогноз<br>уже сделан.</h1>
          ${card(false)}<p>Теперь проверим его в калькуляторе.</p>`, actions: stop
      };
      case "reveal": return {
        body: `<span class="experience-step">03 / ПРЕДСКАЗАНИЕ</span><h1 id="experience-title">Результат совпал.</h1>
          ${state.predictionDone === true ? card(true) : ""}
          <p class="experience-reveal-copy">Совпадение? Математика.<br>А вот телефон я действительно контролировал.</p>`,
        actions: state.active ? stop : button("finish", "Дальше", true)
      };
      case "finish": return {
        body: `<div class="experience-mark" aria-hidden="true"><img src="art/mark.svg" alt=""></div><h1 id="experience-title">Мы только<br>познакомились.</h1>
          <p>${state.exampleDone || state.brightnessDone || state.predictionDone ? "Ты видел, как я управляю телефоном. Теперь просто скажи, что нужно сделать." : "На этом телефоне фокусы не удалось подтвердить. Проверь разрешения и повтори знакомство в настройках."}</p>${notices(state)}`,
        actions: state.active ? stop : button("finish", "Начать пользоваться CORTEX", true)
      };
      case "stopped": return {
        body: `<span class="experience-step">УПРАВЛЕНИЕ У ТЕБЯ</span><h1 id="experience-title">Знакомство<br>остановлено.</h1>
          <p role="status">${esc(state.message || "Можно повторить в настройках CORTEX.")}</p>
          ${state.recoveryNeeded ? `<div class="experience-permissions">${!state.brightnessPermission ? button("brightness", "Разрешить изменение яркости") : ""}${button("recover", "Восстановить яркость")}${button("display", "Открыть настройки дисплея")}</div>` : ""}${notices(state)}`,
        actions: button("finish", "Вернуться в CORTEX", true)
      };
      default: return {
        body: `<span class="experience-step">CORTEX FIRST EXPERIENCE</span><h1 id="experience-title">${esc(state.message || "Передаю управление CORTEX")}</h1>
          <p>Следи за экраном.<br>Кнопка остановки остаётся в островке.</p>
          <div class="experience-progress" aria-label="Ход знакомства"><i class="${state.exampleDone ? "complete" : ""}"></i><i class="${state.brightnessDone ? "complete" : ""}"></i><i class="${state.predictionDone ? "complete" : ""}"></i></div>`, actions: stop
      };
    }
  }

  function show() {
    if (view) return;
    previousFocus = document.activeElement;
    view = document.createElement("section");
    view.className = "cortex-intro cortex-experience";
    view.setAttribute("role", "dialog");
    view.setAttribute("aria-modal", "true");
    view.setAttribute("aria-labelledby", "experience-title");
    root.append(view);
    root.classList.add("in-onboarding", "in-first-experience");
    for (const id of ["screen", "navigation", "composition"]) document.getElementById(id).inert = true;
    CortexWave.stop();
  }

  function close() {
    if (!view) return;
    view.remove(); view = null; signature = "";
    root.classList.remove("in-onboarding", "in-first-experience");
    for (const id of ["screen", "navigation", "composition"]) document.getElementById(id).inert = false;
    previousFocus?.focus?.(); previousFocus = null;
    dispatchEvent(new CustomEvent("cortex-first-experience-end", { detail: { finished: finishing } }));
    finishing = false;
  }

  function receive(state) {
    if (!state || state.type !== "first-experience" || !phases.has(state.phase)) return;
    if (state.phase === "reveal" && state.predictionDone !== true) return;
    if (root.classList.contains("in-onboarding") && !view) { pending = state; return; }
    pending = null;
    const sameReveal = view && current?.phase === "reveal" && state.phase === "reveal" && current.session === state.session;
    if (state.session !== current?.session) entered = "";
    current = state;
    if (state.phase === "idle") { close(); return; }
    const nextSignature = JSON.stringify(state);
    if (nextSignature === signature && view) return;
    signature = nextSignature;
    requestPending = false;
    show();
    view.setAttribute("data-active", state.active ? "true" : "false");
    const page = content(state);
    if (sameReveal) {
      // Finishing native cleanup changes Stop to Next without replaying the card animation.
      view.querySelector(".experience-actions").innerHTML = page.actions;
      return;
    }
    view.innerHTML = `<header class="experience-header"><span>CORTEX</span><small>FIRST EXPERIENCE</small></header>
      <section class="experience-body" aria-live="polite">${page.body}</section><footer class="experience-actions">${page.actions}</footer>`;
    if (!document.hidden && window.cortexAppVisible !== false) {
      const focus = view.querySelector(state.phase === "number" ? "#experience-number" : "h1");
      if (state.phase !== "number") focus?.setAttribute("tabindex", "-1");
      focus?.focus({ preventScroll: true });
    }
  }

  root.addEventListener("input", event => {
    if (!view?.contains(event.target) || event.target.id !== "experience-number") return;
    entered = event.target.value;
    const submit = view.querySelector('[type="submit"]');
    if (submit) submit.disabled = !validNumber(entered) || requestPending;
  });

  root.addEventListener("submit", event => {
    if (!view?.contains(event.target) || event.target.id !== "experience-number-form") return;
    event.preventDefault();
    if (!validNumber(entered) || requestPending) return;
    requestPending = send("number", { number: entered });
    if (requestPending) view.querySelector('[type="submit"]').disabled = true;
  });

  root.addEventListener("click", event => {
    const target = event.target.closest("[data-experience]");
    if (!target || !view?.contains(target)) return;
    const action = target.dataset.experience;
    if (action === "start") {
      if (!requestPending && current.ready) { requestPending = send("start"); target.disabled = requestPending; }
    } else if (["later", "stop", "recover"].includes(action)) send(action);
    else if (action === "finish") { finishing = current.phase !== "reveal"; send("finish"); }
    else {
      const operation = { accessibility: "verification-permission", overlay: "overlay-permission", brightness: "brightness-permission", display: "display-settings" }[action];
      const bridge = action === "overlay" ? window.CortexIslandControl : window.CortexDevice;
      if (operation && bridge) bridge.postMessage(JSON.stringify({ operation }));
    }
  });

  addEventListener("cortex-native", event => {
    try { receive(typeof event.data === "string" ? JSON.parse(event.data) : event.data); } catch { /* Ignore other native event types. */ }
  });
  addEventListener("cortex-onboarding-end", event => {
    if (event.detail?.firstExperienceEligible) send("configured");
    else if (pending) receive(pending);
  });
  addEventListener("cortex-app-visibility", () => { if (window.cortexAppVisible !== false) send("state"); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) send("state"); });

  // Keep keyboard focus within the dialog. Android Back is handled by back() below.
  root.addEventListener("keydown", event => {
    if (!view) return;
    if (event.key === "Escape") { event.preventDefault(); back(); }
    if (event.key !== "Tab") return;
    const controls = [...view.querySelectorAll('button:not([disabled]), input, summary')];
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  });

  function back() {
    if (!view) return false;
    if (current.active) send("stop");
    else if (current.phase === "offer") send("later");
    else { finishing = true; send("finish"); }
    return true;
  }

  send("state");
  return { open: () => send("offer"), back };
})();
