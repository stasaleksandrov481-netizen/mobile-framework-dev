// Configure the existing Telegram bot only after the server rollout is verified.
import { botCommands } from "../lib/telegram-bot.ts";
const token = process.env.CORTEX_TELEGRAM_BOT_TOKEN;
if (!token || !/^[0-9]{6,16}:[A-Za-z0-9_-]{30,128}$/.test(token)) {
  throw new Error("CORTEX_TELEGRAM_BOT_TOKEN missing or invalid");
}
async function configure(method, body) {
  // Never print the Bot API URL because it contains the bot token.
  const res = await fetch("https://api.telegram.org/bot" + token + "/" + method, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(10000),
  });
  const answer = await res.json();
  if (!res.ok || answer?.ok !== true) throw new Error(method + " failed");
  console.log(method + " configured");
}
await configure("setMyCommands", { commands: botCommands, scope: { type: "all_private_chats" } });
await configure("setChatMenuButton", { menu_button: { type: "commands" } });
await configure("setMyShortDescription", { short_description: "ИИ-помощник, аккаунт, тарифы и поддержка CORTEX." });
await configure("setMyDescription", {
  description: "Официальный бот CORTEX. Привяжи Telegram в разделе «Безопасность» личного кабинета на cortexapp.ru, управляй тарифами, оплачивай через Telegram Stars и обращайся в поддержку.",
});
