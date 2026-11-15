"use strict";

const CortexPlanner = (() => {
  const M = Cortex, U = CortexUI;
  const { esc, detail } = U;
  const routes = new Set(["schedule", "scenarios", "island-editor", "energy"]);
  const fieldTypes = {
    open: "Открыть приложение", tap: "Нажать элемент", point: "Нажать записанную точку", type: "Ввести текст",
    swipe: "Свайп", wait: "Ждать элемент", pause: "Пауза", if: "Условие", repeat: "Повторение",
    run: "Запустить сценарий", variable: "Задать переменную"
  };
  const statuses = {
    scheduled: "Запланировано", due: "Ожидает отметки", blocked: "Ожидает запуска", running: "Выполняется",
    done: "Готово", failed: "Ошибка", cancelled: "Отменено"
  };
  const directions = { down: "Вниз", up: "Вверх", left: "Влево", right: "Вправо" };
  const islandDefaults = {
    background: "#080808", text: "#ffffff", border: "#afafaf", accent: "#ffffff", faceColor: "#e5e5e5",
    opacity: 100, size: 100, offsetX: 0, offsetY: 0, corner: 22, borderWidth: .9, motion: "liquid",
    face: true, status: true, progress: true, quick: true, results: true
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
          `<label class="plan-check"><input data-step="${path}" data-key="confirm" type="checkbox" ${step.confirm ? "checked" : ""}> Подтверждать нажатие</label>`;
        case "point": return `<p class="muted">${step.package ? esc(step.target || step.package) :
          "Оставьте нужное приложение открытым за CORTEX."}</p>${action("Записать касание", "scenario-point", path)}`;
        case "type": return label("Текст для ввода", `<textarea data-step="${path}" data-key="value" rows="2" maxlength="2000" required>${esc(step.value)}</textarea>`);
        case "swipe": return label("Направление", `<select data-step="${path}" data-key="value">${options(directions, step.value)}</select>`);
        case "wait": return input("Какой элемент должен появиться");
        case "pause": return label("Секунд", inline(path, "seconds", "number", step.seconds, 'min="1" max="30" required'));
        case "if": return input("Если на экране есть элемент") + `<div class="plan-branch"><strong>Да</strong>${stepList(step.steps, path + ".steps", depth + 1)}</div>
          <div class="plan-branch"><strong>Иначе</strong>${stepList(step.else, path + ".else", depth + 1)}</div>`;
        case "repeat": return label("Количество повторов", inline(path, "count", "number", step.count, 'min="1" max="10" required')) +
          `<div class="plan-branch">${stepList(step.steps, path + ".steps", depth + 1)}</div>`;
        case "run": return label("Сценарий", `<select data-step="${path}" data-key="target" required><option value="">Выберите</option>
          ${options(Object.fromEntries(items.filter(item => item.id !== scenarioDraft.id).map(item => [item.id, item.name])), step.target)}</select>`);
        default: return input("Имя переменной", "target", 32) + label("Значение", inline(path, "value", "text", step.value, 'maxlength="2000"'));
      }
    };
    return steps.map((step, index) => {
      const path = parent ? `${parent}.${index}` : String(index);
      return `<section class="plan-step"><div class="plan-step-head"><strong>${index + 1}. ${esc(fieldTypes[step.kind])}</strong>
        <div class="plan-step-buttons">${index > 0 ? action("↑", "step-up", path, "quiet") : ""}
          ${index < steps.length - 1 ? action("↓", "step-down", path, "quiet") : ""}
          ${action("Удалить", "step-delete", path, "quiet")}</div></div>${fields(step, path)}</section>`;
    }).join("") + `<div class="plan-add"><select aria-label="Тип нового шага">${options(Object.fromEntries(Object.entries(fieldTypes)
      .filter(([kind]) => depth < 4 || !["if", "repeat"].includes(kind))), "open")}</select>${action("Добавить шаг", "step-add", parent)}</div>`;
  }

  function scenarios() {
    if (!app.native) return detail("Сценарии", "", '<p class="muted">Запуск сценариев доступен в Android-приложении.</p>');
    if (!scenarioReady && !scenarioDraft) return detail("Сценарии", "", '<p class="muted">Загружаю сценарии…</p>');
    if (scenarioDraft) return detail("Конструктор", "Сохраните схему перед запуском", `<form class="panel stack" id="plan-scenario-form">
      ${label("Название", `<input name="name" maxlength="90" required value="${esc(scenarioDraft.name)}">`)}
      ${label("Голосовые фразы, по одной в строке", `<textarea name="triggers" rows="2" maxlength="1200">${esc(scenarioDraft.triggers.join("\n"))}</textarea>`)}
      <p class="muted">Вставляйте переменную в текст или название элемента в виде \${имя}. Имена переменных задавайте латиницей.</p>
      ${stepList(scenarioDraft.steps)}
      <div class="actions">${submit("Сохранить")}${action("К списку", "scenario-close", "", "quiet")}</div>
    </form>`);
    return detail("Сценарии", "Цепочки действий для телефона", `<div class="actions">${action("Создать", "scenario-edit", "", "primary")}
      ${action("Импорт JSON", "native", "scenario-import")}${action("Журнал шагов", "native", "action-history")}</div>
      <form class="panel stack" id="plan-ai-form">
        ${label("Описать сценарий своими словами", '<textarea name="goal" rows="2" maxlength="1200" placeholder="Открой настройки и дождись раздела «Дисплей»" required></textarea>')}
        ${submit(scenarioBusy ? "Готовлю черновик…" : "Предложить шаги через ИИ")}
      </form>` + (items.length ? items.map(item => `<article class="panel plan-card">
      <h2>${esc(item.name)}</h2><p class="muted">${esc(item.triggers.join(" · ") || `Запусти сценарий «${item.name}»`)}</p>
      <div class="actions">${action("Изменить", "scenario-edit", item.id)}${action("Тестовый запуск", "scenario-run", item.id, "primary")}
        ${action("Копировать", "scenario-copy", item.id, "quiet")}${action("Экспорт", "scenario-export", item.id, "quiet")}
        ${action("Удалить", "scenario-delete", item.id, "quiet")}</div></article>`).join("") :
      `<p class="muted">${scenarioReady ? "Сохранённых сценариев пока нет." : "Загружаю сценарии…"}</p>`));
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
    return value;
  }

  function preview() {
    const data = style();
    const size = Math.max(80, Math.min(125, data.size));
    return `<span class="plan-camera"></span>
      <div class="plan-island-wrap" style="transform:translate(${Math.max(-50, Math.min(50, data.offsetX)) / 2}px,${Math.max(0, Math.min(80, data.offsetY)) / 3}px)">
        ${data.face ? `<span class="plan-face" style="background:${data.faceColor};color:${data.background}">•ᴗ•</span>` : ""}
        <div class="plan-island-sample" style="--island-bg:${data.background};--island-text:${data.text};--island-style-border:${data.border};
          --island-accent:${data.accent};--island-opacity:${Math.max(40, Math.min(100, data.opacity))}%;--island-size:${size}%;
          --island-radius:${Math.max(12, Math.min(32, data.corner))}px;--island-weight:${Math.max(0, Math.min(3, data.borderWidth))}px">
          <span class="plan-logo" aria-hidden="true"></span>${data.status ? "<span>Слушаю…</span>" : ""}
          ${data.progress ? '<i aria-hidden="true"></i>' : ""}</div>
      </div>`;
  }

  function islandEditor() {
    const data = style();
    const slider = (key, text, min, max, increments = 1) => `<label class="field plan-range">
      <span>${esc(text)}<output>${esc(data[key])}</output></span>
      <input type="range" aria-label="${esc(text)}" min="${min}" max="${max}" step="${increments}" data-style="${key}" value="${esc(data[key])}">
    </label>`;
    const color = (key, text) => label(text, `<input type="color" data-style="${key}" value="${esc(data[key])}">`);
    const widget = (key, text) => `<label class="plan-check"><input type="checkbox" data-style="${key}" ${data[key] ? "checked" : ""}> ${esc(text)}</label>`;
    return detail("Оформление островка", "", `<div class="plan-island-preview" data-island-preview aria-label="Предпросмотр островка">${preview()}</div>
      <div class="actions">${Object.keys(islandPresets).map(title => action(title, "island-preset", title)).join("")}</div>
      <section class="panel stack"><h2>Положение и форма</h2>${slider("size", "Размер", 80, 125)}
        ${slider("offsetX", "Сдвиг влево и вправо", -75, 75)}${slider("offsetY", "Сдвиг вниз", 0, 80)}
        ${slider("corner", "Скругление", 12, 32)}${slider("borderWidth", "Толщина границы", 0, 3, .1)}
        ${slider("opacity", "Непрозрачность", 40, 100)}
        ${label("Анимация", `<select data-style="motion">${options({ liquid: "Плавная", soft: "Короткая", none: "Мгновенная" }, data.motion)}</select>`)}</section>
      <section class="panel stack"><h2>Цвета</h2><div class="plan-color-grid">${color("background", "Фон")}${color("text", "Текст")}
        ${color("border", "Граница")}${color("accent", "Прогресс")}${color("faceColor", "Смайлик")}</div></section>
      <section class="panel stack"><h2>Виджеты</h2>${widget("face", "Смайлик со статусом")}${widget("status", "Статус")}
        ${widget("progress", "Полоса прогресса")}${widget("quick", "Быстрые команды")}${widget("results", "Результат действий")}</section>`);
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
        if (message.ok && message.operation === "save") { scenarioDraft = null; if (app.route() === "scenarios") app.render(); }
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
      if (command === "scenario-copy") {
        scenarioDraft.name = (scenarioDraft.name + " · копия").slice(0, 90);
        scenarioDraft.triggers = [];
      }
      app.render();
      return;
    }
    if (command === "scenario-close") { scenarioDraft = null; app.render(); return; }
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
    if (command === "island-preset" && Object.hasOwn(islandPresets, value)) {
      M.state.islandStyle = { ...islandPresets[value] };
      app.updateStyle(); app.render(); return;
    }
    if (command === "power") { app.power(value); return; }
    if (command === "step-add") {
      const steps = stepsAt(value);
      if (steps && steps.length < 40) steps.push(makeStep(control.previousElementSibling.value));
      app.render();
      return;
    }
    if (command.startsWith("step-")) {
      const { steps, index } = address(value);
      if (!steps?.[index]) return;
      if (command === "step-delete") steps.splice(index, 1);
      else {
        const next = index + (command === "step-up" ? -1 : 1);
        if (steps[next]) [steps[index], steps[next]] = [steps[next], steps[index]];
      }
      app.render();
    }
  }

  function input(event) {
    const control = event.target;
    if (control.form?.id === "plan-schedule-form" && scheduleDraft) scheduleDraft[control.name] = control.value;
    if (control.form?.id === "plan-scenario-form" && scenarioDraft) {
      if (control.dataset.step) {
        const { steps, index } = address(control.dataset.step);
        if (steps?.[index]) steps[index][control.dataset.key] = control.type === "number" ? Number(control.value) :
          control.type === "checkbox" ? control.checked : control.value;
      } else if (control.name === "name") scenarioDraft.name = control.value;
      else if (control.name === "triggers") scenarioDraft.triggers = control.value.split("\n");
    }
    const key = control.dataset.style;
    if (!key || !Object.hasOwn(islandDefaults, key)) return;
    const value = control.type === "range" ? Number(control.value) : control.type === "checkbox" ? control.checked : control.value;
    M.state.islandStyle = { ...style(), [key]: value };
    const output = control.closest("label")?.querySelector("output");
    if (output) output.value = String(value);
    const sample = document.querySelector("[data-island-preview]");
    if (sample) sample.innerHTML = preview();
  }

  async function submitForm(event) {
    const id = event.target.id;
    if (id === "plan-schedule-form" && scheduleDraft) app.send("schedule-save", { task: scheduleDraft });
    if (id === "plan-scenario-form" && scenarioDraft) app.send("scenario-save", { scenario: scenarioDraft });
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
      control.textContent = "Предложить шаги через ИИ";
    }
  }

  function bind(controller) {
    app = controller;
    app.root.addEventListener("click", click);
    app.root.addEventListener("input", input);
    app.root.addEventListener("change", event => { if (event.target.dataset.style) app.updateStyle(); });
    app.root.addEventListener("submit", submitForm);
  }
  function enter(route) {
    if (route === "schedule") app.send("schedule-list");
    if (route === "scenarios" && !scenarioReady) app.send("scenario-list");
  }
  return { routes, page: route => pages[route](), bind, enter, handle, islandPresets, powers, style };
})();
