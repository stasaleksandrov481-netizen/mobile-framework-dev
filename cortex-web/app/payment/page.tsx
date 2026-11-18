import type { Metadata } from "next";
import { cortexPublishableKey, cortexSupabaseUrl } from "@/lib/cortex-public-config";
import { telegramConfigurationValid } from "@/lib/telegram-stars";
import { PaymentMethods } from "@/components/PaymentMethods";
import "./payment.css";

export const metadata: Metadata = {
  title: "Выбор оплаты — CORTEX",
  description: "Выберите тариф CORTEX и удобный способ оплаты подписки.",
  robots: { index: false, follow: false },
};

type Plan = "start" | "pro" | "ultra";
type Price = { code: Plan; price_kopecks: number };
type StarsPrice = { plan: Plan; stars: number; enabled: boolean };

async function loadPrices(): Promise<Price[]> {
  try {
    const url = new URL("/rest/v1/cortex_plans", cortexSupabaseUrl);
    url.searchParams.set("select", "code,price_kopecks");
    url.searchParams.set("code", "in.(start,pro,ultra)");
    url.searchParams.set("order", "rank");
    const response = await fetch(url, {
      headers: { apikey: cortexPublishableKey },
      next: { revalidate: 300 }, signal: AbortSignal.timeout(3500),
    });
    if (!response.ok) return [];
    const rows: unknown = await response.json();
    if (!Array.isArray(rows) || rows.length !== 3 || new Set(rows.map(row => row?.code)).size !== 3 || !rows.every(row =>
      row && ["start", "pro", "ultra"].includes(row.code) &&
      Number.isSafeInteger(row.price_kopecks) && row.price_kopecks > 0)) return [];
    return rows as Price[];
  } catch { return []; }
}

async function loadStarsPrices(): Promise<StarsPrice[]> {
  try {
    const response = await fetch(new URL("/rest/v1/rpc/cortex_stars_public_prices", cortexSupabaseUrl), {
      headers: { apikey: cortexPublishableKey },
      next: { revalidate: 60 }, signal: AbortSignal.timeout(3500),
    });
    if (!response.ok) return [];
    const rows: unknown = await response.json();
    if (!Array.isArray(rows) || rows.length !== 3 ||
        new Set(rows.map(row => row?.plan)).size !== 3 || !rows.every(row =>
          row && ["start", "pro", "ultra"].includes(row.plan) &&
          Number.isInteger(row.stars) && row.stars >= 1 && row.stars <= 10000 &&
          typeof row.enabled === "boolean")) return [];
    return rows as StarsPrice[];
  } catch { return []; }
}

export default async function PaymentPage({
  searchParams,
}: { searchParams: Promise<{ plan?: string | string[] }> }) {
  const params = await searchParams;
  const initialPlan: Plan = params.plan === "start" || params.plan === "ultra" ? params.plan : "pro";
  const [prices, starsPrices] = await Promise.all([loadPrices(), loadStarsPrices()]);
  return <PaymentMethods initialPlan={initialPlan} prices={prices} starsPrices={starsPrices}
    starsConfigured={process.env.CORTEX_TELEGRAM_STARS_ENABLED === "true" &&
      telegramConfigurationValid(process.env.CORTEX_TELEGRAM_BOT_TOKEN,
        process.env.CORTEX_TELEGRAM_WEBHOOK_SECRET) && Boolean(process.env.CORTEX_SUPABASE_SERVICE_ROLE_KEY)} />;
}
