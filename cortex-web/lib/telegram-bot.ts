import { createHash } from "node:crypto";

type TelegramPerson = { id?: unknown; username?: unknown; first_name?: unknown };
type TelegramMessage = {
  chat?: { id?: unknown; type?: unknown }; from?: TelegramPerson; text?: unknown;
  message_id?: unknown;
};
export type CortexTelegramUpdate = {
  update_id?: unknown; message?: TelegramMessage;
  callback_query?: {
    id?: unknown; from?: TelegramPerson; data?: unknown; message?: TelegramMessage;
  };
};
type Button = {
  text: string; style?: "primary" | "success" | "danger";
  callback_data?: string; url?: string; icon_custom_emoji_id?: string;
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
const codePattern = /^[A-Za-z0-9_-]{43}$/;

function icon(id: string | undefined): string | undefined {
  return id && /^[0-9]{12,24}$/.test(id) ? id : undefined;
}
export type EmojiOptions = { enabled?: boolean; brand?: string; account?: string; payment?: string; support?: string };
function premium(emoji: string, id: string | undefined, options: EmojiOptions): string {
  return options.enabled && icon(id) ? '<tg-emoji emoji-id="' + id + '">' + emoji + '</tg-emoji>' : emoji;
}
function buttons(options: EmojiOptions, hasLink: boolean): Button[][] {
  const icons = options.enabled ? options : {};
  return [
    [
      { text: "Аккаунт", style: hasLink ? "success" : "primary", callback_data: "cortex:account",
        ...(icon(icons.account) ? { icon_custom_emoji_id: icon(icons.account) } : {}) },
      { text: "Тарифы", callback_data: "cortex:plans" },
    ],
    [
      { text: "Оплата Stars", style: "success", callback_data: "cortex:pay",
        ...(icon(icons.payment) ? { icon_custom_emoji_id: icon(icons.payment) } : {}) },
      { text: "Поддержка", callback_data: "cortex:support",
        ...(icon(icons.support) ? { icon_custom_emoji_id: icon(icons.support) } : {}) },
    ],
    [
      { text: "Открыть CORTEX", style: "primary", url: site },
      { text: "Новости", url: news },
    ],
  ];
}
function view(page: string, linked: boolean, options: EmojiOptions): View {
  const mark = premium("✦", options.brand, options);
  const head = "<b>" + mark + " CORTEX</b>";
  let body: string;
  let extra: Button[][] = [];
  switch (page) {
    case "account":
    case "status":
      body = linked
        ? "✅ <b>Telegram привязан.</b>\nАккаунт CORTEX подтверждён. Баланс и настройки доступны на сайте."
        : "🔒 <b>Telegram пока не привязан.</b>\nОткрой раздел «Безопасность» на сайте, создай ссылку и подтверди подключение.";
      extra = [[{ text: linked ? "Управлять привязкой" : "Привязать Telegram", style: "primary",
        url: site + "/account?tab=security" }]];
      break;
    case "plans":
      body = "💎 <b>Тарифы CORTEX</b>\nУзнай актуальные лимиты и стоимость подписок. Цены берутся из общего каталога CORTEX.";
      extra = [[{ text: "Смотреть тарифы", style: "primary", url: site + "/pricing" }]];
      break;
    case "pay":
      body = "⭐ <b>Telegram Stars</b>\nПокупка проходит через официальный счёт Telegram. Доступ выдаётся только после подтверждения платежа сервером CORTEX.";
      extra = [[{ text: "Перейти к оплате", style: "success", url: site + "/payment" },
        { text: "Помощь с оплатой", callback_data: "cortex:paysupport" }]];
      break;
    case "support":
      body = "🛟 <b>Поддержка CORTEX</b>\nНапиши в поддержку из личного кабинета или на support@cortexapp.ru.\nНикому не сообщай коды входа и пароли.";
      extra = [[{ text: "Открыть поддержку", style: "primary", url: site + "/support" }]];
      break;
    case "paysupport":
      body = "🧾 <b>Вопрос по оплате?</b>\nНапиши на support@cortexapp.ru с почты аккаунта. Укажи номер заказа и дату. Не отправляй коды входа или данные карты.";
      extra = [[{ text: "Поддержка платежей", style: "primary", url: site + "/support" }]];
      break;
    case "help":
      body = "ℹ️ <b>Команды</b>\n/start — начало\n/menu — меню\n/account — привязка\n/status — статус\n/plans — тарифы\n/pay — Stars\n/support — помощь\n/paysupport — вопросы об оплате.";
      break;
    default:
      body = "Твой помощник в экосистеме CORTEX.\n\nУправляй аккаунтом, узнавай о тарифах, оплачивай подписку и обращайся в поддержку. ИИ-диалоги доступны в приложении CORTEX.";
  }
  return {
    text: head + "\n\n" + body, parse_mode: "HTML", disable_web_page_preview: true,
    reply_markup: { inline_keyboard: [...extra, ...buttons(options, linked)] },
  };
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
  const payload = view(page, linked, emoji);
  if (callback) {
    await services.telegram("answerCallbackQuery", { callback_query_id: callback.id });
    if (validId(message?.message_id)) {
      await services.telegram("editMessageText", { chat_id: chatId, message_id: message.message_id, ...payload });
    }
  } else {
    await services.telegram("sendMessage", { chat_id: chatId, ...payload });
  }
  return 200;
}
