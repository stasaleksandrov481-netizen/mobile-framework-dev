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
function buttons(options: EmojiOptions, hasLink: boolean): Button[][] {
  return [
    [hasLink
      ? nav("Личный кабинет", "👤", "account", options, options.account, "success")
      : open("Подключить аккаунт CORTEX", "🔗", site + "/account?tab=security", options, options.account, "primary")],
    [nav("Тарифы", "💎", "plans"), nav("Оплата", "⭐", "pay", options, options.payment)],
    [open("Открыть CORTEX", "↗", site, options, options.brand)],
    [nav("Помощь", "💬", "support", options, options.support), open("Новости", "📢", news)],
  ];
}
function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function displayName(person?: TelegramPerson): string {
  if (typeof person?.first_name !== "string") return "";
  return escapeHtml(person.first_name.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "").trim().slice(0, 60));
}
function view(page: string, linked: boolean, options: EmojiOptions, name = ""): View {
  const mark = premium("✦", options.brand, options);
  let head = "", body = "";
  let extra: Button[][] = [];
  const back = [nav("В главное меню", "‹", "home")];
  switch (page) {
    case "account":
    case "status":
      head = "👤 <b>Твой аккаунт</b>";
      body = linked
        ? "🟢 <b>Подключение активно</b>\nTelegram связан с твоим профилем CORTEX.\n\n<blockquote>Тариф, баланс и настройки — в личном кабинете.</blockquote>"
        : "⚪ <b>Аккаунт не подключён</b>\n\nОткрой раздел «Безопасность» в кабинете, нажми «Привязать Telegram» и вернись сюда по защищённой ссылке.\n\n<blockquote>Один аккаунт для сайта и Telegram. Пароль и коды входа боту не нужны.</blockquote>";
      extra = linked
        ? [[open("Открыть кабинет", "↗", site + "/account", {}, undefined, "primary")],
           [open("Безопасность", "🔒", site + "/account?tab=security"), nav("Обновить статус", "↻", "status")]]
        : [[open("Подключить аккаунт", "🔗", site + "/account?tab=security", options, options.account, "primary")]];
      break;
    case "plans":
      head = "💎 <b>Выбери свой CORTEX</b>";
      body = "Больше возможностей. Больше свободы.\n\nСравни доступные модели, лимиты и подписки в актуальном каталоге.\n\n<blockquote>Условия и цены всегда берутся с официального сайта.</blockquote>";
      extra = [[open("Сравнить тарифы", "↗", site + "/pricing", {}, undefined, "primary")],
        [nav("Способы оплаты", "⭐", "pay", options, options.payment)]];
      break;
    case "pay":
      head = "⭐ <b>Telegram Stars</b>";
      body = "Пополнение и подписки CORTEX — через официальный счёт Telegram.\n\n<blockquote>Выбери предложение на сайте. Доступ активируется после подтверждения платежа сервером.</blockquote>\n\n" +
        (linked ? "🟢 Аккаунт подключён." : "Для управления покупками войди в свой аккаунт CORTEX.");
      extra = [[open("Перейти к оплате", "⭐", site + "/payment", options, options.payment, "success")],
        [nav("Помощь с платежом", "💬", "paysupport")]];
      break;
    case "support":
      head = "💬 <b>Мы на связи</b>";
      body = "Проблема с аккаунтом, оплатой или приложением? Поможем разобраться.\n\n<b>Почта поддержки</b>\n<code>support@cortexapp.ru</code>\n\n<blockquote>Не отправляй пароли, платёжные реквизиты или коды входа.</blockquote>";
      extra = [[open("Написать в поддержку", "↗", site + "/support", options, options.support, "primary")],
        [nav("Платежи", "⭐", "paysupport"), nav("Как пользоваться", "📖", "help")]];
      break;
    case "paysupport":
      head = "🧾 <b>Помощь с оплатой</b>";
      body = "Платёж не появился или возник вопрос по подписке?\n\nНапиши на <code>support@cortexapp.ru</code> с почты аккаунта. Укажи дату и номер заказа, если он есть.\n\n<blockquote>Не отправляй коды входа или данные карты.</blockquote>";
      extra = [[open("Открыть поддержку", "💬", site + "/support", {}, undefined, "primary")]];
      break;
    case "help":
      head = "📖 <b>Навигация по CORTEX</b>";
      body = "<b>Управление</b>\n/account — аккаунт и безопасность\n/plans — тарифы\n/pay — Telegram Stars\n\n<b>Помощь</b>\n/support — поддержка\n/paysupport — вопросы оплаты\n/menu — главное меню";
      break;
    default:
      head = name ? mark + " <b>Привет, " + name + ".</b>" : mark + " <b>Добро пожаловать в CORTEX</b>";
      body = "<i>Твой цифровой центр управления.</i>\n\n" +
        (linked
          ? "🟢 <b>Аккаунт подключён</b>\nВсё под рукой: подписки, тарифы и поддержка."
          : "⚪ <b>Начнём с подключения</b>\nСвяжи Telegram с аккаунтом CORTEX, чтобы управлять им прямо здесь.") +
        "\n\n" + "Для общения с ИИ открой CORTEX.";
  }
  return { text: head + "\n\n" + body, parse_mode: "HTML", disable_web_page_preview: true,
    reply_markup: { inline_keyboard: page === "home" ? buttons(options, linked) : [...extra, back] } };
}
const guideHtml = '<h2>Твой путеводитель по CORTEX</h2><p>Всё, что нужно для управления аккаунтом.</p><hr><h3>Подключение</h3><ol><li>Войди на cortexapp.ru.</li><li>Открой раздел «Безопасность».</li><li>Нажми «Привязать Telegram», затем Start в боте.</li></ol><h3>Подписки и оплата</h3><p>Тарифы на сайте, покупка через Telegram Stars и поддержка платежей.</p><details><summary>Если ссылка истекла</summary><p>Создай новую в личном кабинете. Ссылка действует 5 минут, не передавай её другим.</p></details><hr><p>Поддержка: <a href="mailto:support@cortexapp.ru">support@cortexapp.ru</a></p>';
async function sendGuide(services: BotServices, chatId: number, payload: View) {
  // Bot API 10.1+; keep the standard message as a compatibility fallback.
  try {
    await services.telegram("sendRichMessage", {chat_id: chatId, rich_message: {html: guideHtml},
      reply_markup: {inline_keyboard: [[open("Личный кабинет", "↗", site + "/account", {}, undefined, "primary")],
        [open("Тарифы", "💎", site + "/pricing"), open("Поддержка", "💬", site + "/support")]]}});
  } catch {
    await services.telegram("sendMessage", {chat_id: chatId, ...payload});
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
      await sendWelcome(services, chatId, { ...home, text: "✅ <b>Telegram успешно привязан</b>\n\n<i>Теперь CORTEX ещё ближе.</i>\n\n🟢 Аккаунт подключён. Твой кабинет, тарифы и поддержка — в меню ниже." });
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
      text: "💬 <b>Здесь — управление CORTEX.</b>\nДля диалога с ИИ открой приложение. Для аккаунта, оплаты и помощи выбери действие ниже.",
      reply_markup: {inline_keyboard: [[open("Открыть CORTEX", "↗", site, {}, undefined, "primary")],
        [nav("Главное меню", "‹", "home")]]}});
  } else {
    await services.telegram("sendMessage", { chat_id: chatId, ...payload });
  }
  return 200;
}
