import { NextResponse } from "next/server";
import { loadPublicStarsPrices } from "@/lib/public-catalog";
import { telegramBotApi, telegramConfigurationValid } from "@/lib/telegram-stars";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let botHealth: { until: number; check: Promise<boolean> } | undefined;

function botReachable(): Promise<boolean> {
  if (botHealth && botHealth.until > Date.now()) return botHealth.check;
  const check = telegramBotApi<{ id?: unknown }>(process.env.CORTEX_TELEGRAM_BOT_TOKEN,
    "getMe", {}).then(result => Number.isSafeInteger(result?.id) && Number(result.id) > 0)
    .catch(() => false);
  botHealth = { until: Date.now() + 30_000, check };
  return check;
}

export async function GET() {
  const configured = process.env.CORTEX_TELEGRAM_STARS_ENABLED === "true" &&
    Boolean(process.env.CORTEX_SUPABASE_SERVICE_ROLE_KEY) &&
    telegramConfigurationValid(process.env.CORTEX_TELEGRAM_BOT_TOKEN,
      process.env.CORTEX_TELEGRAM_WEBHOOK_SECRET);

  if (!configured) {
    return NextResponse.json({ available: false }, { headers: { "Cache-Control": "no-store" } });
  }

  const [prices, botOk] = await Promise.all([loadPublicStarsPrices(), botReachable()]);
  const available = Boolean(prices && prices.length === 3 &&
    prices.every(price => price.enabled && price.stars > 0) && botOk);
  return NextResponse.json({ available }, { headers: { "Cache-Control": "no-store" } });
}
