import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../app/src/main/assets/web/", import.meta.url);
const source = file => readFileSync(new URL(file, root), "utf8");

function fixture(persisted) {
  const saved = new Map(persisted ? [["cortex.interface.v2", JSON.stringify(persisted)]] : []);
  const context = vm.createContext({
    localStorage: { getItem: k => saved.get(k) ?? null, setItem: (k, v) => saved.set(k, v),
      removeItem: k => saved.delete(k) },
    Date, Math, URL, crypto: globalThis.crypto,
    window: {}, CortexApi: { available: true }, CortexIcons: name => `<svg data-icon="${name}"></svg>`,
    CortexMarkdown: { render: text => text, renderStream: text => text, webUrl: value => value },
  });
  vm.runInContext(source("model.js"), context);
  for (const file of ["subscription.js", "screens.js", "planner.js"]) vm.runInContext(source(file), context);
  vm.runInContext("globalThis.CortexTest = Cortex; globalThis.CortexUITest = CortexUI; globalThis.PlannerTest = CortexPlanner;", context);
  return { model: context.CortexTest, ui: context.CortexUITest, planner: context.PlannerTest, saved };
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
  for (const route of ["island-editor", "scenarios", "permissions", "tool-list"]) {
    assert.ok(call.includes(`data-value="${route}"`), route);
  }
  assert.doesNotMatch(call, /data-value="schedule"/);
  assert.match(ui.page("phone-tools", { permissions: { assistantSupported: true } }), /data-action="assistant-permission"/);
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

test("support links to a searchable FAQ and profile shows reminder access and quota", () => {
  const { ui } = fixture();
  const support = ui.page("support", {});
  assert.match(support, /id="support-messages"/);
  assert.match(support, /data-value="faq"/);
  assert.doesNotMatch(support, /Мои обращения|Сообщить об ошибке/);
  const faq = ui.page("faq", {});
  assert.match(faq, /aria-label="Поиск по вопросам"/);
  assert.match(faq, /Как открыть островок кнопкой «Домой»/);
  const quota = { unit: "tokens", remaining: 700, limit: 1000, reset_at: "2026-11-19T00:00:00Z" };
  const profile = ui.page("profile", { connection: { quota }, native: false });
  assert.match(profile, /<progress[^>]+value="700" max="1000"/);
  assert.match(profile, /Обновление/);
  assert.match(profile, /data-value="schedule"/);
  assert.equal(ui.parent.schedule, "profile");
  const subscription = ui.page("subscription", { connection: { quota, subscription: {
    plans: [{ code: "start", price_kopecks: 19900, daily_tokens: 4321, advanced_tokens: 765 }]
  } } });
  assert.match(subscription, /4\s321 токенов в день/);
  assert.match(subscription, /Из них 765 для продвинутых моделей/);
});

test("reminders view displays saved reminders and excludes scheduled actions from its ordinary list", () => {
  const { planner } = fixture();
  let updated = 0;
  const requests = [];
  planner.bind({ root: { addEventListener() {} }, native: true, route: () => "schedule",
    send: operation => requests.push(operation), render() { updated++; } });
  planner.enter("schedule");
  assert.deepEqual(requests, ["schedule-list"]);
  planner.handle({ type: "schedule-list", exact: true, notifications: true, tasks: [
    { id: "r", kind: "reminder", status: "scheduled", text: "Позвонить бабушке", at: 1795000000000 },
    { id: "a", kind: "action", status: "scheduled", text: "Старое поручение", at: 1795000000000 }
  ] });
  const page = planner.page("schedule");
  assert.equal(updated, 1);
  assert.match(page, /Позвонить бабушке/);
  assert.match(page, /Добавить напоминание/);
  assert.doesNotMatch(page, /Старое поручение/);
});

test("notes are retired without dropping old local records while saving other settings", () => {
  const notes = [{ id: "old", title: "Старая запись", body: "Локальный текст" }];
  const { model, ui, saved } = fixture({ notes });
  assert.equal(model.noteCommand, undefined);
  assert.equal(model.state.notes, undefined);
  assert.match(ui.page("data", {}), /Экспорт чатов/);
  assert.doesNotMatch(source("app.js"), /note-editor|note-edit|noteCommand/);
  assert.equal(model.save(), true);
  assert.deepEqual(JSON.parse(saved.get("cortex.interface.v2")).notes, notes);
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
