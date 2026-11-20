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

test("recent native app commands inform pronouns but not private messages", () => {
  const { model } = fixture();
  const chat = model.createChat();
  chat.messages = [
    { role: "user", text: "Открой YouTube", local: true },
    { role: "assistant", text: "Android подтвердил открытие", local: true },
    { role: "user", text: "Напиши другу секрет: 123456", local: true },
    { role: "assistant", text: "Не подтверждено", local: true },
    { role: "user", text: "Почему он открылся?" }
  ];
  const context = model.turns(chat, "");
  assert.match(context[0].content, /Недавно пользователь просил открыть приложения.*YouTube/);
  assert.doesNotMatch(context[0].content, /Напиши другу секрет/);
  assert.equal(context.at(-1).content, "Почему он открылся?");
});

test("composer has no model picker; models live on their own page with bundled logos", () => {
  const { ui } = fixture();
  const html = ui.composer();
  assert.match(html, /class="composer-input-row"[\s\S]*?<textarea[\s\S]*?<div class="composer-send-actions"/);
  assert.match(html, /class="composer-footer"[\s\S]*?class="quota-ring"/);
  assert.doesNotMatch(html, /ai-model-picker|ai-model-option/);
  assert.doesNotMatch(html, /class="composer-button mic-button"/);
  const models = ui.page("ai-models", {});
  assert.match(models, /role="radiogroup"/);
  assert.ok(models.includes('art/ai/nvidia.svg'));
  assert.ok(models.includes('art/ai/claude.svg'));
  assert.ok(!models.includes('/favicons/') && !html.includes('/favicons/'));
  assert.ok(!models.includes('www.google.com/s2/favicons'));
});

test("usage numbers appear only in the ring sheet, with escaped values", () => {
  const { ui } = fixture();
  const sheet = ui.usageSheet({ unit: "tokens", plan: "pro", limit: 100000, remaining: 25000, reset_at: "2026-11-21T00:00:00Z" });
  assert.match(sheet, /25&nbsp;000|25\s000/);
  assert.match(sheet, /Pro/);
  assert.match(sheet, />25%</);
  assert.doesNotMatch(ui.usageSheet({ unit: "tokens", plan: "<img src=x>", limit: -1, remaining: "x" }), /<img/);
  assert.doesNotMatch(ui.page("profile", { connection: { quota: { unit: "tokens", limit: 5, remaining: 1 } } }), /cortex-quota-card/);
});

test("call and scenarios are primary tabs and the empty chat keeps its mark", () => {
  const { ui, model } = fixture();
  assert.deepEqual([...ui.tabs.map(item => item[0])], ["chats", "phone-tools", "home", "scenarios", "profile"]);
  const markup = ui.page("chat", { chat: model.createChat(), pending: null, error: null });
  assert.match(markup, /class="chat-empty" aria-label="CORTEX"/);
  assert.doesNotMatch(markup, /На связи|chat-empty-signal/);
});

test("a clarification offers reply and dismiss only while it is the latest turn", () => {
  const { ui, model, saved } = fixture();
  const chat = model.createChat(true);
  chat.messages.push({ role: "assistant", text: "В каком браузере открыть сайт?",
    local: true, clarification: { id: "local-task-id" } });
  const markup = () => ui.page("chat", { chat, pending: null, error: null });
  assert.match(markup(), /class="clarification-panel"/);
  assert.match(markup(), /data-action="clarification-focus"/);
  assert.match(markup(), /data-action="clarification-dismiss"/);
  model.save();
  assert.doesNotMatch(saved.get("cortex.interface.v2"), /local-task-id/);
  chat.messages.push({ role: "user", text: "В Chrome." });
  assert.doesNotMatch(markup(), /class="clarification-panel"/);
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
  // Owner decision 2026-11-20: usage is shown only in the composer ring sheet.
  assert.doesNotMatch(profile, /<progress|Лимит ИИ/);
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

test("legacy role and instructions stay out of replies and offline AI has a dedicated message", () => {
  const { model, ui } = fixture({
    edits: { cortex: { tone: "Спокойный", description: "OLD_ROLE" } },
    instructions: { cortex: { goal: "OLD_RULE" } }
  });
  const chat = model.createChat();
  chat.messages.push({ role: "user", text: "Привет!" });
  assert.doesNotMatch(JSON.stringify(model.turns(chat, "")), /OLD_ROLE|OLD_RULE/);
  assert.doesNotMatch(ui.page("memory", {}), /data-value="instructions"/);
  assert.doesNotMatch(ui.page("personality", {}), />Роль</);
  assert.match(ui.page("chat", { chat, error: { code: "offline" } }), /Нет подключения к ИИ/);
});
