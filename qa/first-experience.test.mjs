import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../app/src/main/assets/web/first-experience.js", import.meta.url), "utf8");

function environment({ android = true } = {}) {
  const sent = [], events = [], globalListeners = new Map(), rootListeners = new Map(), classes = new Set();
  const add = (map, name, fn) => map.set(name, [...(map.get(name) || []), fn]);
  const dispatch = (map, name, event) => { for (const fn of map.get(name) || []) fn(event); };
  let view = null;
  const submit = { disabled: false }, input = { setAttribute() {}, focus() {} };
  const root = {
    classList: { add: (...names) => names.forEach(name => classes.add(name)), remove: (...names) => names.forEach(name => classes.delete(name)), contains: name => classes.has(name) },
    append(node) { view = node; },
    addEventListener(name, fn) { add(rootListeners, name, fn); }
  };
  const nodes = new Map([["app", root]]);
  const document = {
    hidden: false, activeElement: { focus() {} },
    getElementById(name) { if (!nodes.has(name)) nodes.set(name, { inert: false }); return nodes.get(name); },
    addEventListener(name, fn) { add(globalListeners, name, fn); },
    createElement() {
      return { innerHTML: "", setAttribute() {}, remove() { view = null; }, contains: () => true,
        querySelector: query => query === '[type="submit"]' ? submit : input,
        querySelectorAll: () => [] };
    }
  };
  const window = android ? { CortexDevice: { postMessage: raw => sent.push(JSON.parse(raw)) }, CortexIslandControl: { postMessage: raw => sent.push(JSON.parse(raw)) } } : {};
  runInNewContext(source, {
    window, document, CortexUI: { esc: text => String(text).replaceAll("<", "&lt;").replaceAll('"', "&quot;") },
    CortexWave: { stop() {} },
    addEventListener(name, fn) { add(globalListeners, name, fn); },
    dispatchEvent(event) { events.push(event); dispatch(globalListeners, event.type, event); },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    setTimeout() { throw new Error("The presentation must never simulate an Android step with a timer"); },
    localStorage: { setItem() { throw new Error("Android owns persistent first-run state"); } }
  });
  return {
    api: window.CortexFirstExperience, sent, events, root, nodes, submit,
    get html() { return view?.innerHTML || ""; },
    receive(extra = {}) {
      const state = { type: "first-experience", phase: "offer", session: "session-1", active: false, ready: true,
        accessibility: true, overlay: true, brightnessPermission: true, ...extra };
      dispatch(globalListeners, "cortex-native", { data: JSON.stringify(state) });
    },
    onboarding(detail) { dispatch(globalListeners, "cortex-onboarding-end", { detail }); },
    click(action) { dispatch(rootListeners, "click", { target: { closest: () => ({ dataset: { experience: action } }) } }); },
    enter(value) { dispatch(rootListeners, "input", { target: { id: "experience-number", value } }); },
    submitNumber() { dispatch(rootListeners, "submit", { target: { id: "experience-number-form" }, preventDefault() {} }); }
  };
}

test("the web never simulates phone actions or starts a demo without Android", () => {
  const env = environment({ android: false });
  assert.equal(env.api.open(), false);
  assert.equal(env.html, "");
  assert.equal(env.sent.length, 0);
});

test("Show requests one real native session and leaves the screen in offer until Android responds", () => {
  const env = environment();
  env.receive();
  assert.match(env.html, /Убери руки с экрана/);
  env.click("start"); env.click("start");
  assert.equal(env.sent.filter(event => event.operation === "first-experience-start").length, 1);
  assert.match(env.html, /Хочешь увидеть/);
  assert.doesNotMatch(env.html, /588|Прогноз подтверждён/);
  env.receive({ phase: "running", active: true, message: "Открываю калькулятор" });
  assert.match(env.html, /Открываю калькулятор/);
});

