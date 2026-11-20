import { cortexPublishableKey, cortexSupabaseUrl } from "@/lib/cortex-public-config";
import { createPublicCache } from "@/lib/public-cache";

export type PublicPlanCode = "guest" | "free" | "start" | "pro" | "ultra";
export type PaidPlanCode = "start" | "pro" | "ultra";
export type PublicPlan = {
  code: PublicPlanCode;
  price_kopecks: number;
  daily_tokens: number;
  advanced_tokens: number;
};
export type PublicStarsPrice = { plan: PaidPlanCode; stars: number; enabled: boolean };

const planCodes = new Set<PublicPlanCode>(["guest", "free", "start", "pro", "ultra"]);
const paidCodes = new Set<PaidPlanCode>(["start", "pro", "ultra"]);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function validPlans(value: unknown): value is PublicPlan[] {
  return Array.isArray(value) && value.length === planCodes.size &&
    new Set(value.map((row: unknown) => isRecord(row) ? row.code : undefined)).size === planCodes.size &&
    value.every((row: unknown) => isRecord(row) && planCodes.has(row.code as PublicPlanCode) &&
      Number.isSafeInteger(row.price_kopecks) && Number(row.price_kopecks) >= 0 &&
      Number.isSafeInteger(row.daily_tokens) && Number(row.daily_tokens) >= 0 &&
      Number.isSafeInteger(row.advanced_tokens) && Number(row.advanced_tokens) >= 0);
}

function validStarsPrices(value: unknown): value is PublicStarsPrice[] {
  return Array.isArray(value) && value.length === paidCodes.size &&
    new Set(value.map((row: unknown) => isRecord(row) ? row.plan : undefined)).size === paidCodes.size &&
    value.every((row: unknown) => isRecord(row) && paidCodes.has(row.plan as PaidPlanCode) &&
      Number.isSafeInteger(row.stars) && Number(row.stars) >= 1 && Number(row.stars) <= 10_000 &&
      typeof row.enabled === "boolean");
}

const getPublicPlansCached = createPublicCache<PublicPlan[]>({
  key: "cortex:web:public:v1:plans",
  ttlSeconds: 300,
  validate: validPlans,
  async load() {
    const url = new URL("/rest/v1/cortex_plans", cortexSupabaseUrl);
    url.searchParams.set("select", "code,price_kopecks,daily_tokens,advanced_tokens");
    url.searchParams.set("order", "rank");
    const response = await fetch(url, {
      headers: { apikey: cortexPublishableKey },
      next: { revalidate: 300 }, signal: AbortSignal.timeout(3500),
    });
    return response.ok ? response.json() : null;
  },
});

const getPublicStarsPricesCached = createPublicCache<PublicStarsPrice[]>({
  key: "cortex:web:public:v1:stars",
  ttlSeconds: 60,
  validate: validStarsPrices,
  async load() {
    const response = await fetch(new URL("/rest/v1/rpc/cortex_stars_public_prices", cortexSupabaseUrl), {
      headers: { apikey: cortexPublishableKey },
      next: { revalidate: 60 }, signal: AbortSignal.timeout(3500),
    });
    return response.ok ? response.json() : null;
  },
});

export const loadPublicPlans = getPublicPlansCached;
export const loadPublicStarsPrices = getPublicStarsPricesCached;
