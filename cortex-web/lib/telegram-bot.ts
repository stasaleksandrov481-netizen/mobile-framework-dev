import { createHash } from "node:crypto";

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
  reply_markup: { inline_keyboard: Button[][] } };
export type BotServices = {
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
function view(page: string, linked: boolean, options: EmojiOptions, name = ""): View {
  const mark = premium(options.enabled ? "✨" : "✦", options.brand, options);
  let head = "", body = "";
  let extra: Button[][] = [];
  const back = [nav("Назад", "‹", "home")];
  switch (page) {
    case "account":
    case "status":
      head = "👤 <b>Мой аккаунт</b>";
      body = linked
        ? "✅ <b>Подключение активно</b>\nTelegram привязан к твоему аккаунту. Тариф и баланс можно проверить в личном кабинете."
        : "⚪ <b>Аккаунт не подключён</b>\n\nВойди на сайт, открой «Безопасность» и нажми «Привязать Telegram».\n\n<i>Пароль и коды входа здесь не нужны.</i>";
      extra = linked
        ? [[open("Личный кабинет", "↗", site + "/account", {}, undefined, "primary")],
           [open("Безопасность", "🔒", site + "/account?tab=security"), nav("Обновить", "↻", "status")]]
        : [[open("Подключить аккаунт", "🔗", site + "/account?tab=security", options, options.account, "primary")]];
      break;
    case "plans":
      head = "💎 <b>Тарифы CORTEX</b>";
      body = "Нужно больше запросов к ИИ? Сравни подписки, модели и лимиты перед покупкой.\n\n<i>Все актуальные цены доступны на сайте.</i>";
      extra = [[open("Посмотреть тарифы", "↗", site + "/pricing", {}, undefined, "primary")],
        [nav("Оплата Stars", "⭐", "pay", options, options.payment)]];
      break;
    case "pay":
      head = "⭐ <b>Оплата через Telegram Stars</b>";
      body = "Выбери подписку или пополнение на сайте и оплати счёт звёздами Telegram.\n\n" +
        (linked ? "✅ Аккаунт подключён." : "Перед покупкой войди в свой аккаунт CORTEX.") +
        "\n<i>Доступ начисляется после подтверждения платежа.</i>";
      extra = [[open("Выбрать предложение", "⭐", site + "/payment", options, options.payment, "success")],
        [nav("Проблема с оплатой", "💬", "paysupport")]];
      break;
    case "support":
      head = "💬 <b>Поддержка CORTEX</b>";
      body = "Что-то не работает? Напиши нам, расскажи, что произошло, и приложи скриншот, если он есть.\n\n<b>Почта</b>\n<code>" + email + "</code>\n\n<i>Не присылай пароли и коды входа.</i>";
      extra = [[open("Написать в поддержку", "↗", site + "/support", options, options.support, "primary")],
        [copyEmail(), nav("Вопрос по оплате", "⭐", "paysupport")],
        [nav("Частые вопросы", "📖", "help")]];
      break;
    case "paysupport":
      head = "🧾 <b>Вопрос по оплате</b>";
      body = "Не начислились токены или не активировалась подписка? Напиши на <code>" + email + "</code> с почты своего аккаунта.\n\nУкажи дату покупки и номер заказа, если он есть.\n<i>Данные карты и коды входа не нужны.</i>";
      extra = [[open("Открыть поддержку", "💬", site + "/support", {}, undefined, "primary")],[copyEmail()]];
      break;
    case "help":
      head = "📖 <b>Частые вопросы</b>";
      body = "<b>Как подключить аккаунт?</b>\nВойди на сайт и открой раздел «Безопасность».\n\n<b>Где общаться с ИИ?</b>\nВ приложении CORTEX. Здесь можно управлять аккаунтом и покупками.\n\n<b>Не получается оплатить?</b>\nОбратись в поддержку.";
      extra = [[open("Подключить Telegram", "🔗", site + "/account?tab=security")],[nav("Поддержка", "💬", "support")]];
      break;
    default:
      head = name ? mark + " <b>Привет, " + name + "!</b>" : mark + " <b>Добро пожаловать в CORTEX</b>";
      body = "Здесь можно управлять аккаунтом, выбирать подписку и оплачивать покупки через Telegram Stars.\n\n" +
        (linked
          ? "✅ <b>Аккаунт подключён.</b>\nВыбирай нужный раздел."
          : "<b>Уже пользуешься CORTEX?</b>\nПодключи аккаунт, чтобы всё было в одном месте.");
  }
  return { text: head + "\n\n" + body, parse_mode: "HTML", disable_web_page_preview: true,
    reply_markup: { inline_keyboard: page === "home" ? buttons(options, linked) : [...extra, back] } };
}
const guideHtml = '<h3>Частые вопросы</h3><p>Всё о подключении, подписках и оплате.</p><details><summary>Как подключить Telegram?</summary><p>Войди на сайт CORTEX, открой «Безопасность» и нажми «Привязать Telegram». В боте нажми Start.</p><tg-button-row><tg-button type="url" url="https://cortexapp.ru/account?tab=security" style="primary">Подключить аккаунт</tg-button></tg-button-row></details><details><summary>Где общаться с ИИ?</summary><p>В приложении CORTEX. Здесь находятся аккаунт, покупки и поддержка.</p></details><details><summary>Что делать, если платёж не появился?</summary><p>Напиши в поддержку с почты аккаунта, укажи дату и номер заказа. Не присылай коды входа.</p></details><hr><p>Нужна помощь?</p><tg-button-row><tg-button type="url" url="https://cortexapp.ru/support" style="primary">Написать нам</tg-button></tg-button-row><tg-button-row><tg-button type="copy_text" style="link" text="support@cortexapp.ru">Скопировать email</tg-button><tg-button type="url" style="link" url="https://cortexapp.ru/pricing">Тарифы</tg-button></tg-button-row>';
async function sendGuide(services: BotServices, chatId: number, payload: View) {
  try {
    await services.telegram("sendRichMessage", {chat_id:chatId, rich_message:{html:guideHtml}});
  } catch {
    await services.telegram("sendMessage", {chat_id:chatId, ...payload});
  }
}
async function sendWelcome(services: BotServices, chatId: number, payload: View) {
  const { text, disable_web_page_preview: _preview, ...rest } = payload;
  try {
    await services.telegram("sendPhoto", { chat_id: chatId, photo: welcomePhoto, caption: text, ...rest });
  } catch {
    // Photo or CDN unavailable: preserve access to account and payment navigation.
    await services.telegram("sendMessage", { chat_id: chatId, ...payload });
  }
}
function normalizePage(value: string): string {
  const command = value.toLowerCase();
  if (command === "start" || command === "menu" || command === "home") return "home";
  if (command === "account" || command === "status" || command === "plans" ||
      command === "pay" || command === "support" || command === "paysupport" || command === "help") return command;
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
      const home = view("home", true, emoji, displayName(from));
      await sendWelcome(services, chatId, { ...home, text: "✅ <b>Telegram успешно привязан</b>\n\nГотово! Теперь можно открыть свой кабинет, выбрать подписку или обратиться в поддержку." });
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
    ? (typeof rawPage === "string" && /^cortex:(home|account|status|plans|pay|support|paysupport|help)$/.test(rawPage)
      ? rawPage.slice("cortex:".length) : "home")
    : command?.page || "home";
  const linked = await services.linked(userId);
  const payload = view(page, linked, emoji, displayName(from));
  if (callback) {
    await services.telegram("answerCallbackQuery", { callback_query_id: callback.id });
    if (page === "help") {
      await sendGuide(services, chatId, payload);
      return 200;
    }
    if (validId(message?.message_id)) {
      if (Array.isArray(message.photo) && message.photo.length > 0) {
        const { text, disable_web_page_preview: _preview, ...rest } = payload;
        await services.telegram("editMessageCaption", { chat_id: chatId, message_id: message.message_id, caption: text, ...rest });
      } else {
        await services.telegram("editMessageText", { chat_id: chatId, message_id: message.message_id, ...payload });
      }
    }
  } else if (page === "help" && command) {
    await sendGuide(services, chatId, payload);
  } else if (page === "home" && command) {
    await sendWelcome(services, chatId, payload);
  } else if (!command) {
    await services.telegram("sendMessage", {chat_id: chatId, parse_mode: "HTML",
      text: "💬 <b>Для диалога с ИИ открой приложение.</b>\nЗдесь я помогу с аккаунтом, оплатой и поддержкой.",
      reply_markup: {inline_keyboard: [[open("Открыть CORTEX", "↗", site + "/", {}, undefined, "primary")],
        [nav("Главное меню", "‹", "home")]]}});
  } else {
    await services.telegram("sendMessage", { chat_id: chatId, ...payload });
  }
  return 200;
}
