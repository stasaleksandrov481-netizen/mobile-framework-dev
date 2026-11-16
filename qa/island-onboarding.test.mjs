import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const setupSource = readFileSync(new URL("../app/src/main/assets/web/setup.js", import.meta.url), "utf8");
const plannerSource = readFileSync(new URL("../app/src/main/assets/web/planner.js", import.meta.url), "utf8");
const panelSource = readFileSync(new URL("../app/src/main/java/app/cortex/assistant/IslandConversationPanel.kt", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../app/src/main/assets/web/app.js", import.meta.url), "utf8");

function environment() {
  const listeners = new Map();
  const notifications = [];
  const state = { preferences: { energy: "balanced", addressName: "", reduceMotion: true }, islandStyle: {} };
  let intro = null;
  const root = {
    classList: { add() {}, remove() {} },
    addEventListener(name, fn) { listeners.set(name, fn); },
    dispatchEvent(event) {
      notifications.push(event);
      if (event.type === "cortex-onboarding-energy") state.preferences.energy = event.detail.mode;
      listeners.get(event.type)?.(event);
      return true;
    },
    append(value) { intro = value; }
  };
  const nodes = new Map([["app", root]]);
  const document = {
    getElementById(name) {
      if (!nodes.has(name)) nodes.set(name, { inert: false });
      return nodes.get(name);
    },
    createElement() {
      const content = { scrollTop: 0, animate() {} };
      return {
        innerHTML: "", className: "", setAttribute() {}, remove() { intro = null; },
        contains() { return true; },
        querySelector(selector) { return selector === ".intro-content" ? content : null; }
      };
    }
  };
  const window = {
    CortexDevice: { postMessage() {} },
    CortexIslandControl: { postMessage() {} }
  };
  const context = {
    document, window,
    Cortex: { state, save() { return true; } },
    CortexUI: { icon: () => "<svg></svg>", esc: value => String(value ?? "") },
    CortexPlanner: {
      powers: { economy: ["Экономный", ""], balanced: ["Сбалансированный", ""], maximum: ["Максимальный", ""] },
      islandPresets: { "Монохром": { background: "#080808", border: "#ffffff", text: "#ffffff" } },
      style: () => state.islandStyle
    },
    CortexWave: { stop() {} },
    matchMedia: () => ({ matches: true }),
    localStorage: { setItem() {}, getItem() { return null; } },
    Event: class { constructor(type) { this.type = type; } },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    dispatchEvent() {},
    setTimeout: () => 1,
    clearTimeout() {}
  };
  runInNewContext(setupSource, context, { filename: "setup.js" });
  return {
    setup: context.window.CortexSetup,
    state, notifications,
    get html() { return intro?.innerHTML || ""; },
    click(action, extra = {}) {
      const target = { dataset: { introAction: action, ...extra } };
      listeners.get("click")({ target: { closest: () => target } });
    }
  };
}

test("first run is concise and contains no simulated phone execution", () => {
  const env = environment();
  env.setup.start();
  assert.match(env.html, /От команды/);
  assert.match(env.html, /ПРИМЕР КОМАНДЫ/);
  assert.match(env.html, /1 \/ 7/);
  assert.doesNotMatch(env.html, /Показать пример|Фонарик включён|Повторить пример/);
  env.click("next");
  assert.match(env.html, /Микрофон/);
});

test("finishing first run commits native energy and keeps island appearance automatic", () => {
  const env = environment();
  env.setup.start();
  for (let index = 0; index < 5; index++) env.click("next");
  assert.match(env.html, /Настроим под вас/);
  assert.doesNotMatch(env.html, /data-intro-action="style"/);
  env.click("next");
  assert.match(env.html, /Готовы начать/);
  env.click("mode", { mode: "maximum" });
  assert.equal(env.state.preferences.energy, "maximum");
  env.click("next");
  assert.ok(env.notifications.some(event => event.type === "cortex-onboarding-energy" && event.detail.mode === "maximum"));
  assert.equal(env.notifications.filter(event => event.type === "cortex-onboarding-style").length, 1);
  assert.equal(env.html, "");
});

test("the preselected balanced mode is applied even if the user does not tap it", () => {
  const env = environment();
  env.setup.start();
  for (let index = 0; index < 6; index++) env.click("next");
  assert.match(env.html, /Сбалансированный/);
  env.click("next");
  assert.ok(env.notifications.some(event =>
    event.type === "cortex-onboarding-energy" && event.detail.mode === "balanced"));
});

test("the compact island has no canned facts or battery indicators", () => {
  assert.doesNotMatch(panelSource, /Сколько заряда\?|Сколько времени\?|Сейчас играет аудио|Заряд \$it%/);
  assert.doesNotMatch(plannerSource, /Быстрые команды|Заряд устройства|Индикатор воспроизведения/);
  assert.match(appSource, /cortex-onboarding-energy/);
  assert.match(appSource, /cortex-onboarding-style/);
});
