import { createHash } from "node:crypto";
import type { BotCheckoutResult } from "./telegram-bot-checkout.ts";
import { starsPlan, starsInvoiceUrl, type StarsPlan } from "./telegram-stars.ts";

type TelegramPerson = { id?: unknown; username?: unknown; first_name?: unknown };
type TelegramMessage = {
  chat?: { id?: unknown; type?: unknown }; from?: TelegramPerson; text?: unknown;
  message_id?: unknown; photo?: unknown;
};
export type CortexTelegramUpdate = {
  update_id?: unknown; message?: TelegramMessage;
  callback_query?: {
    id?: unknown; from?: TelegramPerson; data?: unknown; message?: TelegramMessage;
  };
};
type Button = {
  text: string; style?: "primary" | "success" | "danger";
  callback_data?: string; url?: string; icon_custom_emoji_id?: string; copy_text?: { text: string };
};
type View = { text: string; parse_mode: "HTML"; disable_web_page_preview: true;
  reply_markup: { inline_keyboard: Button[][] }; rich?: string };
type StorePlan = {code:"guest"|"free"|"start"|"pro"|"ultra"; price_kopecks:number; daily_tokens:number; advanced_tokens:number};
type StoreStars = {plan:"start"|"pro"|"ultra"; stars:number; enabled:boolean};
type StoreCatalog = {plans:StorePlan[]; stars:StoreStars[]; starsEnabled:boolean};
export type BotServices = {
  richUi?: boolean;
  checkout?(telegramId:number,plan:StarsPlan):Promise<BotCheckoutResult>;
  catalog?(): Promise<StoreCatalog | null>;
  claim(updateId: number, chatId: number): Promise<boolean>;
  linked(telegramId: number): Promise<boolean>;
  verifyLink(hash: string, person: { id: number; username: string | null; name: string | null }): Promise<boolean>;
  telegram(method: string, args: Record<string, unknown>): Promise<unknown>;
};

export const botCommands = [
  { command: "start", description: "Открыть CORTEX" },
  { command: "menu", description: "Главное меню" },
  { command: "account", description: "Аккаунт и привязка" },
  { command: "status", description: "Статус подключения" },
  { command: "plans", description: "Тарифы CORTEX" },
  { command: "tokens", description: "Пакеты токенов" },
  { command: "pay", description: "Оплата через Telegram Stars" },
  { command: "support", description: "Поддержка" },
  { command: "paysupport", description: "Поддержка платежей" },
  { command: "help", description: "Помощь и команды" },
];
const site = "https://cortexapp.ru";
const news = "https://t.me/cortexdevlog";
export const welcomePhoto = site + "/telegram/welcome.jpg";
const codePattern = /^[A-Za-z0-9_-]{43}$/;

function icon(id: string | undefined): string | undefined {
  return id && /^[0-9]{12,24}$/.test(id) ? id : undefined;
}
export type EmojiOptions = { enabled?: boolean; brand?: string; account?: string; payment?: string; support?: string };
function premium(emoji: string, id: string | undefined, options: EmojiOptions): string {
  return options.enabled && icon(id) ? '<tg-emoji emoji-id="' + id + '">' + emoji + '</tg-emoji>' : emoji;
}
function button(label: string, symbol: string, action: Pick<Button, "url" | "callback_data">,
  options: EmojiOptions = {}, id?: string, style?: Button["style"]): Button {
  const custom = options.enabled ? icon(id) : undefined;
  return { text: custom ? label : symbol + " " + label, ...action,
    ...(style ? {style} : {}), ...(custom ? {icon_custom_emoji_id: custom} : {}) };
}
const nav = (label: string, symbol: string, page: string, options: EmojiOptions = {}, id?: string, style?: Button["style"]) =>
  button(label, symbol, {callback_data: "cortex:" + page}, options, id, style);
const open = (label: string, symbol: string, url: string, options: EmojiOptions = {}, id?: string, style?: Button["style"]) =>
  button(label, symbol, {url}, options, id, style);
const email = "support@cortexapp.ru";
const copyEmail = (): Button => ({text: "Скопировать email", copy_text:{text:email}});
function buttons(options: EmojiOptions, hasLink: boolean): Button[][] {
  return [
    [hasLink
      ? nav("Мой аккаунт", "👤", "account", options, options.account, "success")
      : open("Подключить аккаунт", "🔗", site + "/account?tab=security", options, options.account, "primary")],
    [nav("Тарифы", "💎", "plans"), nav("Оплата Stars", "⭐", "pay", options, options.payment)],
    [nav("Поддержка", "💬", "support", options, options.support), open("Новости", "📢", news)],
    [open("Перейти на сайт", "↗", site + "/", options, options.brand)],
  ];
}

 // Public IDs from https://emoji.wivvi.net/ (Telegram iOS Icons, tgiosicons).
