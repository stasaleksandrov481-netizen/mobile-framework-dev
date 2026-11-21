import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = name => readFileSync(new URL(name, import.meta.url), "utf8");
test("CORTEX security opens Telegram, completing link inside bot without returning", () => {
  const dashboard = read("../components/AccountDashboard.tsx");
  const widget = read("../components/TelegramSecurityLink.tsx");
  assert.match(dashboard, /<TelegramSecurityLink active=\{panel === "security"\} \/>/);
  assert.match(widget, /window\.location\.assign\(destination\)/);
  assert.match(widget, /Привязать Telegram/);
  assert.match(widget, /Отвязать Telegram/);
  assert.doesNotMatch(widget, /Подтвердить привязку|mutate\("confirm"\)/);
});
test("One-time token is tied to a current verified Supabase session", () => {
  const api = read("../app/api/telegram/link/route.ts");
  const webhook = read("../app/api/telegram/webhook/route.ts");
  const bot = read("../lib/telegram-bot.ts");
  const sql = read("../../supabase/migrations/20261121160500_cortex_telegram_account_link.sql");
  assert.match(api, /auth\.getUser\(jwt\)/);
  assert.match(api, /cortex_telegram_active_session/);
  assert.match(api, /randomBytes\(32\)/);
  assert.match(api, /createHash\("sha256"\)/);
  assert.match(api, /sameOrigin\(request\)/);
  assert.doesNotMatch(api, /action === "confirm"/);
  assert.match(webhook, /state: "linked", telegram_id: person\.id/);
  assert.match(webhook, /token_sha256: null, expires_at: null/);
  assert.match(bot, /message\?\.chat\?\.type !== "private"/);
  assert.match(sql, /enable row level security/g);
  assert.match(sql, /telegram_id bigint unique/);
  assert.match(sql, /auth\.sessions/);
  assert.doesNotMatch(sql, /state = 'verified'/);
});
test("Stars payment ledger, receipts and refund flow remain isolated", () => {
  const webhook = read("../app/api/telegram/webhook/route.ts");
  assert.match(webhook, /x-telegram-bot-api-secret-token/);
  assert.match(webhook, /CORTEX_TELEGRAM_STARS_ENABLED !== "true"/);
  assert.match(webhook, /CORTEX_TELEGRAM_BOT_ENABLED !== "true"/);
  assert.match(webhook, /processTelegramStarsUpdate\(update/);
  assert.match(webhook, /verifyTelegramStarsReceipt/);
  assert.match(webhook, /processCortexBotUpdate/);
});
test("Bot menu metadata and premium emoji slots use official methods", () => {
  const source = read("../lib/telegram-bot.ts");
  const script = read("../scripts/configure-telegram-bot.mjs");
  assert.match(source, /icon_custom_emoji_id/);
  assert.match(source, /"danger"/);
  for (const method of ["setMyCommands", "setChatMenuButton", "setMyShortDescription", "setMyDescription"]) assert.match(script, new RegExp(method));
});
