import type { Metadata } from "next";
import { telegramConfigurationValid } from "@/lib/telegram-stars";
import { loadPublicPlans, loadPublicStarsPrices } from "@/lib/public-catalog";
import { PaymentMethods } from "@/components/PaymentMethods";
import "./payment.css";

export const metadata: Metadata = {
  title: "Выбор оплаты — CORTEX",
  description: "Выберите тариф CORTEX и удобный способ оплаты подписки.",
  robots: { index: false, follow: false },
};

type Plan = "start" | "pro" | "ultra";

export default async function PaymentPage({
  searchParams,
}: { searchParams: Promise<{ plan?: string | string[] }> }) {
  const params = await searchParams;
  const initialPlan: Plan = params.plan === "start" || params.plan === "ultra" ? params.plan : "pro";
  const [allPlans, starsPrices] = await Promise.all([loadPublicPlans(), loadPublicStarsPrices()]);
  const prices = (allPlans || []).filter(plan =>
    (plan.code === "start" || plan.code === "pro" || plan.code === "ultra") && plan.price_kopecks > 0)
    .map(plan => ({ code: plan.code as Plan, price_kopecks: plan.price_kopecks }));
  return <PaymentMethods initialPlan={initialPlan} prices={prices} starsPrices={starsPrices || []}
    starsConfigured={process.env.CORTEX_TELEGRAM_STARS_ENABLED === "true" &&
      telegramConfigurationValid(process.env.CORTEX_TELEGRAM_BOT_TOKEN,
        process.env.CORTEX_TELEGRAM_WEBHOOK_SECRET) && Boolean(process.env.CORTEX_SUPABASE_SERVICE_ROLE_KEY)} />;
}