const iosIcons: Readonly<Record<string, string>> = {
  "✨": "5890925363067886150",
  "✦": "5890925363067886150",
  "👤": "6035084557378654059",
  "🔗": "6028171274939797252",
  "💎": "6037083366438737901",
  "⭐": "6028338546736107668",
  "↗": "5776233299424843260",
  "💬": "5843918217323484232",
  "📢": "6021418126061605425",
  "🔒": "6030445631921721471",
  "‹": "5960671702059848143",
  "✅": "5938252440926163756",
  "↻": "6030657343744644592",
  "⚪": "5884332803016891855",
  "🟢": "5938252440926163756",
  "📖": "6030848053177486888",
  "🧾": "5890727932011223292"
};
const alternative: Readonly<Record<string, string>> = { "✦":"✨", "↗":"🌐", "‹":"⬅️", "↻":"🔁", "🟢":"✅", "📖":"❓", "🧾":"🏷" };
function configuredId(symbol: string, options: EmojiOptions): string | undefined {
  const override = symbol === "✦" ? options.brand : symbol === "👤" || symbol === "🔗" ? options.account :
    symbol === "⭐" ? options.payment : symbol === "💬" ? options.support : undefined;
  return icon(override) || iosIcons[symbol];
}
function decorateText(text: string, options: EmojiOptions): string {
  // Only author-controlled line-leading symbols; never interpret user-provided HTML or emoji.
  return text.split("\n").map(line => {
    const symbol = Object.keys(iosIcons).find(key => line.startsWith(key + " ") || line.startsWith(key + "️ "));
    if (!symbol) return line;
    const id = configuredId(symbol, options);
    const trailing = line.slice(symbol.length).replace(/^\uFE0F/, "");
    return id ? '<tg-emoji emoji-id="' + id + '">' + (alternative[symbol] || symbol) + '</tg-emoji>' + trailing : line;
  }).join("\n");
}
function decoratePayload(args: Record<string, unknown>, options: EmojiOptions): Record<string, unknown> {
  const out = {...args};
  for (const key of ["text","caption"]) if (typeof out[key] === "string" && out.parse_mode === "HTML")
    out[key] = decorateText(out[key] as string, options);
  const markup = out.reply_markup as {inline_keyboard?: Button[][]} | undefined;
  if (markup?.inline_keyboard) out.reply_markup = {...markup, inline_keyboard:markup.inline_keyboard.map(row=>row.map(b=>{
    if (b.icon_custom_emoji_id) return b;
    const symbol = Object.keys(iosIcons).find(key=>b.text.startsWith(key+" "));
    if (!symbol) return b;
    return {...b,text:b.text.slice(symbol.length+1),icon_custom_emoji_id:configuredId(symbol,options)};
  }))};
  return out;
}
function withoutPremium(args: Record<string, unknown>): Record<string, unknown> {
  const out={...args};
  for (const key of ["text","caption"]) if(typeof out[key]==="string")
    out[key]=(out[key] as string).replace(/<tg-emoji emoji-id="[0-9]+">([^<]*)<\/tg-emoji>/g,"$1");
  const markup=out.reply_markup as {inline_keyboard?:Button[][]}|undefined;
  if(markup?.inline_keyboard) out.reply_markup={...markup,inline_keyboard:markup.inline_keyboard.map(row=>row.map(b=>{
    const {icon_custom_emoji_id: id, ...rest}=b;
    if(!id) return rest;
    const symbol=Object.keys(iosIcons).find(key=>iosIcons[key]===id);
    return {...rest,text:(symbol ? symbol+" " : "")+rest.text};
  }))};
  return out;
}
function premiumTransport(services:BotServices, options:EmojiOptions):BotServices {
  if (!options.enabled) return services;
  return {...services, telegram:async(method,args)=>{
    if (!["sendMessage","sendPhoto","editMessageText","editMessageCaption","sendRichMessage"].includes(method)) return services.telegram(method,args);
    const decorated=decoratePayload(args,options);
    try {return await services.telegram(method,decorated);}
    catch (error) {
      // Only retry a definitive HTTP 400, never duplicate a message after a network timeout.
      if (!(error instanceof Error) || !("status" in error) || error.status!==400 ||
          !JSON.stringify(decorated).match(/tg-emoji|icon_custom_emoji_id/)) throw error;
      return services.telegram(method,withoutPremium(decorated));
    }
  }};
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function displayName(person?: TelegramPerson): string {
  if (typeof person?.first_name !== "string") return "";
  return escapeHtml(person.first_name.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "").trim().slice(0, 60));
}
const planMeta = {
  free: ["Free", "Для знакомства с CORTEX"],
  start: ["Start", "Продвинутые модели"],
  pro: ["Pro", "Анализ экрана и длинные задачи"],
  ultra: ["Ultra", "Максимум контекста"],
} as const;
type VisibleCode = keyof typeof planMeta;
const number = new Intl.NumberFormat("ru-RU");
const fmt = (n:number) => number.format(n);
const isVisible = (p:StorePlan):p is StorePlan & {code:VisibleCode} => p.code !== "guest" && Object.hasOwn(planMeta,p.code);
function starPrice(catalog:StoreCatalog,p:StorePlan) {
  if (p.code === "free") return 0;
  if (!catalog.starsEnabled) return null;
  const item = catalog.stars.find(x=>x.plan===p.code && x.enabled && Number.isSafeInteger(x.stars) && x.stars>0 && x.stars<=10000);
  return item?.stars ?? null;
}
function priceLabel(catalog:StoreCatalog,p:StorePlan):string {
  const price=starPrice(catalog,p);
  return price===0 ? "Бесплатно" : price===null ? "Недоступно" : fmt(price)+" ⭐";
}
function storeView(page:string,catalog:StoreCatalog|null):View {
  const back = [nav("Назад","‹",page.startsWith("plan_") ? "plans" : "home")];
  const wrap=(text:string,rows:Button[][],rich?:string):View=>({text,parse_mode:"HTML",disable_web_page_preview:true,
    reply_markup:{inline_keyboard:[...rows,back]},...(rich ? {rich} : {})});
  if(page==="tokens") return wrap("✦ <b>Токены</b>\n\nПодписка увеличивает дневной лимит облачного ИИ.\nРазовые пакеты пока нельзя купить. Когда магазин заработает, их можно будет выбрать на сайте.",
    [[nav("Выбрать подписку","💎","plans",{},undefined,"primary")],[open("Магазин","↗",site+"/pricing")]]);
  if(!catalog || !catalog.plans.some(isVisible)) return wrap("💎 <b>Тарифы и лимиты</b>\n\nНе получилось загрузить каталог. Проверь актуальные условия на сайте или попробуй обновить.",
    [[nav("Обновить","↻",page,{},undefined,"primary")],[open("Тарифы на сайте","↗",site+"/pricing")]]);
  const all=catalog.plans.filter(isVisible).sort((x,y)=>Object.keys(planMeta).indexOf(x.code)-Object.keys(planMeta).indexOf(y.code));
  if(page.startsWith("plan_")) {
    const p=all.find(p=>p.code===page.slice(5));
    if(!p) return wrap("Тариф не найден. Вернись в каталог.",[[nav("Все тарифы","💎","plans")]]);
    const [name,desc]=planMeta[p.code], cost=starPrice(catalog,p);
    const limit=fmt(p.daily_tokens)+" токенов в день";
    const advanced=p.advanced_tokens>0 ? "\n"+fmt(p.advanced_tokens)+" на продвинутые модели" : "";
    const buy=cost===0 ? open("Открыть аккаунт","👤",site+"/account",{},undefined,"primary")
      : cost!==null ? nav("Оплатить "+fmt(cost)+" ⭐","⭐","buy_"+p.code,{},undefined,"success")
      : nav("Обновить доступность","↻","plan_"+p.code);
    return wrap("💎 <b>CORTEX "+name+"</b>\n"+desc+"\n\n<b>"+priceLabel(catalog,p)+(cost ? " / месяц":"")+"</b>\n\n<b>"+limit+"</b>"+advanced+
      "\n\n<i>Лимиты обновляются в 03:00 МСК."+(cost ? " Автосписаний нет.":"")+"</i>",
      [[buy],[nav("Сравнить тарифы","💎","plans")]]);
  }
  if(page==="pay") {
    const paid=all.filter(p=>p.code!=="free");
    const lines=paid.map(p=>"<b>"+planMeta[p.code][0]+"</b> · "+priceLabel(catalog,p));
    const rows=paid.map(p=>[starPrice(catalog,p)!==null
      ? nav(planMeta[p.code][0]+" · "+priceLabel(catalog,p),"⭐","buy_"+p.code,{},undefined,"success")
      : nav(planMeta[p.code][0]+" · Подробнее","💎","plan_"+p.code)]);
    return wrap("⭐ <b>Оплата подписки</b>\n\n"+lines.join("\n")+"\n\nОдин месяц доступа. Без автоматических списаний.\n<i>Оплата откроется прямо в Telegram.</i>",
      [...rows,[nav("Возникла проблема","💬","paysupport"),nav("Все тарифы","💎","plans")]]);
  }
  const rows=all.map(p=>[nav(planMeta[p.code][0]+" · "+priceLabel(catalog,p),"💎","plan_"+p.code,{},undefined,p.code==="pro"?"primary":undefined)]);
  const lines=all.map(p=>"<b>"+planMeta[p.code][0]+"</b> · "+priceLabel(catalog,p)+"\n"+fmt(p.daily_tokens)+" токенов в день");
  const table=all.map(p=>"<tr><td><b>"+planMeta[p.code][0]+"</b></td><td align=\"right\">"+fmt(p.daily_tokens)+"</td><td align=\"right\">"+priceLabel(catalog,p)+"</td></tr>").join("");
  const details=all.map(p=>"<details><summary>"+planMeta[p.code][0]+" · "+planMeta[p.code][1]+"</summary><p>"+fmt(p.daily_tokens)+" токенов в день"+(p.advanced_tokens>0 ? ", "+fmt(p.advanced_tokens)+" на продвинутые модели":"")+".</p></details>").join("");
  return wrap("💎 <b>Тарифы CORTEX</b>\n\nКоманды телефона бесплатны. Подписка увеличивает лимит облачного ИИ.\n\n"+lines.join("\n\n")+"\n\n<i>Цены подписок за месяц. Лимиты обновляются в 03:00 МСК.</i>",
    [...rows,[nav("Токены","✦","tokens"),open("На сайте","↗",site+"/pricing")]],
    "<h3>Тарифы CORTEX</h3><p>Команды телефона бесплатны. Выбери подходящий лимит облачного ИИ.</p><table compact><tr><th>Тариф</th><th>Токенов/день</th><th>В месяц</th></tr>"+table+"</table>"+details+"<footer>Лимиты обновляются в 03:00 МСК. Подписка без автосписаний.</footer>");
}
function view(page:string,linked:boolean,options:EmojiOptions,name="",catalog:StoreCatalog|null=null):View {
  if(page==="plans"||page==="pay"||page==="tokens"||page.startsWith("plan_"))return storeView(page,catalog);
  const mark = premium(options.enabled ? "✨" : "✦", options.brand, options);
  let head="",body="",extra:Button[][]=[];
  let rich:string|undefined;
  const back=[nav("Меню","‹","home")];
  switch(page) {
    case "account":
    case "status":
      head="👤 <b>Мой аккаунт</b>";
      body=linked
        ? "✅ <b>Подключение активно</b>\nTelegram уже привязан к CORTEX.\n\nВ кабинете можно проверить баланс, тариф и настройки безопасности."
        : "<b>Подключи свой аккаунт</b>\n\n1. Войди на cortexapp.ru.\n2. Открой раздел «Безопасность».\n3. Нажми «Привязать Telegram».\n\n<i>Ссылка действует 5 минут. Коды входа боту не нужны.</i>";
      extra=linked ? [[open("Открыть кабинет","↗",site+"/account",{},undefined,"primary")],
        [nav("Моя подписка","💎","plans"),open("Безопасность","🔒",site+"/account?tab=security")],[nav("Обновить статус","↻","status")]]
        : [[open("Подключить аккаунт","🔗",site+"/account?tab=security",options,options.account,"primary")],[nav("Проверить статус","↻","status")]];
      break;
    case "support":
      head="💬 <b>Поддержка</b>";
      body="С чем нужна помощь?\n\n<b>Почта</b>\n<code>"+email+"</code>\n\n<i>Приложи скриншот и опиши проблему. Не присылай пароли или коды входа.</i>";
      extra=[[open("Написать нам","↗",site+"/support",options,options.support,"primary")],[nav("Оплата","⭐","paysupport"),nav("Частые вопросы","📖","help")],[copyEmail()]];
      rich="<h3>Поддержка CORTEX</h3><p>С чем нужна помощь?</p><tg-button-row><tg-button type=\"url\" style=\"primary\" url=\"https://cortexapp.ru/support\">Написать нам</tg-button></tg-button-row><hr/><p>Не начислились токены или не активировалась подписка?</p><tg-button-row><tg-button type=\"callback_data\" style=\"link\" data=\"cortex:paysupport\">Помощь с оплатой</tg-button><tg-button type=\"callback_data\" style=\"link\" data=\"cortex:help\">Частые вопросы</tg-button></tg-button-row><p><b>Почта</b> · <code>"+email+"</code></p><footer>При обращении приложи скриншот, но не отправляй пароли и коды входа.</footer>";
      break;
    case "paysupport":
      head="🧾 <b>Помощь с оплатой</b>";
      body="Если подписка не активировалась, проверь статус платежа на сайте.\n\nПри обращении в поддержку укажи дату покупки, тариф и номер заказа, если есть.\n\n<code>"+email+"</code>";
      extra=[[open("Проверить покупки","↗",site+"/account",{},undefined,"primary")],[open("Написать в поддержку","💬",site+"/support")],[copyEmail(),nav("К тарифам","💎","plans")]];
      break;
    case "help":
      head="📖 <b>Частые вопросы</b>";
      body="<b>Как подключить Telegram?</b>\nЧерез раздел «Безопасность» на сайте.\n\n<b>Где общаться с ИИ?</b>\nВ приложении CORTEX.\n\n<b>Как продлить подписку?</b>\nОплати новый месяц вручную через Stars.";
      rich="<h3>Частые вопросы</h3><details><summary>Как подключить Telegram?</summary><p>Войди на сайт, открой «Безопасность» и нажми «Привязать Telegram». В боте нажми Start.</p><tg-button-row><tg-button type=\"url\" style=\"primary\" url=\"https://cortexapp.ru/account?tab=security\">Подключить аккаунт</tg-button></tg-button-row></details><details><summary>Где общаться с ИИ?</summary><p>В приложении CORTEX. Здесь можно управлять аккаунтом, подпиской и покупками.</p></details><details><summary>Как продлить подписку?</summary><p>Выбери тариф и оплати новый месяц вручную. Автоматических списаний нет.</p></details><details><summary>Не прошла оплата?</summary><p>Обратись в поддержку с номером заказа и датой покупки.</p></details><hr/><tg-button-row><tg-button type=\"copy_text\" style=\"link\" text=\"support@cortexapp.ru\">Скопировать email</tg-button><tg-button type=\"callback_data\" style=\"link\" data=\"cortex:support\">Поддержка</tg-button></tg-button-row>";
      extra=[[nav("Поддержка","💬","support",{},undefined,"primary")],[open("Тарифы","💎",site+"/pricing")]];
      break;
    default:
      head=name?mark+" <b>Привет, "+name+"!</b>":mark+" <b>Добро пожаловать в CORTEX</b>";
      body="Подписки, покупки и поддержка CORTEX в одном чате.\n\n"+(linked
        ? "✅ <b>Аккаунт подключён.</b>\nВыбери нужный раздел."
        : "<b>Уже пользуешься CORTEX?</b>\nПодключи аккаунт, чтобы начать.");
  }
  return {text:head+"\n\n"+body,parse_mode:"HTML",disable_web_page_preview:true,
    reply_markup:{inline_keyboard:page==="home"?buttons(options,linked):[...extra,back]},...(rich?{rich}:{})};
}
// Native Rich Markdown controls, documented under Rich Message Formatting Options.
// Only the trusted view model can produce actions; names and attributes are escaped.
function richButton(b:Button,options:EmojiOptions,style?: "link"|"primary"|"success"|"danger"):string {
  const symbol=Object.keys(iosIcons).find(s=>b.text.startsWith(s+" "));
  const id=options.enabled ? (icon(b.icon_custom_emoji_id) || (symbol && configuredId(symbol,options))) : undefined;
  const label=escapeHtml(id&&symbol ? b.text.slice(symbol.length+1) : b.text);
  const visual=id ? '<tg-emoji emoji-id="'+id+'">'+escapeHtml(alternative[symbol||""]||symbol||"✨")+'</tg-emoji> ' : "";
  const appearance=' style="'+(style||b.style||"link")+'"';
  const action=b.callback_data ? 'type="callback_data" data="'+escapeHtml(b.callback_data)+'"'
    : b.url ? 'type="url" url="'+escapeHtml(b.url)+'"'
    : b.copy_text ? 'type="copy_text" text="'+escapeHtml(b.copy_text.text)+'"' : 'type="disabled"';
  return '<tg-button '+action+appearance+'>'+visual+label+'</tg-button>';
}
function richMarkdown(page:string,payload:View,options:EmojiOptions,catalog:StoreCatalog|null,withPhoto:boolean):string {
  const rows=payload.reply_markup.inline_keyboard;
  const btn=(b:Button,style?: "link"|"primary"|"success"|"danger")=>richButton(b,options,style);
  const line=(buttons:Button[],style?: "link"|"primary"|"success"|"danger")=>buttons.map(b=>btn(b,style)).join("  ");
  const find=(predicate:(b:Button)=>boolean)=>rows.flat().find(predicate);
  const action=(data:string,style:"link"|"primary"|"success"|"danger"="link")=>{
    const b=find(b=>b.callback_data==="cortex:"+data);
    return b ? btn(b,style) : "";
  };
  const url=(path:string,style:"link"|"primary"|"success"|"danger"="link")=>{
    const b=find(b=>b.url===site+path);return b?btn(b,style):"";
  };
  const footer=(r:Button[])=>r.length?'<tg-button-row align="left">'+r.map(b=>btn(b,"link")).join("")+'</tg-button-row>':"";
  const [heading,...paragraphs]=payload.text.split("\n\n");
  const title='<h3>'+(options.enabled?decorateText(heading,options):heading)+'</h3>';
  const textBlocks=paragraphs.map(p=>'<p>'+(options.enabled?decorateText(p,options):p).replace(/\n/g,"<br/>")+'</p>').join("\n\n");
  if(page==="home") {
    const main=rows[0][0];
    return (withPhoto?'![]('+welcomePhoto+')\n\n':"")+title+"\n\n"+textBlocks+
      "\n\n<tg-button-row align=\"left\">"+btn(main,main.style||"primary")+"</tg-button-row>"+
      "\n\n---\n\n**Подписки и покупки**\n\nВыбрать тариф "+action("plans")+"  ·  "+action("pay")+
      "\n\n**Помощь и новости**\n\n"+line(rows[2],"link")+
      "\n\n"+line(rows[3],"link");
  }
  if(page==="plans"&&catalog&&catalog.plans.some(isVisible)) {
    const all=catalog.plans.filter(isVisible).sort((a,b)=>Object.keys(planMeta).indexOf(a.code)-Object.keys(planMeta).indexOf(b.code));
    const details=all.map(p=>"<details><summary>"+planMeta[p.code][0]+" · "+priceLabel(catalog,p)+"</summary><p>"+planMeta[p.code][1]+".<br/>"+
      fmt(p.daily_tokens)+" токенов в день"+(p.advanced_tokens>0?"<br/>"+fmt(p.advanced_tokens)+" на продвинутые модели":"")+".</p><p>"+action("plan_"+p.code,"primary")+"</p></details>").join("\n\n");
    return "## Тарифы CORTEX\n\nКоманды телефона бесплатны. Выбери дневной лимит облачного ИИ.\n\n"+
      "| Тариф | Токенов/день | Цена |\n|:---|---:|---:|\n"+all.map(p=>"| **"+planMeta[p.code][0]+"** | "+fmt(p.daily_tokens)+" | "+priceLabel(catalog,p)+" |").join("\n")+
      "\n\n"+details+"\n\n<footer>Цены за месяц. Лимиты обновляются в 03:00 МСК. Без автосписаний.</footer>\n\n"+footer(rows.slice(-2).flat());
  }
  if(page==="pay"&&catalog&&catalog.plans.some(isVisible)) {
    const paid=catalog.plans.filter(p=>isVisible(p)&&p.code!=="free");
    return "## Оплата подписки\n\nОдин месяц доступа, без автосписаний.\n\n"+
      paid.map(p=>{const b=find(b=>b.callback_data==="cortex:buy_"+p.code||b.callback_data==="cortex:plan_"+p.code);
        return "<p><b>"+planMeta[p.code as VisibleCode][0]+"</b> · "+priceLabel(catalog,p)+" "+(b?btn(b,starPrice(catalog,p)===null?"link":"success"):"")+"</p>";}).join("\n\n")+
      "\n\n<footer>Оплата прямо в Telegram. Аккаунт CORTEX нужно привязать один раз.</footer>\n\n"+footer(rows.slice(-2).flat());
  }
  if(page.startsWith("plan_")&&catalog) {
    const p=catalog.plans.find(p=>isVisible(p)&&p.code===page.slice(5));
    if(p&&isVisible(p)) return "## CORTEX "+planMeta[p.code][0]+"\n\n"+planMeta[p.code][1]+"\n\n**"+priceLabel(catalog,p)+(starPrice(catalog,p)?" / месяц":"")+"**\n\n"+
      "- "+fmt(p.daily_tokens)+" токенов в день"+(p.advanced_tokens>0?"\n- "+fmt(p.advanced_tokens)+" на продвинутые модели":"")+
      "\n\n"+line(rows[0])+"\n\n<footer>Лимиты обновляются в 03:00 МСК. Автосписаний нет.</footer>\n\n"+footer(rows.slice(1).flat());
  }
  if(page==="support"||page==="paysupport") {
    const copy=find(b=>!!b.copy_text);
    return "## "+(page==="support"?"Поддержка CORTEX":"Вопрос по оплате")+"\n\n"+
      (page==="support"?"Расскажи, что произошло. Если есть скриншот, приложи его.":"Если подписка не активировалась, укажи дату покупки, тариф и номер заказа.")+
      "\n\n<p><b>Почта</b> · <code>"+email+"</code> "+(copy?btn(copy,"link"):"")+"</p>\n\n"+
      line(rows[0])+"\n\n"+(page==="support"?"Оплата или подписка "+action("paysupport")+" \n\nКак пользоваться "+action("help"):url("/support","primary"))+
      "\n\n<footer>Не отправляй пароли, данные карты и коды входа.</footer>\n\n"+footer(rows.slice(-1).flat());
  }
  if(page==="help") return "## Частые вопросы\n\n"+
    "<details><summary>Как подключить аккаунт?</summary>Войди на сайт CORTEX, открой «Безопасность» и нажми «Привязать Telegram».</details>\n\n"+
    "<details><summary>Как продлить подписку?</summary>Оплати новый месяц вручную через Telegram Stars. Автосписаний нет.</details>\n\n"+
    "<details><summary>Где общаться с ИИ?</summary>В приложении CORTEX.</details>\n\n"+
    "<p>Нужна помощь? "+action("support","primary")+"</p>\n\n"+footer(rows.slice(1).flat());
  return title+"\n\n"+textBlocks+"\n\n"+rows.map((r,i)=>i===rows.length-1?footer(r):"<p>"+line(r)+"</p>").join("\n\n");
}
const rejectedRich=(e:unknown)=>e instanceof Error && "status" in e && [400,404].includes(Number(e.status));
// Never put an InlineKeyboardMarkup under a successfully rendered rich message.
// An explicit empty keyboard is used only when editing an older message.
async function tryNativeRich(services:BotServices,chatId:number,page:string,payload:View,options:EmojiOptions,catalog:StoreCatalog|null,
  editId?:number,withPhoto=false):Promise<boolean> {
  const send=async(o:EmojiOptions)=>services.telegram(editId?"editMessageText":"sendRichMessage",{
    chat_id:chatId,...(editId?{message_id:editId,reply_markup:{inline_keyboard:[]}}:{}),
    rich_message:{markdown:richMarkdown(page,payload,o,catalog,withPhoto)}
  });
  try {await send(options);return true;}
  catch(e) {
    if(!rejectedRich(e))throw e;
    if(options.enabled) {
      try {await send({...options,enabled:false});return true;}
      catch(e2){if(!rejectedRich(e2))throw e2;}
    }
    console.warn("cortex_rich_fallback",page);
    return false;
  }
}

