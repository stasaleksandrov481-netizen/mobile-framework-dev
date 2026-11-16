"use strict";

const CortexPlanner = (() => {
  const M = Cortex, U = CortexUI;
  const { esc, detail, icon } = U;
  const routes = new Set(["schedule", "scenarios", "island-editor", "energy"]);
  const fieldTypes = {
    open: "Открыть приложение", tap: "Нажать элемент", point: "Нажать записанную точку", type: "Ввести текст",
    swipe: "Свайп", wait: "Ждать элемент", pause: "Пауза", if: "Условие", repeat: "Повторение",
    run: "Запустить сценарий", variable: "Задать переменную"
  };
  const actionGroups = [
    ["Навигация", "open", "tap", "point", "type", "swipe"],
    ["Условия и ожидание", "wait", "pause", "if", "repeat"],
    ["Сценарии и данные", "run", "variable"]
  ];
  const stepIcons = { open: "folder", tap: "focus", point: "target", type: "note", swipe: "sendUp", wait: "history",
    pause: "stop", if: "layers", repeat: "refresh", run: "bolt", variable: "file" };
  const draftKey = () => "cortex:scenario:draft:v1:" + (M.state.account?.id || "guest");
  const statuses = {
    scheduled: "Запланировано", due: "Ожидает отметки", blocked: "Ожидает запуска", running: "Выполняется",
    done: "Готово", failed: "Ошибка", cancelled: "Отменено"
  };
  const directions = { down: "Вниз", up: "Вверх", left: "Влево", right: "Вправо" };
  const islandDefaults = {
    background: "#080808", text: "#ffffff", border: "#c6c6c6", accent: "#ffffff", faceColor: "#ffffff",
    opacity: 96, size: 100, widthScale: 100, heightScale: 100, offsetX: 0, offsetY: 0, corner: 22, borderWidth: .65, motion: "liquid",
    face: false, status: true, progress: true, results: true
  };
  const islandPresets = {
    "Монохром": islandDefaults,
    "Графит": { ...islandDefaults, background: "#1d1d1d", border: "#686868", opacity: 94, motion: "soft" },
    "Светлый": { ...islandDefaults, background: "#e7e7e7", text: "#161616", border: "#555555", accent: "#363636", faceColor: "#777777" }
  };
  const powers = {
    economy: ["Экономный", "Голосовой вызов и фоновый островок выключены. Диктовка и расписание работают."],
    balanced: ["Сбалансированный", "Островок по запросу. Если включён голосовой вызов, микрофон отдыхает при выключенном экране."],
    maximum: ["Максимальный", "Постоянный островок и голосовой вызов, пока Android разрешает работу микрофона. Расход заряда выше."]
  };

  let app, items = [], tasks = [], exact = false, notifications = false;
  let selectedTask = "", scheduleDraft, scenarioDraft, pointPath, scenarioBusy = false;
  let scheduleReady = false, scenarioReady = false;
  let expandedStep = "", pickerBranch = "", gesture;
  const colorNames = { background: "Фон", text: "Текст", border: "Граница", accent: "Прогресс", faceColor: "Смайлик" };
  let formOperation = "";
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const format = new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" });
  const isObject = value => value && typeof value === "object" && !Array.isArray(value);
  const options = (values, selected) => Object.entries(values).map(([key, title]) =>
    `<option value="${esc(key)}"${key === selected ? " selected" : ""}>${esc(title)}</option>`).join("");
  const action = (text, command, value = "", style = "outline") =>
    `<button type="button" class="action ${style}" data-plan="${command}" data-value="${esc(value)}">${esc(text)}</button>`;
  const label = (title, input) => `<label class="field"><span>${esc(title)}</span>${input}</label>`;
  const submit = title => `<button type="submit" class="action primary">${esc(title)}</button>`;
  const niceTime = value => Number.isFinite(Number(value)) ? format.format(new Date(Number(value))) : "";
  const toLocalInput = value => {
    const date = new Date(value);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  };

  function schedule() {
    if (!app.native) return detail("Расписание", "", '<p class="muted">Расписание работает в Android-приложении.</p>');
    const permissions = (!notifications ? action("Разрешить уведомления", "native", "notification-permission") : "") +
      (!exact ? action("Включить точные напоминания", "native", "schedule-exact") : "");
    const taskCard = task => {
      const active = ["scheduled", "due", "blocked"].includes(task.status);
      const actions = task.status === "scheduled" ? action("Изменить", "schedule-edit", task.id) :
        task.status === "due" ? action("Готово", "schedule-done", task.id) + action("Отложить на 5 мин", "schedule-snooze", task.id) :
        task.status === "blocked" ? action("Выполнить", "schedule-run", task.id) : "";
      return `<article class="panel plan-card${task.id === selectedTask ? " plan-selected" : ""}" data-task-card="${esc(task.id)}">
        <div class="plan-meta"><span>${task.kind === "reminder" ? "Напоминание" : "Действие"}</span><time>${esc(niceTime(task.at))}</time></div>
        <h2>${esc(task.text)}</h2><small>${esc(statuses[task.status] || task.status)}${task.repeat !== "none" ?
          " · " + (task.repeat === "daily" ? "Ежедневно" : "Еженедельно") : ""}</small>
        ${task.message ? `<p>${esc(task.message.recipient)} · ${esc(task.message.text)}</p>` : ""}
        ${task.detail ? `<p>${esc(task.detail)}</p>` : ""}
        ${active ? `<div class="actions">${actions}${action("Отменить", "schedule-cancel", task.id, "quiet")}</div>` : ""}
      </article>`;
    };
    let editor = "";
    if (scheduleDraft) {
      const { kind, text, local, repeat } = scheduleDraft;
      editor = `<form class="panel stack" id="plan-schedule-form">
        <h2>${scheduleDraft.id ? "Изменить поручение" : "Запланировать поручение"}</h2>
        ${label("Что сделать", `<select name="kind">${options({ reminder: "Напомнить", action: "Выполнить действие" }, kind)}</select>`)}
        ${label("Текст", `<textarea name="text" rows="2" maxlength="2400" required>${esc(text)}</textarea>`)}
        ${label("Местные дата и время", `<input name="local" type="datetime-local" value="${esc(local)}" required>`)}
        ${label("Повторять", `<select name="repeat">${options({ none: "Один раз", daily: "Каждый день", weekly: "Каждую неделю" }, repeat)}</select>`)}
        <div class="actions">${submit("Сохранить")}${action("Закрыть", "schedule-close", "", "quiet")}</div>
      </form>`;
    }
    const active = tasks.filter(task => ["scheduled", "due", "blocked", "running"].includes(task.status));
    const history = tasks.filter(task => !active.includes(task));
    return detail("Расписание", "Напоминания и действия", `<div class="actions">${action("Добавить", "schedule-edit", "", "primary")}</div>` +
      (scheduleReady && permissions ? `<section class="panel stack"><p class="muted">${!notifications ?
        "Разрешите уведомления для напоминаний при выключенном экране." : "Android может доставлять напоминания с задержкой."}</p>
        <div class="actions">${permissions}</div></section>` : "") + editor +
      (active.length ? active.map(taskCard).join("") : `<p class="muted">${scheduleReady ? "Скажите «Напомни через десять минут достать курицу»." : "Загружаю расписание…"}</p>`) +
      (history.length ? `<h2 class="group-label">История</h2>${history.map(taskCard).join("")}` : ""));
  }

  function cleanSteps(source, depth = 0) {
    if (!Array.isArray(source) || depth > 4) return [];
    return source.slice(0, 40).filter(step => isObject(step) && Object.hasOwn(fieldTypes, step.kind)).map(data => {
      const step = { kind: data.kind };
      for (const key of ["target", "value", "expect", "package"]) if (typeof data[key] === "string") step[key] = data[key].slice(0, 2000);
      for (const key of ["x", "y", "count", "seconds"]) if (typeof data[key] === "number" && Number.isFinite(data[key])) step[key] = data[key];
      if (data.confirm === true) step.confirm = true;
      if (["if", "repeat"].includes(step.kind)) step.steps = cleanSteps(data.steps, depth + 1);
      if (step.kind === "if") step.else = cleanSteps(data.else, depth + 1);
      return step;
    });
  }

  function scenarioFrom(value, keepId = false) {
    return {
      id: keepId ? value.id || "" : "",
      name: typeof value.name === "string" ? value.name.slice(0, 90) : "",
      triggers: Array.isArray(value.triggers) ? value.triggers.filter(text => typeof text === "string").slice(0, 12) : [],
      steps: cleanSteps(value.steps)
    };
  }

  function stepsAt(path) {
    let steps = scenarioDraft?.steps;
    if (!steps || !path) return steps;
    const parts = path.split(".");
    for (let i = 0; i < parts.length; i += 2) {
      if (!/^\d+$/.test(parts[i]) || !["steps", "else"].includes(parts[i + 1])) return undefined;
      steps = steps?.[Number(parts[i])]?.[parts[i + 1]];
    }
    return steps;
  }

  function address(path) {
    const split = path.lastIndexOf(".");
    const of = split < 0 ? "" : path.slice(0, split);
    return { steps: stepsAt(of), index: Number(path.slice(split + 1)) };
  }

  function makeStep(kind) {
    const step = { kind };
    if (kind === "swipe") step.value = "down";
    if (kind === "pause") step.seconds = 2;
    if (kind === "repeat") step.count = 2;
    if (["if", "repeat"].includes(kind)) step.steps = [];
    if (kind === "if") step.else = [];
    return step;
  }

  function stepList(steps, parent = "", depth = 0) {
    const inline = (path, key, kind, value, attrs = "") =>
      `<input data-step="${esc(path)}" data-key="${key}" type="${kind}" value="${esc(value ?? "")}" ${attrs}>`;
    const fields = (step, path) => {
      const input = (title, key = "target", max = 180) => label(title, inline(path, key, "text", step[key], `maxlength="${max}" required`));
      switch (step.kind) {
        case "open": return input("Название приложения");
        case "tap": return input("Точная подпись элемента") + label("Что появится после нажатия",
          inline(path, "expect", "text", step.expect, 'maxlength="180" placeholder="Необязательно"')) +
          `${planSwitch("Подтверждать нажатие", `data-step="${path}" data-key="confirm"`, step.confirm)}`;
        case "point": return `<p class="muted">${step.package ? esc(step.target || step.package) :
          "Оставьте нужное приложение открытым за CORTEX."}</p>${action("Записать касание", "scenario-point", path)}`;
        case "type": return label("Текст для ввода", `<textarea data-step="${path}" data-key="value" rows="2" maxlength="2000" required>${esc(step.value)}</textarea>`);
        case "swipe": return label("Направление", `<select data-step="${path}" data-key="value">${options(directions, step.value)}</select>`);
        case "wait": return input("Какой элемент должен появиться");
        case "pause": return label("Секунд", inline(path, "seconds", "number", step.seconds, 'min="1" max="30" required'));
        case "if": return input("Если на экране есть элемент") + `<div class="plan-branch"><strong>Да</strong>${stepList(step.steps, path + ".steps", depth + 1)}</div>
          <div class="plan-branch"><strong>Нет</strong>${stepList(step.else, path + ".else", depth + 1)}</div>`;
        case "repeat": return label("Количество повторов", inline(path, "count", "number", step.count, 'min="1" max="10" required')) +
          `<div class="plan-branch">${stepList(step.steps, path + ".steps", depth + 1)}</div>`;
        case "run": return label("Сценарий", `<select data-step="${path}" data-key="target" required><option value="">Выберите</option>
          ${options(Object.fromEntries(items.filter(item => item.id !== scenarioDraft.id).map(item => [item.id, item.name])), step.target)}</select>`);
        default: return input("Имя переменной", "target", 32) + label("Значение", inline(path, "value", "text", step.value, 'maxlength="2000"'));
      }
    };
    return `<div class="plan-chain" data-chain="${esc(parent)}">${steps.map((step, index) => {
      const path = parent ? `${parent}.${index}` : String(index);
      const summary = step.kind === "pause" ? `${step.seconds} с` : step.kind === "repeat" ? `${step.count} повторов` :
        step.kind === "run" ? items.find(item => item.id === step.target)?.name : step.kind === "swipe" ? directions[step.value] :
        step.target || step.value;
      return `<section class="plan-step" data-step-row="${path}">
        <header class="plan-step-head">
          <button type="button" class="plan-grip" data-grip="${path}" aria-label="Перетащить шаг ${index + 1}">⠿</button>
          <button type="button" class="plan-step-name" data-plan="step-edit" data-value="${path}"
            aria-expanded="${expandedStep === path}">${icon(stepIcons[step.kind], 17)}
            <span><strong>${index + 1}. ${esc(fieldTypes[step.kind])}</strong>
            ${summary ? `<small>${esc(summary)}</small>` : ""}</span>${icon("chevron", 15)}</button>
        </header>
        ${expandedStep === path ? `<div class="plan-step-body">${fields(step, path)}
          <div class="plan-step-buttons">${index > 0 ? action("Выше", "step-up", path, "quiet") : ""}
          ${index < steps.length - 1 ? action("Ниже", "step-down", path, "quiet") : ""}
          ${action("Дублировать", "step-copy", path, "quiet")}${action("Удалить", "step-delete", path, "quiet")}</div></div>` :
          ["if", "repeat"].includes(step.kind) ?
          `<div class="plan-branch"><strong>${step.kind === "if" ? "Да" : "Шаги повтора"}</strong>${stepList(step.steps, path + ".steps", depth + 1)}</div>
          ${step.kind === "if" ? `<div class="plan-branch"><strong>Нет</strong>${stepList(step.else, path + ".else", depth + 1)}</div>` : ""}` : ""}
      </section>`;
    }).join("")}${action("＋ Добавить шаг", "step-picker", parent, "quiet")}</div>`;
  }

  function actionPicker(branch) {
    pickerBranch = branch;
    const depth = branch ? branch.split(".").length / 2 : 0;
    app.sheet("Добавить действие", `<div class="stack plan-picker">
      ${label("Поиск действий", '<input type="search" data-step-search placeholder="Название действия" maxlength="80">')}
      ${actionGroups.map(([title, ...kinds]) => `<section data-step-group><h3>${esc(title)}</h3>
        ${kinds.filter(kind => depth < 4 || !["if", "repeat"].includes(kind)).map(kind =>
          `<button type="button" class="tile" data-plan="step-add" data-value="${kind}"><span class="tile-glyph">
            ${icon(stepIcons[kind], 19)}</span><span>${esc(fieldTypes[kind])}</span></button>`).join("")}
      </section>`).join("")}<p class="muted" data-no-step hidden>Совпадений нет.</p></div>`);
  }

  function storedDraft() {
    try {
      const value = JSON.parse(localStorage.getItem(draftKey()));
      return isObject(value) ? scenarioFrom(value, true) : null;
    } catch { return null; }
  }

  function planSwitch(title, attributes, checked) {
    return `<label class="plan-switch"><span>${esc(title)}</span>
      <input type="checkbox" role="switch" ${attributes} ${checked ? "checked" : ""}>
      <span class="switch-track" aria-hidden="true"><i></i></span></label>`;
  }

  function scenarios() {
    if (!app.native) return detail("Сценарии", "", '<p class="muted">Запуск сценариев доступен в Android-приложении.</p>');
    if (!scenarioReady && !scenarioDraft) return detail("Сценарии", "", '<p class="muted">Загружаю сценарии…</p>');
    if (scenarioDraft) return detail("Конструктор", "", `<form class="panel stack" id="plan-scenario-form" novalidate>
      ${label("Название", `<input name="name" maxlength="90" required value="${esc(scenarioDraft.name)}">`)}
      ${label("Голосовые фразы, по одной в строке", `<textarea name="triggers" rows="2" maxlength="1200">${esc(scenarioDraft.triggers.join("\n"))}</textarea>`)}
      <p class="muted">Вставляйте переменную в текст или название элемента в виде \${имя}. Имена переменных задавайте латиницей.</p>
      ${stepList(scenarioDraft.steps)}
      <div class="actions"><button type="submit" class="action primary">Сохранить сценарий</button>
        ${action("Проверить", "scenario-check")}${action("Сохранить черновик", "draft-save", "", "quiet")}
        ${action("К списку", "scenario-close", "", "quiet")}</div>
    </form>`);
    const draft = storedDraft();
    const newScenario = action("Новый сценарий", "scenario-edit", "", "primary");
    const saved = items.map(item => `<article class="scenario-card">
      <button type="button" class="scenario-name" data-plan="scenario-edit" data-value="${esc(item.id)}">
        <span class="section-symbol">${icon("layers", 21)}</span><span><strong>${esc(item.name)}</strong>
        <small>${esc(item.triggers[0] || `Запусти сценарий «${item.name}»`)}</small></span>${icon("chevron", 16)}</button>
      <footer>${action("Запустить", "scenario-run", item.id)}
        <details class="scenario-options"><summary aria-label="Действия со сценарием">${icon("dots", 19)}</summary>
          <div class="scenario-option-menu">${action("Дублировать", "scenario-copy", item.id, "quiet")}
            ${action("Сохранить копию", "scenario-export", item.id, "quiet")}
            ${action("Удалить", "scenario-delete", item.id, "quiet")}</div></details>
      </footer></article>`).join("");
    const list = saved ? `<section class="scenario-list"><header><h2>Мои сценарии</h2>${newScenario}</header>${saved}</section>` :
      `<section class="scenario-empty glass-card">
        <div class="scenario-illustration" aria-hidden="true">
          <span>${icon("bolt", 20)}</span><i></i><span>${icon("layers", 24)}</span><i></i><span>${icon("check", 20)}</span>
        </div><h2>Соберите цепочку действий</h2>
        <p>Добавьте шаги и фразу для запуска голосом.</p>${newScenario}
      </section>`;
    return detail("Сценарии", "", list +
      (draft ? `<div class="scenario-draft">${icon("note", 20)}<span><strong>Черновик</strong><small>${esc(draft.name || "Без названия")}</small></span>
        ${action("Продолжить", "draft-open")}</div>` : "") +
      `<details class="scenario-assist"${scenarioBusy ? " open" : ""}><summary>
          <span class="section-symbol">${icon("spark", 20)}</span><span><strong>Черновик с ИИ</strong></span>${icon("chevron", 16)}</summary>
        <form id="plan-ai-form" class="stack">
          ${label("Что нужно сделать?", '<textarea name="goal" rows="2" maxlength="1200" placeholder="Открой настройки и найди раздел «Дисплей»" required></textarea>')}
          ${submit(scenarioBusy ? "Готовлю черновик…" : "Предложить шаги")}
        </form></details>`);
  }

  function style() {
    const value = { ...islandDefaults };
    const given = M.state.islandStyle || {};
    for (const [key, fallback] of Object.entries(islandDefaults)) {
      const current = given[key];
      if (typeof current !== typeof fallback) continue;
      if (typeof fallback === "boolean" || typeof fallback === "number" && Number.isFinite(current) ||
          typeof fallback === "string" && (key === "motion" ? ["liquid", "soft", "none"].includes(current) : /^#[0-9a-f]{6}$/i.test(current))) value[key] = current;
    }
    if (!Object.hasOwn(given, "widthScale") && value.background.toLowerCase() === "#080808" && value.opacity === 100) {
      value.background = islandDefaults.background;
      value.opacity = islandDefaults.opacity;
    }
    return value;
  }

  function preview() {
    const data = style();
    const size = Math.max(80, Math.min(125, data.size));
    return `<span class="plan-camera"></span>
      <div class="plan-island-wrap" style="transform:translate(${clamp(data.offsetX, -75, 75) / 2}px,${clamp(data.offsetY, 0, 80) / 3}px)">
        <div class="plan-island-sample" style="--island-bg:${data.background};--island-text:${data.text};--island-style-border:${data.border};
          --island-accent:${data.accent};--island-opacity:${clamp(data.opacity, 40, 100)}%;
          --island-width:${132 * size * clamp(data.widthScale, 80, 125) / 10000}px;--island-height:${40 * size * clamp(data.heightScale, 90, 125) / 10000}px;
          --island-radius:${clamp(data.corner, 12, 32)}px;--island-weight:${clamp(data.borderWidth, 0, 3)}px">
          ${data.face ? `<span class="plan-face" style="background:${data.faceColor};color:${data.background}"><i></i><i></i><b></b></span>` : '<span class="plan-logo" aria-hidden="true"></span>'}
          ${data.status ? "<span>Слушаю…</span>" : ""}
          ${data.progress ? '<i aria-hidden="true"></i>' : ""}</div>
        <span class="plan-size-grip" aria-hidden="true"></span>
      </div>`;
  }

  function islandEditor() {
    const data = style();
    const slider = (key, title, min, max, increments = 1) => `<div class="field plan-range">
      <div class="plan-range-head"><label for="range-${key}">${esc(title)}</label>
        <input type="number" data-number-style="${key}" aria-label="${esc(title)} вручную"
          min="${min}" max="${max}" step="${increments}" value="${esc(data[key])}"></div>
      <input type="range" id="range-${key}" min="${min}" max="${max}" step="${increments}" data-style="${key}" value="${esc(data[key])}">
    </div>`;
    const widget = (key, title) => planSwitch(title, `data-style="${key}"`, data[key]);
    return detail("Островок", "Оформление", `<div class="plan-island-preview glass-card" data-island-preview aria-label="Предпросмотр островка">${preview()}</div>
      <p class="muted plan-hint">Перетащите островок. Потяните за угол, чтобы изменить размер.</p>
      <div class="actions">${Object.keys(islandPresets).map(title => action(title, "island-preset", title)).join("")}</div>
      <section class="panel stack"><h2>Положение и форма</h2>${slider("size", "Общий масштаб", 80, 125)}
        ${slider("widthScale", "Ширина", 80, 125)}${slider("heightScale", "Высота", 90, 125)}
        ${slider("offsetX", "Сдвиг влево и вправо", -75, 75)}${slider("offsetY", "Сдвиг вниз", 0, 80)}
        ${slider("corner", "Скругление", 12, 32)}${slider("borderWidth", "Толщина границы", 0, 3, .1)}
        ${slider("opacity", "Непрозрачность", 40, 100)}
        ${label("Анимация", `<select data-style="motion">${options({ liquid: "Плавная", soft: "Короткая", none: "Мгновенная" }, data.motion)}</select>`)}</section>
      <section class="panel stack"><h2>Цвета</h2><div class="plan-color-grid">${Object.entries(colorNames).map(([key, title]) =>
        `<button type="button" class="plan-swatch" data-plan="palette" data-value="${key}">
          <i style="--swatch:${data[key]}" aria-hidden="true"></i>${esc(title)}</button>`).join("")}</div></section>
      <section class="panel stack"><h2>Содержимое</h2>${widget("face", "Анимированный символ")}${widget("status", "Статус")}
        ${widget("progress", "Полоса прогресса")}${widget("results", "Результат действий")}</section>`);
  }

  function hsvFromHex(hex) {
    const [r, g, b] = hex.slice(1).match(/../g).map(part => parseInt(part, 16) / 255);
    const max = Math.max(r, g, b), delta = max - Math.min(r, g, b);
    const angle = !delta ? 0 : max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    return [Math.round((60 * angle + 360) % 360), max ? Math.round(100 * delta / max) : 0, Math.round(max * 100)];
  }

  function hexFromHsv(hue, saturation, value) {
    const s = saturation / 100, v = value / 100;
    return "#" + [5, 3, 1].map(channel => {
      const position = (channel + hue / 60) % 6;
      return Math.round(255 * (v - v * s * Math.max(0, Math.min(position, 4 - position, 1)))).toString(16).padStart(2, "0");
    }).join("");
  }

  function palette(key) {
    const hex = style()[key];
    const sliders = ["Оттенок", "Насыщенность", "Яркость"].map((title, index) => label(title,
      `<input type="range" data-hsv="${index}" min="0" max="${index ? 100 : 359}" value="${hsvFromHex(hex)[index]}">`)).join("");
    app.sheet(colorNames[key], `<form id="plan-palette-form" class="stack plan-palette" data-color="${key}">
      <div data-palette-preview class="plan-palette-preview" style="--swatch:${hex}" aria-label="Предпросмотр цвета"></div>
      ${sliders}${label("HEX", `<input type="text" name="hex" maxlength="7" pattern="#[0-9a-fA-F]{6}" value="${hex}"
        required spellcheck="false" autocapitalize="none">`)}
      ${submit("Применить")}</form>`);
  }

  function applyStyle(key, value) {
    M.state.islandStyle = { ...style(), [key]: value };
    const sample = document.querySelector("[data-island-preview]");
    if (sample) sample.innerHTML = preview();
  }

  function startGesture(event) {
    if (!event.isPrimary || event.button !== 0 || gesture) return;
    const grip = event.target.closest("[data-grip]");
    const island = event.target.closest(".plan-island-wrap");
    if (!grip && !island) return;
    const handle = grip || island.closest("[data-island-preview]");
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    const { offsetX, offsetY, size } = style();
    gesture = { id: event.pointerId, handle, grip, source: grip?.dataset.grip, startX: event.clientX, startY: event.clientY,
      offsetX, offsetY, size, resize: Boolean(event.target.closest(".plan-size-grip")), target: null };
  }

  function moveGesture(event) {
    if (gesture?.id !== event.pointerId) return;
    if (!gesture.grip) {
      const dx = event.clientX - gesture.startX, dy = event.clientY - gesture.startY;
      const values = gesture.resize ? { size: clamp(Math.round(gesture.size + dx + dy), 80, 125) } :
        { offsetX: clamp(Math.round(gesture.offsetX + dx * 2), -75, 75),
          offsetY: clamp(Math.round(gesture.offsetY + dy * 3), 0, 80) };
      M.state.islandStyle = { ...style(), ...values };
      gesture.handle.innerHTML = preview();
      for (const [key, value] of Object.entries(values)) {
        for (const field of app.root.querySelectorAll(`[data-style="${key}"], [data-number-style="${key}"]`)) field.value = value;
      }
      return;
    }
    const scroll = gesture.handle.closest(".scroll");
    if (scroll) {
      const box = scroll.getBoundingClientRect();
      if (event.clientY < box.top + 37) scroll.scrollTop -= 10;
      else if (event.clientY > box.bottom - 37) scroll.scrollTop += 10;
    }
    const row = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-step-row]");
    const chain = gesture.grip.closest("[data-chain]");
    const target = row?.parentElement === chain ? row : null;
    gesture.target?.classList.remove("plan-drag-target");
    gesture.target = target;
    target?.classList.add("plan-drag-target");
  }

  function endGesture(event) {
    if (gesture?.id !== event.pointerId) return;
    const { grip, source, target, offsetX, offsetY, size } = gesture;
    gesture = null;
    target?.classList.remove("plan-drag-target");
    if (!grip) {
      if (event.type === "pointercancel") {
        M.state.islandStyle = { ...style(), offsetX, offsetY, size };
        app.render();
      } else app.updateStyle();
      return;
    }
    const path = target?.dataset.stepRow;
    if (event.type === "pointercancel" || !path || path === source) return;
    const from = address(source), to = address(path);
    if (from.steps && from.steps === to.steps) {
      const [item] = from.steps.splice(from.index, 1);
      from.steps.splice(to.index, 0, item);
      expandedStep = "";
      app.render();
    }
  }

  function energy() {
    return detail("Энергопотребление", "", `<section class="surface-choices" aria-label="Режим питания">
      ${Object.entries(powers).map(([value, [title, description]]) => `<button type="button" class="surface-option" role="radio"
        aria-checked="${M.state.preferences.energy === value}" data-plan="power" data-value="${value}">
        <span class="surface-radio" aria-hidden="true"></span><span><strong>${esc(title)}</strong><small>${esc(description)}</small></span></button>`).join("")}
      </section>`);
  }

  const pages = { schedule, scenarios, "island-editor": islandEditor, energy };

  function handle(message) {
    switch (message.type) {
      case "schedule-list":
        tasks = Array.isArray(message.tasks) ? message.tasks : [];
        notifications = message.notifications; exact = message.exact; scheduleReady = true;
        if (app.route() === "schedule") app.render();
        if (selectedTask) requestAnimationFrame(() => {
          const card = [...document.querySelectorAll("[data-task-card]")].find(element => element.dataset.taskCard === selectedTask);
          card?.scrollIntoView({ block: "nearest" });
        });
        return true;
      case "schedule-open":
        selectedTask = message.id;
        scheduleDraft = null;
        app.open("schedule");
        app.send("schedule-list");
        return true;
      case "schedule-result":
        app.toast(message.text);
        if (message.ok && scheduleDraft) { scheduleDraft = null; if (app.route() === "schedule") app.render(); }
        return true;
      case "scenario-list":
        items = Array.isArray(message.items) ? message.items : [];
        scenarioReady = true;
        if (app.route() === "scenarios") app.render();
        return true;
      case "scenario-result":
        if (message.ok && message.operation === "save") {
          scenarioDraft = null;
          expandedStep = "";
          try { localStorage.removeItem(draftKey()); } catch {}
          if (app.route() === "scenarios") app.render();
        }
        if (message.operation === formOperation) formOperation = "";
        app.toast(message.text);
        return true;
      case "scenario-point": {
        if (pointPath && scenarioDraft) {
          const { steps, index } = address(pointPath);
          if (steps?.[index]?.kind === "point") Object.assign(steps[index], message.point);
          pointPath = null;
          app.render();
        }
        return true;
      }
      case "scenario-import":
        scenarioDraft = scenarioFrom(message.item || {});
        expandedStep = "";
        app.render();
        app.toast("Проверьте импортированную схему перед сохранением.");
        return true;
      default: return false;
    }
  }

  function click(event) {
    const control = event.target.closest("[data-plan]");
    if (!control) return;
    const value = control.dataset.value, command = control.dataset.plan;
    if (command === "native") { app.send(value); return; }
    if (command === "schedule-edit") {
      const task = tasks.find(task => task.id === value);
      scheduleDraft = task ? { ...task, local: task.local?.slice(0, 16) || toLocalInput(task.at) } :
        { kind: "reminder", text: "", local: toLocalInput(Date.now() + 600000), repeat: "none" };
      app.render();
      document.querySelector("#plan-schedule-form textarea")?.focus();
      return;
    }
    if (command === "schedule-close") { scheduleDraft = null; app.render(); return; }
    if (command.startsWith("schedule-")) {
      const perform = () => app.send("schedule-action", { id: value, action: command.slice(9) });
      if (command === "schedule-cancel") app.confirm("Отменить поручение?", "Оно исчезнет из списка активных.", perform);
      else perform();
      return;
    }
    if (command === "scenario-edit" || command === "scenario-copy") {
      const item = items.find(item => item.id === value) || {};
      scenarioDraft = scenarioFrom(item, command === "scenario-edit");
      expandedStep = "";
      if (command === "scenario-copy") {
        scenarioDraft.name = (scenarioDraft.name + " · копия").slice(0, 90);
        scenarioDraft.triggers = [];
      }
      app.render();
      return;
    }
    if (command === "scenario-close") { scenarioDraft = null; expandedStep = ""; app.render(); return; }
    if (command === "draft-save" && scenarioDraft) {
      try { localStorage.setItem(draftKey(), JSON.stringify(scenarioDraft)); app.toast("Черновик сохранён."); }
      catch { app.toast("Не удалось сохранить черновик."); }
      return;
    }
    if (command === "draft-open") {
      scenarioDraft = storedDraft();
      expandedStep = "";
      app.render();
      return;
    }
    if (command === "scenario-check") { sendScenario("check"); return; }
    if (command === "scenario-point") { pointPath = value; app.send("scenario-point"); return; }
    if (command === "scenario-export") { app.send("scenario-export", { id: value }); return; }
    if (command === "scenario-delete") {
      app.confirm("Удалить сценарий?", "Цепочки, которые на него ссылаются, остановятся на этом шаге.", () => app.send("scenario-delete", { id: value }));
      return;
    }
    if (command === "scenario-run") {
      app.confirm("Запустить тест?", "CORTEX выполнит шаги на экране и запишет результат в журнал.", () => app.send("scenario-run", { id: value }));
      return;
    }
    if (command === "palette" && Object.hasOwn(colorNames, value)) { palette(value); return; }
    if (command === "island-preset" && Object.hasOwn(islandPresets, value)) {
      M.state.islandStyle = { ...islandPresets[value] };
      app.updateStyle(); app.render(); return;
    }
    if (command === "power") { app.power(value); return; }
    if (command === "step-picker") { actionPicker(value); return; }
    if (command === "step-add" && Object.hasOwn(fieldTypes, value)) {
      const steps = stepsAt(pickerBranch);
      if (!steps || steps.length >= 40) { app.toast("Здесь уже 40 шагов."); return; }
      expandedStep = (pickerBranch ? pickerBranch + "." : "") + steps.length;
      steps.push(makeStep(value));
      app.close();
      app.render();
      return;
    }
    if (command === "step-edit") {
      expandedStep = expandedStep === value ? "" : value;
      app.render();
      return;
    }
    if (command.startsWith("step-")) {
      const { steps, index } = address(value);
      if (!steps?.[index]) return;
      if (command === "step-delete") steps.splice(index, 1);
      else if (command === "step-copy") {
        if (steps.length >= 40) return;
        steps.splice(index + 1, 0, JSON.parse(JSON.stringify(steps[index])));
      } else {
        const next = index + (command === "step-up" ? -1 : 1);
        if (steps[next]) [steps[index], steps[next]] = [steps[next], steps[index]];
      }
      expandedStep = "";
      app.render();
    }
  }

  function sendScenario(operation) {
    if (!scenarioDraft || formOperation) return;
    if (app.send("scenario-" + operation, { scenario: scenarioDraft })) formOperation = operation;
    else app.toast("Не удалось связаться с Android.");
  }

  function input(event) {
    const control = event.target;
    if (control.matches("[data-step-search]")) {
      const query = control.value.trim().toLocaleLowerCase("ru-RU");
      const picker = control.closest(".plan-picker");
      let found = false;
      for (const group of picker.querySelectorAll("[data-step-group]")) {
        const controls = [...group.querySelectorAll("[data-plan=step-add]")];
        for (const row of controls) row.hidden = !row.textContent.toLocaleLowerCase("ru-RU").includes(query);
        group.hidden = controls.every(row => row.hidden);
        if (!group.hidden) found = true;
      }
      picker.querySelector("[data-no-step]").hidden = found;
      return;
    }
    if (control.form?.id === "plan-schedule-form" && scheduleDraft) scheduleDraft[control.name] = control.value;
    if (control.form?.id === "plan-scenario-form" && scenarioDraft) {
      if (control.dataset.step) {
        const { steps, index } = address(control.dataset.step);
        if (steps?.[index]) steps[index][control.dataset.key] = control.type === "number" ? Number(control.value) :
          control.type === "checkbox" ? control.checked : control.value;
      } else if (control.name === "name") scenarioDraft.name = control.value;
      else if (control.name === "triggers") scenarioDraft.triggers = control.value.split("\n");
    }
    const paletteForm = control.closest("#plan-palette-form");
    if (paletteForm) {
      const { hex } = paletteForm.elements;
      const sliders = [...paletteForm.querySelectorAll("[data-hsv]")];
      if (control.hasAttribute("data-hsv")) hex.value = hexFromHsv(...sliders.map(slider => Number(slider.value)));
      if (/^#[0-9a-f]{6}$/i.test(hex.value)) {
        if (control === hex) hsvFromHex(hex.value).forEach((value, i) => { sliders[i].value = value; });
        paletteForm.querySelector("[data-palette-preview]").style.setProperty("--swatch", hex.value);
      }
      return;
    }
    const key = control.dataset.style;
    if (!key || !Object.hasOwn(islandDefaults, key)) return;
    const value = control.type === "range" ? Number(control.value) : control.type === "checkbox" ? control.checked : control.value;
    applyStyle(key, value);
    const number = control.closest(".plan-range")?.querySelector('[type="number"]');
    if (number) number.value = String(value);
  }

  function styleChange(event) {
    const control = event.target;
    const key = control.dataset.numberStyle;
    if (key && Object.hasOwn(islandDefaults, key)) {
      const value = Number.isFinite(control.valueAsNumber) ?
        Number((clamp(control.valueAsNumber, Number(control.min), Number(control.max))).toFixed(key === "borderWidth" ? 1 : 0)) :
        style()[key];
      control.value = value;
      control.closest(".plan-range").querySelector('[type="range"]').value = value;
      applyStyle(key, value);
    }
    if (key || control.dataset.style) app.updateStyle();
  }

  async function submitForm(event) {
    const id = event.target.id;
    if (id === "plan-palette-form") {
      const hex = event.target.elements.hex.value;
      const key = event.target.dataset.color;
      if (Object.hasOwn(colorNames, key) && /^#[0-9a-f]{6}$/i.test(hex)) {
        applyStyle(key, hex);
        app.updateStyle();
        app.close();
        app.render();
      }
      return;
    }
    if (id === "plan-schedule-form" && scheduleDraft) app.send("schedule-save", { task: scheduleDraft });
    if (id === "plan-scenario-form") sendScenario("save");
    if (id !== "plan-ai-form" || scenarioBusy) return;
    scenarioBusy = true;
    const control = event.target.querySelector("button[type=submit]");
    control.disabled = true;
    control.textContent = "Готовлю черновик…";
    try {
      const goal = new FormData(event.target).get("goal");
      const instruction = `Составь один JSON-сценарий Android для визуального редактора. Схема {"name":"...","triggers":["..."],"steps":[...]}.
      Каждый шаг содержит kind. Типы: open (target — имя приложения), tap (target — видимая подпись), type (value — текст),
      wait (target — подпись), swipe (value — up/down/left/right), pause (seconds: 1–30),
      if (target — подпись, steps — ветка да, else — ветка нет), repeat (count: 1–10, steps),
      variable (target — имя, value — значение). Используй только эти типы. Не генерируй координаты, пароли или шаги покупки и отправки.
      Каждый параметр можно отредактировать после генерации. Верни только JSON.`;
      const result = await CortexApi.request("chat", { payload: { style: "deep", profile: "fast",
        messages: [{ role: "system", content: instruction }, { role: "user", content: String(goal) }] } });
      const text = String(result.text || "");
      const data = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
      if (!isObject(data) || !Array.isArray(data.steps) || !data.steps.length) throw new Error("ИИ не вернул подходящую схему.");
      if (app.route() === "scenarios" && !scenarioDraft) {
        scenarioDraft = scenarioFrom(data);
        app.render();
        app.toast("Проверьте шаги и сохраните сценарий.");
      }
    } catch (error) {
      app.toast(error instanceof SyntaxError ? "ИИ вернул схему, которую не удалось прочитать." : error.message);
    } finally {
      scenarioBusy = false;
      control.disabled = false;
      control.textContent = "Предложить шаги";
    }
  }

  function bind(controller) {
    app = controller;
    app.root.addEventListener("click", click);
    app.root.addEventListener("input", input);
    app.root.addEventListener("change", styleChange);
    app.root.addEventListener("submit", submitForm);
    app.root.addEventListener("pointerdown", startGesture);
    app.root.addEventListener("pointermove", moveGesture);
    app.root.addEventListener("pointerup", endGesture);
    app.root.addEventListener("pointercancel", endGesture);
  }
  function enter(route) {
    if (route === "schedule") app.send("schedule-list");
    if (route === "scenarios" && !scenarioReady) app.send("scenario-list");
  }
  function accountChanged() {
    scenarioDraft = null;
    items = [];
    scenarioReady = false;
    expandedStep = "";
    formOperation = "";
    pointPath = null;
    enter(app.route());
  }
  return { routes, page: route => pages[route](), bind, enter, handle, accountChanged, islandPresets, powers, style };
})();