test("incomplete setup and individual permission pages never arm automatic first experience", () => {
  const env = environment();
  env.onboarding({ configured: true, firstExperienceEligible: false });
  assert.equal(env.sent.filter(event => event.operation === "first-experience-configured").length, 0);
  env.onboarding({ configured: true, firstExperienceEligible: true });
  assert.equal(env.sent.filter(event => event.operation === "first-experience-configured").length, 1);
});

test("a native offer waits for the setup dialog to close", () => {
  const env = environment();
  env.root.classList.add("in-onboarding");
  env.receive();
  assert.equal(env.html, "");
  env.root.classList.remove("in-onboarding");
  env.onboarding({ firstExperienceEligible: false });
  assert.match(env.html, /Хочешь увидеть/);
});

test("number input accepts only whole choices 1 through 99 and submits once", () => {
  const env = environment();
  env.receive({ phase: "number", active: true });
  for (const value of ["", "0", "00", "01", "100", "-1", "1.5", "1e1", " 17", "<script>"]) {
    env.enter(value); env.submitNumber();
    assert.equal(env.submit.disabled, true);
  }
  assert.equal(env.sent.filter(event => event.operation === "first-experience-number").length, 0);
  env.enter("99");
  assert.equal(env.submit.disabled, false);
  env.submitNumber(); env.submitNumber();
  const requests = env.sent.filter(event => event.operation === "first-experience-number");
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0], { operation: "first-experience-number", session: "session-1", number: "99" });
});

test("duplicate native snapshots preserve typed number and input focus", () => {
  const env = environment();
  env.receive({ phase: "number", active: true }); env.enter("17");
  env.receive({ phase: "number", active: true }); env.submitNumber();
  assert.equal(env.sent.at(-1).number, "17");
});

test("sealed forecast contains no result and failures do not reveal a five", () => {
  const env = environment();
  env.receive({ phase: "sealed", active: true });
  assert.match(env.html, /Мой прогноз/);
  assert.doesNotMatch(env.html, />5<|ПРОГНОЗ ПОДТВЕРЖДЁН/);
  env.receive({ phase: "finish", notices: ["Вычисление не подтверждено"], predictionDone: false });
  assert.doesNotMatch(env.html, />5<|ПРОГНОЗ ПОДТВЕРЖДЁН/);
  env.receive({ phase: "reveal", predictionDone: true });
  assert.match(env.html, />5<|ПРОГНОЗ ПОДТВЕРЖДЁН/);
});

test("Back sends Stop with the current session and waits for native cleanup", () => {
  const env = environment();
  env.receive({ phase: "running", active: true });
  assert.equal(env.api.back(), true);
  assert.equal(env.sent.at(-1).operation, "first-experience-stop");
  assert.equal(env.sent.at(-1).session, "session-1");
  assert.notEqual(env.html, "");
  env.receive({ phase: "stopped", recoveryNeeded: true, brightnessPermission: false, message: "Нужно восстановить яркость" });
  assert.match(env.html, /Восстановить яркость/);
  assert.match(env.html, /Открыть настройки дисплея/);
});

test("Later consumes the offer through Android and restores the main interface", () => {
  const env = environment();
  env.receive(); env.click("later");
  assert.equal(env.sent.at(-1).operation, "first-experience-later");
  env.receive({ phase: "idle" });
  assert.equal(env.html, "");
  assert.equal(env.nodes.get("screen").inert, false);
  assert.equal(env.root.classList.contains("in-first-experience"), false);
});

test("completion requests the home screen only after the final native acknowledgement", () => {
  const env = environment();
  env.receive({ phase: "finish", predictionDone: true }); env.click("finish");
  assert.equal(env.events.length, 0);
  env.receive({ phase: "idle" });
  assert.equal(env.events.at(-1).type, "cortex-first-experience-end");
  assert.equal(env.events.at(-1).detail.finished, true);
});

test("native failure messages are escaped and do not become HTML", () => {
  const env = environment();
  env.receive({ phase: "stopped", message: '<img src="x" onerror="alert(1)">' });
  assert.doesNotMatch(env.html, /<img src="x"/);
  assert.match(env.html, /&lt;img/);
});