async function deliverScreen(services:BotServices,chatId:number,payload:View,editId?:number) {
  const {rich,...plain}=payload;
  if(rich) {
    try {
      await services.telegram(editId?"editMessageText":"sendRichMessage",{
        chat_id:chatId,...(editId?{message_id:editId}:{}),rich_message:{html:rich},reply_markup:plain.reply_markup,
      });
      return;
    } catch(error) {
      if(!(error instanceof Error) || !("status" in error) || ![400,404].includes(Number(error.status))) throw error;
      // Older clients/providers retain equivalent native navigation and content.
    }
  }
  await services.telegram(editId?"editMessageText":"sendMessage",{chat_id:chatId,...(editId?{message_id:editId}:{}),...plain});
}
async function sendWelcome(services: BotServices, chatId: number, payload: View) {
  const { rich: _rich, text, disable_web_page_preview: _preview, ...rest } = payload;
  try {
    await services.telegram("sendPhoto", { chat_id: chatId, photo: welcomePhoto, caption: text, ...rest });
  } catch {
    // Photo or CDN unavailable: preserve access to account and payment navigation.
    await deliverScreen(services, chatId, payload);
  }
}
function normalizePage(value: string): string {
  const command = value.toLowerCase();
  if (command === "start" || command === "menu" || command === "home") return "home";
  if (command === "account" || command === "status" || command === "plans" ||
      command === "pay" || command === "tokens" || command === "support" || command === "paysupport" || command === "help") return command;
  return "home";
}
export function parseBotCommand(raw: unknown): { page: string; linkCode?: string } | null {
  if (typeof raw !== "string" || raw.length > 128 || /[\r\n]/.test(raw)) return null;
  const matched = /^\/([a-z][a-z0-9_]{0,31})(?:@[a-z0-9_]{5,32})?(?:[ \t]+([^\s]{1,80}))?$/i.exec(raw);
  if (!matched) return null;
  if (matched[1].toLowerCase() === "start" && matched[2]?.startsWith("link_")) {
    const linkCode = matched[2].slice(5);
    return codePattern.test(linkCode) ? { page: "link", linkCode } : { page: "invalid_link" };
  }
  return { page: normalizePage(matched[1]) };
}
function validId(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}
function safePerson(person: TelegramPerson | undefined, id: number) {
  return {
    id,
    username: typeof person?.username === "string" && /^[A-Za-z0-9_]{5,32}$/.test(person.username)
      ? person.username : null,
    name: typeof person?.first_name === "string" ? person.first_name.replace(/[\u0000-\u001f\u007f<>]/g, "").slice(0, 100) : null,
  };
}
export async function processCortexBotUpdate(
  update: CortexTelegramUpdate, services: BotServices, emoji: EmojiOptions = {},
): Promise<number> {
  const rawServices=services;
  services = premiumTransport(services, emoji);
  const callback = update.callback_query;
  const message = callback?.message || update.message;
  const from = callback?.from || update.message?.from;
  const chatId = message?.chat?.id;
  const userId = from?.id;
  if (!validId(update.update_id) || !validId(chatId) || !validId(userId) ||
      chatId !== userId || message?.chat?.type !== "private") return 200;
  if (callback && (typeof callback.id !== "string" || !callback.id || callback.id.length > 256)) return 200;
  const claimed = await services.claim(update.update_id, chatId);
  if (!claimed) {
    if (callback) await services.telegram("answerCallbackQuery", { callback_query_id: callback.id });
    return 200;
  }
  const command = !callback ? parseBotCommand(update.message?.text) : null;
  if (command?.page === "link" && command.linkCode) {
    const hashed = createHash("sha256").update(command.linkCode).digest("hex");
    const ok = await services.verifyLink(hashed, safePerson(from, userId));
    if (ok) {
      const home = {...view("home",true,rawServices.richUi?{}:emoji,displayName(from)),text:"✅ <b>Telegram успешно привязан</b>\n\nГотово! Теперь можно открыть свой кабинет, выбрать подписку или обратиться в поддержку."};
      if(rawServices.richUi && await tryNativeRich(rawServices,chatId,"home",home,emoji,null,undefined,true))return 200;
      await sendWelcome(services,chatId,home);
      return 200;
    }
    await services.telegram("sendMessage", {
      chat_id: chatId, parse_mode: "HTML", disable_web_page_preview: true,
      text: ok
        ? "<b>✅ Telegram подтверждён</b>\n\nТвой Telegram успешно привязан к CORTEX. Аккаунт готов к использованию в боте."
        : "<b>Ссылка недействительна или истекла.</b>\nСоздай новую в разделе «Безопасность» аккаунта CORTEX.",
      reply_markup: { inline_keyboard: [[{
        text: ok ? "Управлять аккаунтом" : "Создать новую ссылку",
        url: site + "/account?tab=security", style: ok ? "success" : "primary",
      }]] },
    });
    return 200;
  }
  if (command?.page === "invalid_link") {
    await services.telegram("sendMessage", {
      chat_id: chatId,
      text: "Ссылка привязки не распознана. Создай новую в разделе «Безопасность» CORTEX.",
      reply_markup: { inline_keyboard: [[{ text: "Открыть безопасность", style: "primary",
        url: site + "/account?tab=security" }]] },
    });
    return 200;
  }
  const rawPage = callback?.data;
  const page = callback
    ? (typeof rawPage === "string" && /^cortex:(home|account|status|plans|pay|tokens|plan_(?:free|start|pro|ultra)|buy_(?:start|pro|ultra)|support|paysupport|help)$/.test(rawPage)
      ? rawPage.slice("cortex:".length) : "home")
    : command?.page || "home";
  if (callback) await services.telegram("answerCallbackQuery", {callback_query_id:callback.id});
  if(page.startsWith("buy_")&&callback){
    const plan=page.slice(4);
    if(!starsPlan(plan))return 200;
    const linked=await services.linked(userId);
    if(!linked){
      await services.telegram("sendMessage",{chat_id:chatId,parse_mode:"HTML",text:"🔗 <b>Сначала подключи аккаунт</b>\n\nЭто нужно один раз, чтобы подписка начислилась именно тебе. После привязки вернись к оплате в Telegram.",
        reply_markup:{inline_keyboard:[[open("Привязать Telegram","🔗",site+"/account?tab=security",{},undefined,"primary")],[nav("Проверить подключение","↻",page)]]}});
      return 200;
    }
    const result:BotCheckoutResult=services.checkout?await services.checkout(userId,plan as StarsPlan):{ok:false,error:"stars_disabled"};
    const invoice=result.ok?starsInvoiceUrl(result.url):null;
    if(result.ok&&invoice){
      // createInvoiceLink opens Telegram's native XTR payment sheet, not our website.
      await services.telegram("sendMessage",{chat_id:chatId,parse_mode:"HTML",
        text:"⭐ <b>Счёт CORTEX "+plan.toUpperCase()+"</b>\n\n<b>"+fmt(result.stars)+" Stars</b> за один месяц.\nАвтоматических списаний нет.\n\n<i>Подписка активируется после подтверждения платежа.</i>",
        reply_markup:{inline_keyboard:[[open("Оплатить "+fmt(result.stars)+" ⭐","⭐",invoice,{},undefined,"success")],[nav("К тарифам","‹","plans"),nav("Помощь","💬","paysupport")]]}});
    }else{
      const code=result.ok?"invoice_unavailable":result.error;
      const message=code==="link_required"?"Привязка аккаунта изменилась. Подключи Telegram заново."
        :code==="payment_pending"||code==="other_checkout_pending"?"У тебя уже есть незавершённая покупка. Заверши её или дождись истечения счёта."
        :code==="payment_processing"?"Предыдущий платёж обрабатывается. Не оплачивай повторно."
        :code==="rate_limited"?"Слишком много попыток. Попробуй через 15 минут."
        :code==="stars_disabled"||code==="payments_disabled"||code==="funding_unavailable"?"Этот тариф сейчас недоступен для покупки."
        :"Не удалось создать счёт. Деньги не списаны. Попробуй снова.";
      await services.telegram("sendMessage",{chat_id:chatId,parse_mode:"HTML",text:"<b>Оплата подписки</b>\n\n"+message,
        reply_markup:{inline_keyboard:[[nav("К тарифам","‹","plans")],[nav("Помощь с оплатой","💬","paysupport")]]}});
    }
    return 200;
  }
  const storePage=page==="plans"||page==="pay"||page.startsWith("plan_");
  const [linked,catalog]=await Promise.all([services.linked(userId),
    storePage&&services.catalog ? services.catalog().catch(()=>null) : Promise.resolve(null)]);
  let payload=view(page,linked,rawServices.richUi?{}:emoji,displayName(from),catalog);
  if(rawServices.richUi && (callback || command)) {
    const messageId=message?.message_id;
    const isPhoto=Array.isArray(message?.photo)&&message.photo.length>0;
    const editId=callback&&!isPhoto&&validId(messageId)?messageId:undefined;
    if(await tryNativeRich(rawServices,chatId,page,payload,emoji,catalog,editId,!editId&&page==="home"&&!callback)) {
      if(callback&&isPhoto&&validId(messageId)) {
        try {await rawServices.telegram("editMessageReplyMarkup",{chat_id:chatId,message_id:messageId,reply_markup:{inline_keyboard:[]}});} catch { /* New menu is already visible. */ }
      }
      return 200;
    }
    // A definitive rich rejection falls back to the current native keyboard and equivalent data.
    payload={...payload,rich:undefined};
  }
  if(callback) {
    const messageId=message?.message_id;
    if(validId(messageId) && Array.isArray(message?.photo) && message.photo.length>0) {
      // Keep the welcome artwork as a standalone introduction, never attach it to product/support pages.
      if(page==="home") {
        const {rich:_rich,text,disable_web_page_preview:_preview,...rest}=payload;
        await services.telegram("editMessageCaption",{chat_id:chatId,message_id:messageId,caption:text,...rest});
      } else {
        await deliverScreen(services,chatId,payload);
        try { await services.telegram("editMessageReplyMarkup",{chat_id:chatId,message_id:messageId,reply_markup:{inline_keyboard:[]}}); } catch { /* The new navigation is already available. */ }
      }
    } else if(validId(messageId)) await deliverScreen(services,chatId,payload,messageId);
  } else if(page==="home"&&command) {
    await sendWelcome(services,chatId,payload);
  } else if (!command) {
    await services.telegram("sendMessage", {chat_id: chatId, parse_mode: "HTML",
      text: "💬 <b>Для диалога с ИИ открой приложение.</b>\nЗдесь я помогу с аккаунтом, оплатой и поддержкой.",
      reply_markup: {inline_keyboard: [[open("Открыть CORTEX", "↗", site + "/", {}, undefined, "primary")],
        [nav("Главное меню", "‹", "home")]]}});
  } else {
    await deliverScreen(services,chatId,payload);
  }
  return 200;
}
