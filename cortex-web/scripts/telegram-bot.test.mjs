import test from "node:test";
import assert from "node:assert/strict";
import { parseBotCommand, processCortexBotUpdate, botCommands } from "../lib/telegram-bot.ts";

const user = 723456789, chat = { id: user, type: "private" };
function message(text, update_id = 100) {
  return { update_id, message: { chat, from: { id: user, username: "cortexuser", first_name: "Tester" }, text } };
}
function harness() {
  const calls = [], confirmations = [];
  let linked = false, allowed = true;
  const services = {
    claim: async (updateId, chatId) => { assert.equal(chatId, user); return allowed && updateId > 0; },
    linked: async id => { assert.equal(id, user); return linked; },
    verifyLink: async (hash, person) => { confirmations.push({ hash, person }); return true; },
    telegram: async (method, args) => { calls.push({ method, args }); return true; },
  };
  return { calls, confirmations, services, setLinked: b => { linked = b; }, setAllowed: b => { allowed = b; } };
}
test("A link code is bounded, random-shaped and never reflected in bot response", async () => {
  const h = harness(), secret = "x".repeat(43);
  assert.deepEqual(parseBotCommand("/start link_" + secret), { page: "link", linkCode: secret });
  assert.equal(await processCortexBotUpdate(message("/start link_" + secret), h.services), 200);
  assert.equal(h.confirmations.length, 1);
  assert.equal(h.confirmations[0].hash.length, 64);
  assert.equal(h.confirmations[0].person.username, "cortexuser");
  assert.equal(h.calls[0].method, "sendMessage");
  assert.doesNotMatch(JSON.stringify(h.calls), new RegExp(secret));
  assert.match(h.calls[0].args.text, /успешно привязан/);
});
test("Main menu uses official colored button styles, no fake premium IDs", async () => {
  const h = harness();
  await processCortexBotUpdate(message("/start"), h.services);
  const payload = h.calls[0].args;
  assert.equal(payload.parse_mode, "HTML");
  assert.ok(payload.reply_markup.inline_keyboard.flat().some(b => b.style === "primary"));
  assert.ok(payload.reply_markup.inline_keyboard.flat().some(b => b.style === "success"));
  assert.ok(payload.reply_markup.inline_keyboard.flat().every(b => !b.icon_custom_emoji_id));
  assert.ok(payload.reply_markup.inline_keyboard.flat().every(b => !b.url || /^https:\/\/(?:cortexapp\.ru|t\.me)\//.test(b.url)));
});
test("Premium emoji require explicit safe IDs and an enabled flag", async () => {
  const h = harness();
  await processCortexBotUpdate(message("/menu"), h.services,
    { enabled: true, brand: "5368324170671202286", account: "5368324170671202286" });
  assert.match(h.calls[0].args.text, /tg-emoji/);
  assert.ok(h.calls[0].args.reply_markup.inline_keyboard.flat().some(b => b.icon_custom_emoji_id));
});
test("Callbacks are acknowledged and menus edited, never charged", async () => {
  const h = harness();
  const update = { update_id: 101, callback_query: { id: "callback-1", data: "cortex:pay",
    from: { id: user }, message: { chat, message_id: 91 } } };
  assert.equal(await processCortexBotUpdate(update, h.services), 200);
  assert.deepEqual(h.calls.map(c => c.method), ["answerCallbackQuery", "editMessageText"]);
  assert.match(h.calls[1].args.text, /Telegram Stars/);
});
test("Groups, forged chat senders and duplicate events have no private effects", async () => {
  const h = harness();
  await processCortexBotUpdate({ update_id: 102,
    message: { chat: { id: -100123, type: "supergroup" }, from: { id: user }, text: "/account" } }, h.services);
  assert.equal(h.calls.length, 0);
  h.setAllowed(false);
  await processCortexBotUpdate(message("/menu", 104), h.services);
  assert.equal(h.calls.length, 0);
});
test("Linked Telegram status only exposes link existence, never an email or quota", async () => {
  const h = harness();h.setLinked(true);
  await processCortexBotUpdate(message("/status"), h.services);
  assert.match(h.calls[0].args.text, /привязан/);
  assert.doesNotMatch(JSON.stringify(h.calls), /@example|balance|user_id|quota/);
});
test("Bot commands include payment support without administrative or grant operations", () => {
  assert.ok(botCommands.some(c => c.command === "paysupport"));
  assert.ok(botCommands.every(c => !/(admin|grant|refund)/.test(c.command)));
});
