import { getRedis } from "@/lib/redis";
import { createNavigationClaim } from "@/lib/telegram-navigation-cache";
import { createBotStarsCheckout } from "@/lib/telegram-bot-checkout";
import { loadPublicPlans, loadPublicStarsPrices } from "@/lib/public-catalog";
import { readBoundedJson } from "@/lib/bounded-json";
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { cortexSupabaseUrl } from "@/lib/cortex-public-config";
import { telegramBotApi, telegramConfigurationValid,
  verifyTelegramStarsReceipt, webhookSecretValid } from "@/lib/telegram-stars";
import { processTelegramStarsUpdate, type TelegramStarsUpdate } from "@/lib/telegram-stars-webhook";
import { processCortexBotUpdate, type CortexTelegramUpdate } from "@/lib/telegram-bot";

export const runtime = "nodejs";
const claimPublicNavigation=createNavigationClaim((script,keys,args)=>getRedis().eval(script,keys,args),()=>process.env.CORTEX_TELEGRAM_WEBHOOK_SECRET);

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
  const starsEnabled = process.env.CORTEX_TELEGRAM_STARS_ENABLED === "true";
  const botEnabled = process.env.CORTEX_TELEGRAM_BOT_ENABLED === "true";
  if ((!starsEnabled && !botEnabled) ||
      !telegramConfigurationValid(token, secret) || !serviceRole) {
    return respond(503);
  }
  if (!webhookSecretValid(request.headers.get("x-telegram-bot-api-secret-token"), secret)) {
    return respond(401);
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) return respond(415);

  let update: TelegramStarsUpdate;
  try {
    const decoded = await readBoundedJson(request, 16_384);
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) return respond(400);
    update = decoded as TelegramStarsUpdate;
  } catch { return respond(400); }

  const admin = createClient(cortexSupabaseUrl, serviceRole, {
    global: { fetch: boundedFetch }, auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    // Payment events are processed by the original, independently verified Stars engine.
    // Other updates are interactive bot commands; never route payments through chat logic.
    const isPayment = Boolean(update.pre_checkout_query || update.message?.successful_payment ||
      update.message?.refunded_payment);
    // Stage bot features separately; payment processing retains its original path.
    if (isPayment || !botEnabled) {
      if (isPayment && !starsEnabled) return respond(503);
      const status = await processTelegramStarsUpdate(update, {
        rpc: async (name, params) => admin.rpc(name, params),
        telegram: (name, params) => telegramBotApi(token, name, params),
        verify: receipt => verifyTelegramStarsReceipt(token, receipt),
      });
      return respond(status);
    }
    const durableClaim=async(updateId:number,chatId:number)=>{
      const result=await admin.rpc("cortex_telegram_claim_update",{p_update:updateId,p_chat:chatId});
      if(result.error)throw new Error("bot_update_unavailable");
      return result.data===true;
    };
    const status = await processCortexBotUpdate(update as CortexTelegramUpdate, {
      richUi: true,
      checkout: starsEnabled ? (telegramId,plan)=>createBotStarsCheckout(telegramId,plan,{
        rpc: async (name,params)=>admin.rpc(name,params),
        telegram: (name,params)=>telegramBotApi(token,name,params),
      }) : undefined,
      catalog: async () => {
        const [plans,stars]=await Promise.all([loadPublicPlans(),loadPublicStarsPrices()]);
        return plans ? {plans,stars:stars??[],starsEnabled} : null;
      },
      claim: durableClaim,
      claimNavigation:(updateId,chatId)=>claimPublicNavigation(updateId,chatId,()=>durableClaim(updateId,chatId)),
      linked: async telegramId => {
        const { data, error } = await admin.from("cortex_telegram_account_links")
          .select("account_id").eq("telegram_id", telegramId).eq("state", "linked").maybeSingle();
        if (error) throw new Error("bot_link_unavailable");
        return Boolean(data);
      },
      verifyLink: async (hash, person) => {
        const now = new Date().toISOString();
        const { data, error } = await admin.from("cortex_telegram_account_links").update({
          state: "linked", telegram_id: person.id, telegram_username: person.username,
          telegram_name: person.name, token_sha256: null, expires_at: null, updated_at: now,
        }).eq("token_sha256", hash).eq("state", "pending").gt("expires_at", now)
          .select("account_id").maybeSingle();
        // An already linked Telegram account also fails the DB unique constraint.
        if (error?.code === "23505") return false;
        if (error) throw new Error("bot_link_unavailable");
        return Boolean(data);
      },
      telegram: (name, params) => telegramBotApi(token, name, params),
    }, {
      enabled: process.env.CORTEX_TELEGRAM_PREMIUM_EMOJI_ENABLED === "true",
      brand: process.env.CORTEX_TELEGRAM_EMOJI_BRAND_ID,
      account: process.env.CORTEX_TELEGRAM_EMOJI_ACCOUNT_ID,
      payment: process.env.CORTEX_TELEGRAM_EMOJI_PAYMENT_ID,
      support: process.env.CORTEX_TELEGRAM_EMOJI_SUPPORT_ID,
    });
    return respond(status);
  } catch {
    // Telegram can retry. Never acknowledge an uncommitted payment.
    return respond(503);
  }
}
