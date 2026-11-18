import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../app/src/main/assets/web/", import.meta.url);
const source = file => readFileSync(new URL(file, root), "utf8");

function fixture() {
  const saved = new Map();
  const context = vm.createContext({
    localStorage: { getItem: k => saved.get(k) ?? null, setItem: (k, v) => saved.set(k, v),
      removeItem: k => saved.delete(k) },
    Date, Math, URL, crypto: globalThis.crypto,
    window: {}, CortexApi: { available: true }, CortexIcons: name => `<svg data-icon="${name}"></svg>`,
    CortexMarkdown: { render: text => text, renderStream: text => text, webUrl: value => value },
  });
  vm.runInContext(source("model.js"), context);
  vm.runInContext(source("screens.js"), context);
  vm.runInContext("globalThis.CortexTest = Cortex; globalThis.CortexUITest = CortexUI;", context);
  return { model: context.CortexTest, ui: context.CortexUITest, saved };
}

test("chat composer keeps only model picker and quota below the input", () => {
  const { ui } = fixture();
  const html = ui.composer();
  assert.match(html, /class="composer-input-row"[\s\S]*?<textarea[\s\S]*?<div class="composer-send-actions"/);
  assert.match(html, /class="composer-footer"[\s\S]*?class="ai-model-picker"[\s\S]*?class="quota-ring"/);
  assert.doesNotMatch(html, /class="composer-button mic-button"/);
  assert.ok(html.includes('/favicons/nvidia.com'));
  assert.ok(!html.includes('www.google.com/s2/favicons'));
});

test("call and scenarios are primary tabs and the empty chat keeps its mark", () => {
  const { ui, model } = fixture();
  assert.deepEqual([...ui.tabs.map(item => item[0])], ["chats", "phone-tools", "home", "scenarios", "profile"]);
  const markup = ui.page("chat", { chat: model.createChat(), pending: null, error: null });
  assert.match(markup, /class="chat-empty" aria-label="CORTEX"/);
  assert.doesNotMatch(markup, /На связи|chat-empty-signal/);
});

test("call settings keep normal commands independent from beta screen control", () => {
  const { ui, model } = fixture();
  assert.equal(model.state.preferences.phoneActions, true);
  assert.equal(model.state.preferences.visualAutomation, false);
  const call = ui.page("phone-tools", { permissions: {} });
  for (const route of ["island-editor", "schedule", "scenarios", "permissions", "tool-list"]) {
    assert.ok(call.includes(`data-value="${route}"`), route);
  }
  assert.match(call, /type="checkbox" data-visual-beta/);
  assert.match(call, /data-value="phoneActions"/);
  assert.match(call, /data-value="visualLaunch"/);
  assert.match(ui.page("settings", {}), /data-value="phone-tools"/);
  assert.doesNotMatch(ui.page("data", {}), /data-value="notes"/);
  model.state.preferences.visualAutomation = true;
  assert.match(ui.page("phone-tools", { permissions: {} }), /data-visual-beta[^>]* checked/);
});

test("model feedback survives restart and affects following prompts", () => {
  const { model, saved } = fixture();
  const chat = model.createChat(true);
  chat.messages.push({ role: "user", text: "Объясни кратко" },
    { role: "assistant", text: "Слишком длинное объяснение.", feedback: "down" },
    { role: "user", text: "Расскажи иначе" });
  assert.equal(model.save(), true);
  assert.ok(saved.get("cortex.interface.v2").includes('"feedback":"down"'));
  const context = vm.createContext({ localStorage: {
    getItem: k => saved.get(k) ?? null, setItem: (k, v) => saved.set(k, v),
    removeItem: k => saved.delete(k) }, Date, Math, crypto: globalThis.crypto });
  vm.runInContext(source("model.js"), context);
  vm.runInContext("globalThis.CortexTest = Cortex", context);
  const restarted = context.CortexTest;
  assert.equal(restarted.state.chats[0].messages[1].feedback, "down");
  assert.match(JSON.stringify(restarted.turns(restarted.state.chats[0], "")), /Не понравился ответ.*Слишком длинное/);
});

test("support is a single chat and account/profile no longer repeats quotas", () => {
  const { ui, model } = fixture();
  const support = ui.page("support", {});
  assert.match(support, /id="support-messages"/);
  assert.match(support, /id="support-compose"/);
  assert.doesNotMatch(support, /Мои обращения|Сообщить об ошибке|Частые вопросы/);
  const profile = ui.page("profile", { connection: {}, native: false });
  assert.doesNotMatch(profile, /quota-panel|Токены ИИ/);
  assert.equal(model.noteCommand("создай заметку План: Проверить релиз"), "Создал заметку «План»." );
  assert.match(model.noteCommand("покажи заметки"), /Проверить релиз/);
});

test("public question coalescing never drops personalised chat context", () => {
  const { model } = fixture();
  const chat = model.createChat();
  chat.messages.push({ role: "user", text: "Что такое искусственный интеллект?" });
  assert.equal(model.canSharePublicQuestion(chat, chat.messages[0].text), true);
  assert.equal(model.canSharePublicQuestion(chat, "Что такое моя подписка?"), false);
  model.memory().entries.push({ title: "Имя", value: "Константин", enabled: true });
  assert.equal(model.canSharePublicQuestion(chat, chat.messages[0].text), false);
  model.memory().entries = [];
  chat.messages.push({ role: "assistant", text: "Пример ответа" }, { role: "user", text: "Что такое кэш?" });
  assert.equal(model.canSharePublicQuestion(chat, chat.messages.at(-1).text), false);
});
