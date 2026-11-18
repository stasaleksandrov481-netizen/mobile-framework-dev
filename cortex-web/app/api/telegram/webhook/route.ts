import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { cortexSupabaseUrl } from "@/lib/cortex-public-config";
import { boundedJson, telegramBotApi, telegramConfigurationValid,
  verifyTelegramStarsReceipt, webhookSecretValid } from "@/lib/telegram-stars";
import { processTelegramStarsUpdate, type TelegramStarsUpdate } from "@/lib/telegram-stars-webhook";

export const runtime = "nodejs";

const respond = (status: number) => NextResponse.json({ ok: status === 200 }, {
  status, headers: { "Cache-Control": "no-store" },
});

const boundedFetch: typeof fetch = (input, init) => fetch(input, {
  ...init, signal: AbortSignal.timeout(3500), redirect: "error",
});

export async function POST(request: NextRequest) {
  const token = process.env.CORTEX_TELEGRAM_BOT_TOKEN;
  const secret = process.env.CORTEX_TELEGRAM_WEBHOOK_SECRET;
  const serviceRole = process.env.CORTEX_SUPABASE_SERVICE_ROLE_KEY;
  if (process.env.CORTEX_TELEGRAM_STARS_ENABLED !== "true" ||
      !telegramConfigurationValid(token, secret) || !serviceRole) {
    return respond(503);
  }
  if (!webhookSecretValid(request.headers.get("x-telegram-bot-api-secret-token"), secret)) {
    return respond(401);
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) return respond(415);

  let update: TelegramStarsUpdate;
  try {
    const decoded = await boundedJson(request, 16_384);
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) return respond(400);
    update = decoded as TelegramStarsUpdate;
  } catch { return respond(400); }

  const admin = createClient(cortexSupabaseUrl, serviceRole, {
    global: { fetch: boundedFetch }, auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    const status = await processTelegramStarsUpdate(update, {
      rpc: async (name, params) => admin.rpc(name, params),
      telegram: (name, params) => telegramBotApi(token, name, params),
      verify: receipt => verifyTelegramStarsReceipt(token, receipt),
    });
    return respond(status);
  } catch {
    // Telegram can retry. Never acknowledge an uncommitted payment.
    return respond(503);
  }
}
