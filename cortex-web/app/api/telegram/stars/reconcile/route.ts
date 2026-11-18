import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { cortexPublishableKey, cortexSupabaseUrl } from "@/lib/cortex-public-config";
import { boundedJson, findTelegramStarsPurchase, telegramConfigurationValid } from "@/lib/telegram-stars";

export const runtime = "nodejs";

const reply = (status: number, body: Record<string, unknown>) => NextResponse.json(body, {
  status, headers: { "Cache-Control": "no-store" },
});
const boundedFetch: typeof fetch = (url, init) => fetch(url, {
  ...init, redirect: "error", signal: AbortSignal.timeout(3500),
});
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const token = process.env.CORTEX_TELEGRAM_BOT_TOKEN;
  if (process.env.CORTEX_TELEGRAM_STARS_ENABLED !== "true" ||
      !telegramConfigurationValid(token, process.env.CORTEX_TELEGRAM_WEBHOOK_SECRET) ||
      !process.env.CORTEX_SUPABASE_SERVICE_ROLE_KEY) {
    return reply(503, { error: "stars_disabled" });
  }
  const auth = request.headers.get("authorization") || "";
  if (!/^Bearer [A-Za-z0-9._-]{40,4096}$/.test(auth)) return reply(401, { error: "login_required" });
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return reply(415, { error: "invalid_content_type" });
  }
  let id: string;
  try {
    const body = await boundedJson(request, 1024);
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body).length !== 1 || typeof (body as { id?: unknown }).id !== "string" ||
        !uuid.test((body as { id: string }).id)) throw new Error();
    id = (body as { id: string }).id;
  } catch { return reply(400, { error: "invalid_request" }); }

  const buyer = createClient(cortexSupabaseUrl, cortexPublishableKey, {
    global: { headers: { Authorization: auth }, fetch: boundedFetch },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    const { data: { user }, error: userError } = await buyer.auth.getUser(auth.slice(7));
    if (userError || !user?.email_confirmed_at) return reply(401, { error: "login_required" });
    // This SQL RPC verifies buyer+current auth session and atomically limits
    // each order to one scan per 30 seconds, even across Vercel instances.
    const { data: order, error: startError } = await buyer.rpc("cortex_stars_reconcile_start", { p_id: id });
    if (startError) return reply(503, { error: "billing_unavailable" });
    if (order?.error === "rate_limited") return reply(429, { error: "rate_limited" });
    if (order?.error) return reply(404, { error: "order_unavailable" });
    if (order?.status === "paid" || order?.status === "refunded") return reply(200, { status: order.status });
    if (order?.status !== "prechecked" || order?.id !== id ||
        !Number.isSafeInteger(order.buyer) || order.buyer <= 0 ||
        !Number.isInteger(order.stars) || order.stars < 1 || order.stars > 10000) {
      return reply(202, { status: "pending" });
    }

    const charge = await findTelegramStarsPurchase(token, { id, buyer: order.buyer, stars: order.stars });
    if (!charge) return reply(202, { status: "pending" });

    const admin = createClient(cortexSupabaseUrl, process.env.CORTEX_SUPABASE_SERVICE_ROLE_KEY, {
      global: { fetch: boundedFetch }, auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: confirmed, error: confirmError } = await admin.rpc("cortex_stars_confirm", {
      p_id: id, p_charge: charge, p_buyer: order.buyer, p_stars: order.stars,
    });
    if (confirmError || confirmed?.ok !== true) return reply(503, { error: "billing_unavailable" });
    return reply(200, { status: confirmed.status === "paid" ? "paid" : "refunded" });
  } catch {
    // Never convert a failed provider/DB lookup into a paid state.
    return reply(503, { error: "billing_unavailable" });
  }
}
