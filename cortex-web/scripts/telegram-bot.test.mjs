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
  assert.equal(h.calls[0].method, "sendPhoto");
  assert.doesNotMatch(JSON.stringify(h.calls), new RegExp(secret));
  assert.match(h.calls[0].args.caption, /успешно привязан/);
});
test("Main menu uses official colored button styles, no fake premium IDs", async () => {
  const h = harness();
  await processCortexBotUpdate(message("/start"), h.services);
  const payload = h.calls[0].args;
  assert.equal(h.calls[0].method, "sendPhoto");
  assert.equal(payload.photo, "https://cortexapp.ru/telegram/welcome.jpg");
  assert.match(payload.caption, /Привет, Tester/);
  assert.equal(payload.parse_mode, "HTML");
  assert.ok(payload.reply_markup.inline_keyboard.flat().some(b => b.style === "primary"));
  assert.equal(payload.reply_markup.inline_keyboard[0].length, 1);
  assert.deepEqual(payload.reply_markup.inline_keyboard.map(r => r.length), [1,2,2,1]);
  assert.match(payload.reply_markup.inline_keyboard[0][0].text, /🔗/);
  assert.ok(payload.reply_markup.inline_keyboard.flat().every(b => !b.icon_custom_emoji_id));
  assert.ok(payload.reply_markup.inline_keyboard.flat().every(b => !b.url || /^https:\/\/(?:cortexapp\.ru|t\.me)\//.test(b.url)));
});
test("Premium emoji require explicit safe IDs and an enabled flag", async () => {
  const h = harness();
  await processCortexBotUpdate(message("/menu"), h.services,
    { enabled: true, brand: "5368324170671202286", account: "5368324170671202286" });
  await processCortexBotUpdate(message("/account", 105), h.services, { enabled: true, brand: "5368324170671202286", account: "5368324170671202286" });
  assert.match(h.calls[0].args.caption, /tg-emoji/);
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
  assert.match(h.calls[0].args.text, /Подключение активно/);
  assert.doesNotMatch(JSON.stringify(h.calls), /@example|balance|user_id|quota/);
});
test("Bot commands include payment support without administrative or grant operations", () => {
  assert.ok(botCommands.some(c => c.command === "paysupport"));
  assert.ok(botCommands.every(c => !/(admin|grant|refund)/.test(c.command)));
});

test("Photo menu updates its caption without sending a second photo", async () => {
  const h = harness();
  await processCortexBotUpdate({ update_id: 113, callback_query: { id: "photo-callback", data: "cortex:pay",
    from: { id: user }, message: { chat, message_id: 99, photo: [{ file_id: "photo" }] } } }, h.services);
  assert.deepEqual(h.calls.map(c => c.method), ["answerCallbackQuery", "editMessageCaption"]);
  assert.match(h.calls[1].args.caption, /Telegram Stars/);
});
test("Photo failure leaves a fully functional text menu", async () => {
  const h = harness();
  const call = h.services.telegram;
  h.services.telegram = async (method,args) => { if (method === "sendPhoto") throw Error("photo unavailable"); return call(method,args); };
  await processCortexBotUpdate(message("/start"), h.services);
  assert.equal(h.calls[0].method, "sendMessage");
  assert.match(h.calls[0].args.text, /Привет, Tester/);
});

test("Linked home promotes dashboard and keeps payment neutral", async () => {
 const h=harness(); h.setLinked(true); await processCortexBotUpdate(message("/start"), h.services);
 const rows=h.calls[0].args.reply_markup.inline_keyboard;
 assert.equal(rows[0][0].style,"success"); assert.equal(rows[0][0].callback_data,"cortex:account");
 assert.equal(rows[1][1].style,undefined); assert.match(h.calls[0].args.caption,/Аккаунт подключён/);
});
test("Personal greetings escape hostile HTML", async () => {
 const h=harness(); const m=message("/start"); m.message.from.first_name='<b>A&B</b>';
 await processCortexBotUpdate(m,h.services); assert.match(h.calls[0].args.caption,/&lt;b&gt;A&amp;B&lt;\/b&gt;/);
});
test("Rich guide uses supported HTML blocks and only safe direct URL actions", async () => {
 const h=harness(); await processCortexBotUpdate(message("/help"),h.services);
 assert.equal(h.calls[0].method,"sendRichMessage"); assert.match(h.calls[0].args.rich_message.html,/<details>/);
 assert.match(h.calls[0].args.rich_message.html, /<tg-button type="copy_text" style="link"/);
 assert.match(h.calls[0].args.rich_message.html, /<tg-button-row>/);
 assert.equal(h.calls[0].args.reply_markup, undefined);
});
test("Rich guide gracefully falls back", async () => {
 const h=harness(),call=h.services.telegram; h.services.telegram=async(m,a)=>{if(m==="sendRichMessage")throw Error("unavailable");return call(m,a)};
 await processCortexBotUpdate(message("/help"),h.services); assert.equal(h.calls[0].method,"sendMessage");
});
test("Unrecognized plain text does not pretend to be an AI chat", async () => {
 const h=harness(); await processCortexBotUpdate(message("Привет"),h.services);
 assert.match(h.calls[0].args.text,/Для диалога с ИИ/);
});

test("iOS custom emoji cover all home buttons when enabled", async () => {
 const h=harness(); await processCortexBotUpdate(message("/start"),h.services,{enabled:true});
 const args=h.calls[0].args,rows=args.reply_markup.inline_keyboard.flat();
 assert.equal(rows.length,6);
 assert.ok(rows.every(b=>typeof b.icon_custom_emoji_id==="string" && /^\d{19}$/.test(b.icon_custom_emoji_id)));
 assert.equal(rows[0].icon_custom_emoji_id,"6028171274939797252");
 assert.match(args.caption,/tg-emoji emoji-id="5890925363067886150"/);
});
test("Premium rejected by provider: retry same method with safe ordinary icons", async () => {
 const h=harness(), call=h.services.telegram; let rejects=0;
 h.services.telegram=async(m,a)=>{
   if (JSON.stringify(a).match(/tg-emoji|icon_custom_emoji_id/)) {rejects++;throw Object.assign(Error("bad request"),{status:400});}
   return call(m,a);
 };
 await processCortexBotUpdate(message("/start"),h.services,{enabled:true});
 assert.equal(rejects,1); assert.equal(h.calls[0].method,"sendPhoto");
 assert.doesNotMatch(JSON.stringify(h.calls),/tg-emoji|icon_custom_emoji_id/);
 assert.match(h.calls[0].args.reply_markup.inline_keyboard[0][0].text,/🔗/);
});

test("Support includes a native copy button with no other action", async () => {
 const h=harness(); await processCortexBotUpdate(message("/support"),h.services,{enabled:true});
 const b=h.calls[0].args.reply_markup.inline_keyboard.flat().find(b=>b.copy_text);
 assert.deepEqual(b.copy_text,{text:"support@cortexapp.ru"}); assert.equal(b.url,undefined); assert.equal(b.callback_data,undefined);
});
test("Commercial greeting has no filler or long dashes", async () => {
 const h=harness(); await processCortexBotUpdate(message("/start"),h.services);
 assert.match(h.calls[0].args.caption,/Уже пользуешься CORTEX/); assert.doesNotMatch(h.calls[0].args.caption,/—|цифровой центр|под рукой/);
});
test("FAQ opens rich content directly from support callback", async () => {
 const h=harness(); await processCortexBotUpdate({update_id:145,callback_query:{id:"faq",data:"cortex:help",from:{id:user},message:{chat,message_id:99,photo:[{file_id:"photo"}]}}},h.services);
 assert.deepEqual(h.calls.map(c=>c.method),["answerCallbackQuery","sendRichMessage"]);
});
