"use strict";

window.CortexSetup = (() => {
  const key = "cortex:onboarding:v4";
  const root = document.getElementById("app");
  const prefs = () => Cortex.state.preferences;
  const reduced = () => prefs().reduceMotion || matchMedia("(prefers-reduced-motion: reduce)").matches;
  const { icon, esc } = CortexUI;
  const mark = '<img src="art/mark.svg" alt="" class="intro-mark">';
  let view, page = 0, single = false, permissions = {}, notice = "";
  const accesses = [
    { id: "microphone", name: "Микрофон", icon: "mic", action: "microphone-permission",
      description: "Продиктуйте вопрос или задачу. Доступ используется для записи речи и голосового вызова, если вы его включите." },
    { id: "overlay", name: "Островок", icon: "focus", action: "overlay-permission",
      description: "Островок показывает шаги CORTEX над приложениями. Нажмите на него, чтобы открыть мини-чат.",
      steps: ["Откройте системные настройки.", "Найдите CORTEX в списке приложений.", "Включите «Поверх других приложений»."] },
    { id: "screenAutomation", name: "Управление экраном", icon: "check", action: "verification-permission",
      description: "CORTEX читает элементы экрана при выполнении вашей задачи, нажимает кнопки, вводит текст и проверяет изменения. Передача текста экрана в OpenRouter требует вашего согласия. Его можно отозвать в настройках конфиденциальности.",
      steps: ["Откройте «Специальные возможности».", "Выберите «Установленные приложения» или «Скачанные службы».", "Включите «CORTEX — управление экраном» и вернитесь сюда."],
      note: "Если доступ ограничен, откройте карточку CORTEX в настройках Android, затем меню ⋮ → «Разрешить ограниченные настройки». Пункт появляется на поддерживаемых устройствах.",
      settings: true },
    { id: "notifications", name: "Уведомления", icon: "bell", action: "notification-permission",
      description: "Уведомления показывают шаг задачи и позволяют её остановить. Также можно получать уведомления о новых ответах поддержки." }
  ];
  // Keep first run focused: no simulated command execution and no extra demo step.
  const pages = ["welcome", ...accesses.map(x => x.id), "personalize", "finish"];

  function native(operation, data = {}) {
    const island = window.CortexIslandControl;
    const target = ["overlay-permission", "overlay-config"].includes(operation) ? island : window.CortexDevice;
    if (!target) return false;
    try { target.postMessage(JSON.stringify({ operation, ...data })); return true; }
    catch { return false; }
  }

  function prologue() {
    return `<div class="intro-stage hero-intro intro-welcome">
      <div class="intro-hero-art" aria-hidden="true">
        <div class="intro-hero-halo"></div>
        <div class="intro-hero-pill">${mark}<span>CORTEX</span><i></i></div>
        <div class="intro-hero-task"><span>ПРИМЕР КОМАНДЫ</span><strong>Напомни позвонить завтра в 10</strong>
          <small>${icon("check", 15)} CORTEX подготовит напоминание</small></div>
      </div>
      <span class="intro-eyebrow">ВАШ АССИСТЕНТ</span>
      <h1>От команды<br>к результату.</h1>
      <p>Говорите или пишите, что нужно сделать. CORTEX помогает управлять телефоном, а каждый шаг остаётся под вашим контролем.</p>
      <div class="intro-promise">${icon("shield", 16)} Действие можно остановить в любой момент</div>
    </div>`;
  }

  function access(item) {
    const granted = Boolean(permissions[item.id]);
    return '<div class="intro-stage permits-intro"><span class="intro-access-art">' + icon(item.icon, 44) +
      '</span><h1>' + item.name + '</h1><p>' + item.description + '</p>' +
      (item.steps ? '<ol class="intro-checklist">' + item.steps.map(step => '<li>' + step + '</li>').join("") + '</ol>' : "") +
      (item.note ? '<p class="intro-mini">' + item.note + '</p>' : "") +
      '<div class="intro-access-state" role="status">' + (granted ? icon("check", 16) + " Доступ активен" : esc(notice || "Доступ можно выдать позже")) + '</div>' +
      '<div class="actions"><button type="button" class="action outline" data-intro-action="permission">' +
      (granted ? "Открыть настройки" : item.steps ? "Перейти к настройкам" : "Разрешить") + '</button>' +
      (item.settings ? '<button type="button" class="action quiet" data-intro-action="details">Открыть карточку приложения</button>' : "") + '</div></div>';
  }

  function finishStage() {
    return '<div class="intro-stage finish-intro"><div class="intro-finish-mark">' + mark + '</div><h1>Готовы начать.</h1>' +
      '<p>Выберите, как CORTEX будет работать в фоне. Режим можно изменить позже.</p><div class="intro-mode-list">' +
      Object.entries(CortexPlanner.powers).map(([mode, [title, detail]]) =>
        '<button type="button" class="intro-mode ' + (prefs().energy === mode ? "selected" : "") +
        '" data-intro-action="mode" data-mode="' + mode + '" aria-pressed="' + (prefs().energy === mode) +
        '"><span class="intro-mode-text"><strong>' +
        title + (mode === "balanced" ? ' <span class="intro-recommended">Рекомендуем</span>' : '') +
        '</strong><small>' + detail + '</small></span><span class="intro-mode-check"></span></button>').join("") +
      '</div><p class="intro-feedback" role="status">' + esc(notice) + '</p></div>';
  }

  function personalize() {
    return '<div class="intro-stage intro-custom"><span class="intro-eyebrow">ПОЧТИ ГОТОВО</span><h1>Настроим под вас.</h1>' +
      '<p>Имя и внешний вид можно поменять в настройках в любой момент.</p>' +
      '<label class="field"><span>Имя или обращение</span><input id="intro-address" value="' +
      esc(prefs().addressName) + '" maxlength="60" placeholder="Можно пропустить"></label>' +
      '<h2>Оформление островка</h2><div class="intro-mode-list">' +
      Object.entries(CortexPlanner.islandPresets).map(([name, preset]) => {
        const selected = CortexPlanner.style().background === preset.background;
        return '<button type="button" class="intro-mode ' + (selected ? "selected" : "") +
          '" data-intro-action="style" data-mode="' + esc(name) + '" aria-pressed="' + selected + '">' +
          '<span class="intro-preset-pill" style="background:' + esc(preset.background) +
          ';border-color:' + esc(preset.border) + '"><i style="background:' + esc(preset.text) +
          '"></i></span><span class="intro-mode-text"><strong>' + esc(name) +
          '</strong></span><span class="intro-mode-check"></span></button>';
      }).join("") + '</div></div>';
  }

  function draw(direction = 0) {
    if (!view) return;
    const id = pages[page];
    const item = accesses.find(x => x.id === id);
    const content = item ? access(item) : id === "finish" ? finishStage() : id === "personalize" ? personalize() : prologue(id);
    const oldWidth = view.querySelector(".intro-meter i")?.style.width;
    const previous = direction === 0 ? view.querySelector(".intro-content")?.scrollTop || 0 : 0;
    view.innerHTML = '<div class="intro-top"><span class="intro-wordmark">CORTEX</span>' +
      (!single ? '<span class="intro-count">' + (page + 1) + ' / ' + pages.length + '</span>' : '') +
      '<button type="button" data-intro-action="close">' + (single ? 'Закрыть' : 'Позже') + '</button></div><section class="intro-content">' + content +
      '</section><div class="intro-bottom">' + (!single ? '<div class="intro-meter" role="progressbar" aria-label="Первый запуск" aria-valuemin="0" aria-valuemax="' +
      pages.length + '" aria-valuenow="' + (page + 1) + '"><i style="width:' + (100 * (page + 1) / pages.length) + '%"></i></div>' : '') +
      '<div class="intro-nav"><button type="button" class="intro-back" data-intro-action="back" ' + (page === 0 || single ? "hidden" : "") + '>Назад</button>' +
      '<button type="button" class="intro-next" data-intro-action="next">' +
      (single ? "Готово" : id === "finish" ? "Открыть CORTEX" : id === "welcome" ? "Настроить CORTEX" : "Продолжить") +
      ' ' + icon("chevron", 19) + '</button></div></div>';
    const bar = view.querySelector(".intro-meter i");
    if (bar && oldWidth && direction && !reduced()) {
      bar.animate([{ width: oldWidth }, { width: bar.style.width }], { duration: 370, easing: "cubic-bezier(.16,1,.3,1)" });
    }
    const node = view.querySelector(".intro-content");
    node.scrollTop = previous;
    if (direction && !reduced()) node.animate([
      { opacity: 0, transform: "translate3d(" + direction * 20 + "px, 12px, 0) scale(.975)" },
      { opacity: 1, transform: "none" }
    ], { duration: 380, easing: "cubic-bezier(.16,1,.3,1)" });
  }

  function show(index, one = false) {
    if (view) return;
    page = index; single = one; notice = "";
    view = document.createElement("section");
    view.className = "cortex-intro";
    view.setAttribute("role", "dialog");
    view.setAttribute("aria-modal", "true");
    view.setAttribute("aria-label", one ? "Разрешение Android" : "Первый запуск CORTEX");
    root.classList.add("in-onboarding");
    root.append(view);
    for (const id of ["screen", "navigation", "composition"]) document.getElementById(id).inert = true;
    CortexWave.stop();
    draw(1);
    native("permissions");
  }

  function close(complete = false) {
    if (!view) return;
    if (!single && complete) localStorage.setItem(key, "done");
    view.remove();
    view = null;
    root.classList.remove("in-onboarding");
    for (const id of ["screen", "navigation", "composition"]) document.getElementById(id).inert = false;
    dispatchEvent(new CustomEvent("cortex-onboarding-end", { detail: { configured: !single && complete } }));
  }

  root.addEventListener("click", event => {
    const target = event.target.closest("[data-intro-action]");
    if (!view?.contains(target)) return;
    const item = accesses.find(x => x.id === pages[page]);
    switch (target.dataset.introAction) {
      case "next":
        if (single || page === pages.length - 1) {
          if (!single) {
            root.dispatchEvent(new CustomEvent("cortex-onboarding-energy", { detail: { mode: prefs().energy } }));
            root.dispatchEvent(new Event("cortex-onboarding-style"));
          }
          close(true);
        }
        else { page++; notice = ""; draw(1); }
        break;
      case "back": back(); break;
      case "close": close(!single); break;
      case "permission":
        if (!item) return;
        notice = native(item.action) ? "После выдачи доступа вернитесь в CORTEX." : "Откройте разрешения приложения в Android.";
        draw();
        break;
      case "details": native("open-settings"); break;
      case "mode": {
        const mode = target.dataset.mode;
        if (!Object.hasOwn(CortexPlanner.powers, mode)) return;
        root.dispatchEvent(new CustomEvent("cortex-onboarding-energy", { detail: { mode } }));
        notice = mode !== "economy" && !permissions.overlay ? "Разрешение для островка можно выдать в разделе «Вызов»." : "";
        draw();
        break;
      }
      case "style":
        if (Object.hasOwn(CortexPlanner.islandPresets, target.dataset.mode)) {
          Cortex.state.islandStyle = { ...CortexPlanner.islandPresets[target.dataset.mode] };
          Cortex.save();
          root.dispatchEvent(new Event("cortex-onboarding-style"));
          draw();
        }
        break;
    }
  });

  root.addEventListener("input", event => {
    if (view?.contains(event.target) && event.target.id === "intro-address") {
      prefs().addressName = event.target.value.trim().slice(0, 60);
      Cortex.save();
    }
  });

  function back() {
    if (!view) return false;
    if (single || page === 0) close(false);
    else { page--; notice = ""; draw(-1); }
    return true;
  }

  return {
    start: () => show(0),
    autoStart: () => { if (localStorage.getItem(key) !== "done") show(0); },
    openPermission(id) { const index = pages.indexOf(id); if (accesses.some(item => item.id === id)) show(index, true); },
    updatePermissions(value) {
      const id = pages[page];
      const before = permissions[id];
      permissions = { ...permissions, ...value };
      if (view && before !== permissions[id]) { notice = ""; draw(); }
    },
    back
  };
})();
