import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { cortexPublishableKey, cortexSupabaseUrl } from "@/lib/cortex-public-config";
import { boundedJson, starsInvoiceUrl, starsPlan, telegramBotApi, telegramConfigurationValid } from "@/lib/telegram-stars";

export const runtime = "nodejs";

const answer = (status: number, body: Record<string, unknown>) => NextResponse.json(body, {
  status, headers: { "Cache-Control": "no-store" },
});

const boundedFetch: typeof fetch = (input, init) => fetch(input, {
  ...init, signal: AbortSignal.timeout(3500), redirect: "error",
});

export async function POST(request: NextRequest) {
  // No configured XTR prices or explicit owner opt-in means no checkout.
  if (process.env.CORTEX_TELEGRAM_STARS_ENABLED !== "true" ||
      !telegramConfigurationValid(process.env.CORTEX_TELEGRAM_BOT_TOKEN,
        process.env.CORTEX_TELEGRAM_WEBHOOK_SECRET) || !process.env.CORTEX_SUPABASE_SERVICE_ROLE_KEY) {
    return answer(503, { error: "stars_disabled" });
  }
  const authorization = request.headers.get("authorization") || "";
  if (!/^Bearer [A-Za-z0-9._-]{40,4096}$/.test(authorization)) {
    return answer(401, { error: "login_required" });
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return answer(415, { error: "invalid_content_type" });
  }
  let plan: unknown;
  try {
    const input = await boundedJson(request, 1024);
    if (!input || typeof input !== "object" || Array.isArray(input) ||
        Object.keys(input).some(key => key !== "plan")) throw new Error();
    plan = (input as { plan?: unknown }).plan;
  } catch { return answer(400, { error: "invalid_request" }); }
  if (!starsPlan(plan)) return answer(400, { error: "invalid_plan" });

  const jwt = authorization.slice(7);
  const buyer = createClient(cortexSupabaseUrl, cortexPublishableKey, {
    global: { headers: { Authorization: authorization }, fetch: boundedFetch },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    const { data: { user }, error: identityError } = await buyer.auth.getUser(jwt);
    if (identityError || !user?.email_confirmed_at) return answer(401, { error: "login_required" });

    // SQL independently verifies auth.uid, verified email and live auth.sessions.
    // No subject or XTR price may be supplied by the client.
    const { data: order, error: reserveError } = await buyer.rpc("cortex_stars_new_order", { p_plan: plan });
    if (reserveError) return answer(503, { error: "billing_unavailable" });
    if (order?.error) {
      const conflict = ["payment_pending", "other_checkout_pending", "payment_processing"].includes(order.error);
      return answer(order.error === "rate_limited" ? 429 : conflict ? 409 : 503, { error: order.error });
    }
    if (!order || typeof order.id !== "string" || !Number.isInteger(order.stars) ||
        order.stars < 1 || order.stars > 10000 || order.plan !== plan) {
      return answer(503, { error: "billing_unavailable" });
    }
    if (order.status === "invoiced") {
      const invoice = starsInvoiceUrl(order.invoice_url);
      return invoice ? answer(200, { id: order.id, stars: order.stars, invoice_url: invoice })
        : answer(503, { error: "invoice_unavailable" });
    }
    if (order.status !== "created") return answer(409, { error: "payment_pending" });

    const link = await telegramBotApi<string>(process.env.CORTEX_TELEGRAM_BOT_TOKEN, "createInvoiceLink", {
      title: `CORTEX ${plan.toUpperCase()}`,
      description: `Доступ к тарифу CORTEX ${plan.toUpperCase()} на один месяц. Без автопродления.`,
      payload: `cortex-stars:${order.id}`,
      currency: "XTR",
      provider_token: "",
      prices: [{ label: `CORTEX ${plan.toUpperCase()}`, amount: order.stars }],
    });
    const invoice = starsInvoiceUrl(link);
    if (!invoice) return answer(502, { error: "invoice_unavailable" });

    const admin = createClient(cortexSupabaseUrl, process.env.CORTEX_SUPABASE_SERVICE_ROLE_KEY, {
      global: { fetch: boundedFetch }, auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: finalized, error: finalizeError } = await admin.rpc("cortex_stars_invoice_ready", {
      p_id: order.id, p_url: invoice,
    });
    if (finalizeError || finalized?.error || !starsInvoiceUrl(finalized?.invoice_url)) {
      return answer(503, { error: "invoice_unavailable" });
    }
    return answer(200, { id: order.id, stars: order.stars, invoice_url: finalized.invoice_url });
  } catch {
    // Avoid exposing the Telegram bot token, invoice payload or provider errors.
    return answer(503, { error: "billing_unavailable" });
  }
}
