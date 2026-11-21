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
  const catalog = {plans:[{code:"guest",daily_tokens:1,advanced_tokens:0,price_kopecks:0},{code:"free",daily_tokens:15000,advanced_tokens:0,price_kopecks:0},{code:"start",daily_tokens:50000,advanced_tokens:10000,price_kopecks:19900},{code:"pro",daily_tokens:100000,advanced_tokens:25000,price_kopecks:49900},{code:"ultra",daily_tokens:250000,advanced_tokens:100000,price_kopecks:99900}],stars:[{plan:"start",stars:100,enabled:true},{plan:"pro",stars:250,enabled:true},{plan:"ultra",stars:500,enabled:false}],starsEnabled:true};
  const services = {
    catalog: async()=>catalog,
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
  assert.deepEqual(payload.reply_markup.inline_keyboard.map(r => r.length), [1,1,2,1]);
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
  assert.match(h.calls[1].args.rich_message.html, /Тарифы CORTEX/);
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

test("Photo menu opens a dedicated text screen and removes old controls", async () => {
  const h = harness();
  await processCortexBotUpdate({ update_id: 113, callback_query: { id: "photo-callback", data: "cortex:pay",
    from: { id: user }, message: { chat, message_id: 99, photo: [{ file_id: "photo" }] } } }, h.services);
  assert.deepEqual(h.calls.map(c => c.method), ["answerCallbackQuery", "sendRichMessage", "editMessageReplyMarkup"]);
  assert.match(h.calls[1].args.rich_message.html, /Тарифы CORTEX/);
  assert.deepEqual(h.calls[2].args.reply_markup.inline_keyboard,[]);
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
 assert.equal(rows[1][0].callback_data,"cortex:plans"); assert.match(h.calls[0].args.caption,/Аккаунт подключён/);
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
 assert.ok(h.calls[0].args.reply_markup.inline_keyboard.length);
});
test("Rich guide gracefully falls back", async () => {
 const h=harness(),call=h.services.telegram; h.services.telegram=async(m,a)=>{if(m==="sendRichMessage")throw Object.assign(Error("unavailable"),{status:400});return call(m,a)};
 await processCortexBotUpdate(message("/help"),h.services); assert.equal(h.calls[0].method,"sendMessage");
});
test("Unrecognized plain text does not pretend to be an AI chat", async () => {
 const h=harness(); await processCortexBotUpdate(message("Привет"),h.services);
 assert.match(h.calls[0].args.text,/Для диалога с ИИ/);
});

test("iOS custom emoji cover all home buttons when enabled", async () => {
 const h=harness(); await processCortexBotUpdate(message("/start"),h.services,{enabled:true});
 const args=h.calls[0].args,rows=args.reply_markup.inline_keyboard.flat();
 assert.equal(rows.length,5);
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
 assert.deepEqual(h.calls.map(c=>c.method),["answerCallbackQuery","sendRichMessage","editMessageReplyMarkup"]);
});

test("Catalog is real-data-driven, excludes guest, and uses rich comparison",async()=>{
 const h=harness();await processCortexBotUpdate(message("/plans"),h.services);
 assert.equal(h.calls[0].method,"sendRichMessage");
 const html=h.calls[0].args.rich_message.html;
 assert.match(html,/<table compact>/);assert.match(html,/Ultra/);assert.match(html,/250/);assert.match(html,/Недоступно/);assert.doesNotMatch(html,/guest/i);
 assert.ok(h.calls[0].args.reply_markup.inline_keyboard.flat().some(b=>b.callback_data==="cortex:plan_pro"));
});
test("Plan selection has exact in-bot checkout action, without invoice creation",async()=>{
 const h=harness();await processCortexBotUpdate({update_id:150,callback_query:{id:"plan",data:"cortex:plan_pro",from:{id:user},message:{chat,message_id:27}}},h.services);
 assert.equal(h.calls[1].method,"editMessageText");
 assert.match(h.calls[1].args.text,/CORTEX Pro/);assert.ok(h.calls[1].args.reply_markup.inline_keyboard.flat().some(b=>b.callback_data==="cortex:buy_pro"));
 assert.ok(h.calls.every(c=>c.method!=="sendInvoice"&&c.method!=="createInvoiceLink"));
});
test("Unavailable catalog shows no invented numbers or checkout",async()=>{
 const h=harness();h.services.catalog=async()=>null;await processCortexBotUpdate(message("/plans"),h.services);
 assert.match(h.calls[0].args.text,/Не получилось загрузить каталог/);
 assert.doesNotMatch(JSON.stringify(h.calls),/payment\?plan|stars.*[0-9]/);
});
test("Token store never promises an unsupported purchase",async()=>{
 const h=harness();await processCortexBotUpdate(message("/tokens"),h.services);
 assert.match(h.calls[0].args.text,/пока нельзя купить/);assert.ok(h.calls[0].args.reply_markup.inline_keyboard.flat().every(b=>!b.url?.includes("/payment")));
});
test("Rich catalog error falls back to real plain prices and same controls",async()=>{
 const h=harness(),call=h.services.telegram;h.services.telegram=async(m,a)=>{if(m==="sendRichMessage")throw Object.assign(Error("bad rich"),{status:400});return call(m,a)};
 await processCortexBotUpdate(message("/plans"),h.services);
 assert.equal(h.calls[0].method,"sendMessage");assert.match(h.calls[0].args.text,/Pro.*250/);
 assert.ok(h.calls[0].args.reply_markup.inline_keyboard.flat().some(b=>b.callback_data==="cortex:plan_pro"));
});

test("Rich production menu embeds controls and welcome media with no external keyboard",async()=>{
 const h=harness();h.services.richUi=true;await processCortexBotUpdate(message("/start"),h.services,{enabled:true});
 assert.equal(h.calls[0].method,"sendRichMessage");const a=h.calls[0].args;
 assert.equal(a.reply_markup,undefined);assert.match(a.rich_message.markdown,/!\[\]\(https:\/\/cortexapp\.ru\/telegram\/welcome\.jpg\)/);
 assert.match(a.rich_message.markdown,/<tg-button type="callback_data" data="cortex:plans" style="primary">/);
 assert.match(a.rich_message.markdown,/<tg-emoji emoji-id="/);
 assert.match(a.rich_message.markdown,/<tg-button-row align="left">/);
});
test("Rich prices use same catalog and embedded plan details",async()=>{
 const h=harness();h.services.richUi=true;await processCortexBotUpdate(message("/plans"),h.services);
 const a=h.calls[0].args;assert.equal(a.reply_markup,undefined);
 assert.match(a.rich_message.markdown,/\| Тариф \| Токенов\/день \| Цена \|/);
 assert.match(a.rich_message.markdown,/<details><summary>Pro · 250 ⭐/);
 assert.match(a.rich_message.markdown,/data="cortex:plan_pro"/);
});
test("Rich callbacks edit one existing screen without an attached keyboard",async()=>{
 const h=harness();h.services.richUi=true;await processCortexBotUpdate({update_id:159,callback_query:{id:"rich",data:"cortex:plan_pro",from:{id:user},message:{chat,message_id:25}}},h.services);
 assert.deepEqual(h.calls.map(c=>c.method),["answerCallbackQuery","editMessageText"]);
 const a=h.calls[1].args;assert.deepEqual(a.reply_markup.inline_keyboard,[]);
 assert.match(a.rich_message.markdown,/data="cortex:buy_pro"/);
});
test("Rich support provides inline email copy and links",async()=>{
 const h=harness();h.services.richUi=true;await processCortexBotUpdate(message("/support"),h.services);
 const a=h.calls[0].args;assert.match(a.rich_message.markdown,/<code>support@cortexapp\.ru<\/code> <tg-button type="copy_text" text="support@cortexapp\.ru"/);
 assert.equal(a.reply_markup,undefined);
});
test("Rich rejection falls back to regular welcome and native keyboard",async()=>{
 const h=harness();h.services.richUi=true;const call=h.services.telegram;
 h.services.telegram=async(m,a)=>{if(m==="sendRichMessage")throw Object.assign(Error("unsupported"),{status:400});return call(m,a)};
 await processCortexBotUpdate(message("/start"),h.services);
 assert.equal(h.calls[0].method,"sendPhoto");assert.ok(h.calls[0].args.reply_markup.inline_keyboard.length);
});
test("Rich premium rejection retries without premium, not with an external keyboard",async()=>{
 const h=harness();h.services.richUi=true;const call=h.services.telegram;
 h.services.telegram=async(m,a)=>{if(a.rich_message?.markdown.includes("tg-emoji"))throw Object.assign(Error("unsupported"),{status:400});return call(m,a)};
 await processCortexBotUpdate(message("/start"),h.services,{enabled:true});
 assert.equal(h.calls[0].method,"sendRichMessage");assert.doesNotMatch(h.calls[0].args.rich_message.markdown,/tg-emoji/);
 assert.equal(h.calls[0].args.reply_markup,undefined);
});
test("Rich mode preserves escaped greeting names without markdown injection",async()=>{
 const h=harness();h.services.richUi=true;const m=message("/start");m.message.from.first_name="<tg-button>Injected</tg-button>";
 await processCortexBotUpdate(m,h.services);assert.match(h.calls[0].args.rich_message.markdown,/&lt;tg-button&gt;Injected&lt;\/tg-button&gt;/);
});

test("Unlinked user must connect once, no checkout occurs",async()=>{
 const h=harness();h.services.checkout=async()=>{throw Error("must not call");};
 await processCortexBotUpdate({update_id:160,callback_query:{id:"buy",data:"cortex:buy_pro",from:{id:user},message:{chat,message_id:1}}},h.services);
 assert.match(h.calls[1].args.text,/Сначала подключи аккаунт/);
 assert.ok(h.calls[1].args.reply_markup.inline_keyboard.flat().some(b=>b.url==="https://cortexapp.ru/account?tab=security"));
});
test("Linked buyer opens a native invoice URL and never website checkout",async()=>{
 const h=harness();h.setLinked(true);h.services.checkout=async(id,plan)=>{assert.equal(id,user);assert.equal(plan,"pro");return {ok:true,id:"11111111-1111-1111-1111-111111111111",stars:250,url:"https://t.me/$invoice"};};
 await processCortexBotUpdate({update_id:161,callback_query:{id:"buy",data:"cortex:buy_pro",from:{id:user},message:{chat,message_id:1}}},h.services);
 assert.match(h.calls[1].args.text,/250 Stars/);assert.ok(h.calls[1].args.reply_markup.inline_keyboard.flat().some(b=>b.url==="https://t.me/$invoice"));
 assert.doesNotMatch(JSON.stringify(h.calls),/cortexapp\.ru\/payment/);
});
test("Forged or group checkout never calls payment service",async()=>{
 const h=harness();h.setLinked(true);h.services.checkout=async()=>{throw Error("must not call");};
 await processCortexBotUpdate({update_id:162,callback_query:{id:"buy",data:"cortex:buy_pro",from:{id:user+1},message:{chat,message_id:1}}},h.services);
 assert.equal(h.calls.length,0);
});
test("Pending order never shows a second pay action",async()=>{
 const h=harness();h.setLinked(true);h.services.checkout=async()=>({ok:false,error:"payment_processing"});
 await processCortexBotUpdate({update_id:163,callback_query:{id:"buy",data:"cortex:buy_start",from:{id:user},message:{chat,message_id:1}}},h.services);
 assert.match(h.calls[1].args.text,/Не оплачивай повторно/);
 assert.ok(h.calls[1].args.reply_markup.inline_keyboard.flat().every(b=>!b.url));
});

test("Home has one shop entry and legacy /pay opens catalog",async()=>{
 const h=harness();await processCortexBotUpdate(message("/start"),h.services);
 const rows=h.calls[0].args.reply_markup.inline_keyboard.flat();
 assert.equal(rows.filter(b=>b.callback_data==="cortex:plans").length,1);
 assert.ok(rows.every(b=>b.callback_data!=="cortex:pay"));assert.equal(parseBotCommand("/pay").page,"plans");
 assert.ok(botCommands.every(c=>c.command!=="pay"));
});
test("Public navigation uses fast claim and avoids account lookup",async()=>{
 const h=harness();let calls=0;
 h.services.claimNavigation=async()=>{calls++;return true};
 h.services.claim=async()=>{throw Error("no SQL claim for public navigation")};
 h.services.linked=async()=>{throw Error("no personal lookup for public navigation")};
 await processCortexBotUpdate(message("/plans"),h.services);
 assert.equal(calls,1);assert.equal(h.calls[0].method,"sendRichMessage");
});
test("Account and purchase stay on durable claim",async()=>{
 const h=harness();h.setLinked(true);let claims=0;
 h.services.claimNavigation=async()=>{throw Error("sensitive action must not use Redis gate")};
 h.services.claim=async()=>{claims++;return true};
 h.services.checkout=async()=>({ok:false,error:"payment_pending"});
 await processCortexBotUpdate(message("/account"),h.services);
 await processCortexBotUpdate({update_id:170,callback_query:{id:"buy",data:"cortex:buy_pro",from:{id:user},message:{chat,message_id:1}}},h.services);
 assert.equal(claims,2);
});
test("Rejected navigation does not load prices or identity",async()=>{
 const h=harness();h.services.claimNavigation=async()=>false;
 h.services.catalog=async()=>{throw Error("must not query")};
 h.services.linked=async()=>{throw Error("must not query")};
 await processCortexBotUpdate(message("/plans"),h.services);
 assert.equal(h.calls.length,0);
});
test("Callback acknowledgment and catalog read start without waiting for each other",async()=>{
 const h=harness();let release;const pending=new Promise(resolve=>{release=resolve});
 const call=h.services.telegram,cat=h.services.catalog;let catalogStarted=false;
 h.services.telegram=async(m,a)=>{if(m==="answerCallbackQuery"){await call(m,a);await pending;return true;}return call(m,a)};
 h.services.catalog=async()=>{catalogStarted=true;release();return cat()};
 await processCortexBotUpdate({update_id:171,callback_query:{id:"parallel",data:"cortex:plans",from:{id:user},message:{chat,message_id:1}}},h.services);
 assert.equal(catalogStarted,true);
});
