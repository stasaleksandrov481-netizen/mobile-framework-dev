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
  vm.runInContext(source("subscription.js"), context);
  vm.runInContext(source("screens.js"), context);
  vm.runInContext("globalThis.CortexTest = Cortex; globalThis.CortexUITest = CortexUI;", context);
  return { model: context.CortexTest, ui: context.CortexUITest, saved };
}

test("chat composer has separate dictation and voice actions, with a compact footer", () => {
  const { ui } = fixture();
  const html = ui.composer();
  assert.match(html, /class="composer-input-row"[\s\S]*?<textarea[\s\S]*?<div class="composer-send-actions"/);
  assert.match(html, /class="composer-footer"[\s\S]*?class="ai-model-picker"[\s\S]*?class="quota-ring"/);
  assert.match(html, /class="composer-button dictate-button"[^>]*aria-label="Диктовка в поле ввода"/);
  assert.match(html, /class="composer-button voice-button"[^>]*aria-label="Голосовой разговор"/);
  assert.ok(html.includes('/favicons/nvidia.com'));
  assert.ok(!html.includes('www.google.com/s2/favicons'));
});

test("only three primary tabs and the empty chat shows a plain mark", () => {
  const { ui, model } = fixture();
  assert.deepEqual([...ui.tabs.map(item => item[0])], ["chats", "home", "profile"]);
  const markup = ui.page("chat", { chat: model.createChat(), pending: null, error: null });
  assert.match(markup, /class="chat-empty" aria-label="CORTEX"/);
  assert.doesNotMatch(markup, /На связи|chat-empty-signal/);
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

test("support has direct human forms, server inbox, FAQ and optional AI help", () => {
  const { ui, model } = fixture();
  const support = ui.page("support", { supportInboxState: "ready", supportTickets: [
    { id: "abc", category: "bug", status: "open", message: "<script>bad</script>", created_at: "2026-11-17T10:00:00Z" }
  ] });
  assert.match(support, /id="support-messages"/);
  assert.match(support, /id="support-compose"/);
  assert.match(support, /Мои обращения|Частые вопросы|data-faq/);
  for (const kind of ["contact", "bug", "idea", "complaint"]) assert.match(support, new RegExp(`data-action="support-form" data-value="${kind}"`));
  assert.match(support, /&lt;script&gt;bad&lt;\/script&gt;/);
  assert.doesNotMatch(support, /<script>bad<\/script>/);
  const profile = ui.page("profile", { connection: {}, native: false });
  assert.match(profile, /Использование ИИ/);
  assert.equal(model.noteCommand("создай заметку План: Проверить релиз"), "Создал заметку «План»." );
  assert.match(model.noteCommand("покажи заметки"), /Проверить релиз/);
});

test("phone tools, notes and detailed usage are real navigable pages", () => {
  const { ui } = fixture();
  assert.equal(ui.parent["phone-tools"], "settings");
  assert.equal(ui.parent.notes, "data");
  assert.equal(ui.parent.usage, "profile");
  assert.match(ui.page("settings", {}), /data-value="phone-tools"/);
  assert.match(ui.page("data", {}), /data-value="notes"/);
  assert.match(ui.page("phone-tools", { permissions: {} }), /Расписание|Сценарии/);
  assert.match(ui.page("notes", {}), /Создать заметку/);
});

test("weekly token chart and reset time use server quota instead of hard-coded quotas", () => {
  const { ui } = fixture();
  const quota = { id: "guest_test", unit: "tokens", used: 150, remaining: 850, limit: 1000,
    reset_at: "2026-11-18T00:00:00Z", history: Array.from({length: 7}, (_, i) => ({
      day: `2026-11-${String(11 + i).padStart(2, "0")}`, used: 100 + i * 10
    })) };
  const profile = ui.page("profile", { connection: { quota } });
  assert.match(profile, /1.0.0|Использование ИИ/);
  assert.equal((profile.match(/class="usage-day"/g) || []).length, 7);
  assert.match(profile, /03:00 МСК/);
  const detail = ui.page("usage", { connection: { quota } });
  assert.match(detail, /Статистика по данным сервера/);
  const sub = ui.page("subscription", { connection: { quota, subscription: { checkout: false, plans: [
    { code: "free", price_kopecks: 0, daily_tokens: 35000, advanced_tokens: 0 },
    { code: "pro", price_kopecks: 39900, daily_tokens: 100000, advanced_tokens: 20000 }
  ] } } });
  assert.match(sub, /Сравнить тарифы и лимиты/);
  assert.match(sub, /100\s?000 токенов\/день/u);
});

test("the first message persists even without an assistant reply; empty chats do not", () => {
  const { model, saved } = fixture();
  const blank = model.createChat();
  const first = model.createChat();
  first.messages.push({ role: "user", text: "Проверь расписание завтра" });
  first.saved = true;
  assert.equal(model.save(), true);
  const stored = JSON.parse(saved.get("cortex.interface.v2"));
  assert.equal(stored.chats.length, 1);
  assert.equal(stored.chats[0].messages[0].text, "Проверь расписание завтра");
  assert.ok(!stored.chats.some(item => item.id === blank.id));
  const app = source("app.js");
  assert.match(app, /chat\.messages\.push\(\{ role: "user", text \}\);\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*chat\.saved = true;/);
  assert.doesNotMatch(app, /M\.createChat\(true\)/);
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
