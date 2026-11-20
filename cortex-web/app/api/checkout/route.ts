import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { cortexPublishableKey, cortexSupabaseUrl } from "@/lib/cortex-public-config";
import { getRedis } from "@/lib/redis";
import { verifiedCheckoutUrl } from "@/lib/checkout-url";
import { readBoundedJson } from "@/lib/bounded-json";

export const dynamic = "force-dynamic";

const allowedPlans = new Set(["start", "pro", "ultra"]);

function reply(error: string, status: number) {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const billingOrigin = process.env.CORTEX_BILLING_ORIGIN;
  const billingToken = process.env.CORTEX_BILLING_TOKEN;
  if (process.env.CORTEX_WEB_CHECKOUT_ENABLED !== "true" || !billingOrigin || !billingToken) {
    return reply("payments_disabled", 503);
  }
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return reply("forbidden", 403);
  const authorization = request.headers.get("authorization") || "";
  if (!/^Bearer [A-Za-z0-9._-]{40,4096}$/.test(authorization)) return reply("sign_in", 401);
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    return reply("invalid_content_type", 415);
  }
  let input: unknown;
  try { input = await readBoundedJson(request, 1024); } catch { return reply("invalid", 400); }
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).length !== 1 || !allowedPlans.has((input as {plan?: string}).plan || "")) {
    return reply("invalid_plan", 400);
  }

  try {
    const userClient = createClient(cortexSupabaseUrl, cortexPublishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (url, init) => fetch(url, {
        ...init, redirect: "error", signal: AbortSignal.timeout(3500),
      }) },
    });
    const { data, error } = await userClient.auth.getUser(authorization.slice(7));
    const user = data.user;
    if (error || !user?.id || !user.email || !user.email_confirmed_at) return reply("sign_in", 401);

    // Fail closed if Redis is unavailable. A payment endpoint must not lose its abuse limiter.
    const bucket = createHash("sha256").update(user.id).digest("hex").slice(0, 24);
    const claim = await getRedis().set(`cortex:web:checkout:${bucket}`, "1", { nx: true, ex: 30 });
    if (claim !== "OK") return reply("rate_limit", 429);

    const service = new URL("/api/billing", billingOrigin);
    if (service.protocol !== "https:" || service.username || service.password) return reply("payments_disabled", 503);
    const upstream = await fetch(service, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(12000),
      headers: { Authorization: `Bearer ${billingToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ subject: user.id, email: user.email, operation: "checkout", plan: (input as {plan: string}).plan }),
      cache: "no-store",
    });
    if (!upstream.ok) {
      await upstream.body?.cancel().catch(() => {});
      return reply(upstream.status === 503 ? "payments_disabled" : "payment_provider", 503);
    }
    const result: { checkout_url?: unknown } = await upstream.json();
    const checkout = verifiedCheckoutUrl(result.checkout_url);
    if (!checkout) return reply("payment_provider", 503);
    return Response.json({ checkout_url: checkout }, { headers: { "Cache-Control": "no-store" } });
  } catch (failure) {
    console.error("CORTEX checkout initiation failed", failure instanceof Error ? failure.name : "unknown");
    return reply("payment_provider", 503);
  }
}
