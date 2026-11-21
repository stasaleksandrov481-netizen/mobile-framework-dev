import { createHash, randomBytes } from "node:crypto";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { cortexPublishableKey, cortexSupabaseUrl } from "@/lib/cortex-public-config";
import { telegramBotApi, telegramConfigurationValid } from "@/lib/telegram-stars";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type State = "pending" | "verified" | "linked";
type LinkRow = {
  account_id: string; telegram_id: number | null; telegram_username: string | null;
  telegram_name: string | null; state: State; token_sha256: string | null;
  expires_at: string | null; updated_at: string;
};
const table = "cortex_telegram_account_links";
const response = (status: number, data: Record<string, unknown>) => NextResponse.json(data, {
  status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
});
const requestFetch: typeof fetch = (input, init) => fetch(input, {
  ...init, redirect: "error", signal: AbortSignal.timeout(5000),
});
const date = () => new Date().toISOString();

async function account(request: NextRequest): Promise<{ user: User; admin: SupabaseClient } | null> {
  const bearer = request.headers.get("authorization") || "";
  if (!/^Bearer [A-Za-z0-9._-]{40,4096}$/.test(bearer)) return null;
  const service = process.env.CORTEX_SUPABASE_SERVICE_ROLE_KEY;
  if (!service) return null;
  const jwt = bearer.slice(7);
  const auth = createClient(cortexSupabaseUrl, cortexPublishableKey, {
    global: { headers: { Authorization: bearer }, fetch: requestFetch },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error } = await auth.auth.getUser(jwt);
  if (error || !user?.email_confirmed_at) return null;
  const { data: live, error: liveError } = await auth.rpc("cortex_telegram_active_session");
  if (liveError || live !== true) return null;
  return {
    user,
    admin: createClient(cortexSupabaseUrl, service, {
      global: { fetch: requestFetch }, auth: { persistSession: false, autoRefreshToken: false },
    }),
  };
}

function safeState(row: LinkRow | null) {
  if (!row) return { state: "none" };
  if (row.state !== "linked" && (!row.expires_at || Date.parse(row.expires_at) <= Date.now())) {
    return { state: "expired" };
  }
  return {
    state: row.state, username: row.telegram_username, name: row.telegram_name,
    expires_at: row.state !== "linked" ? row.expires_at : null,
  };
}

async function rowFor(admin: SupabaseClient, id: string): Promise<LinkRow | null> {
  const { data, error } = await admin.from(table).select(
    "account_id,telegram_id,telegram_username,telegram_name,state,token_sha256,expires_at,updated_at",
  ).eq("account_id", id).maybeSingle();
  if (error) throw new Error("link_storage_unavailable");
  return data as LinkRow | null;
}

function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  return Boolean(origin && origin === request.nextUrl.origin);
}

async function authenticated(request: NextRequest) {
  if (process.env.CORTEX_TELEGRAM_BOT_ENABLED !== "true" ||
      !process.env.CORTEX_SUPABASE_SERVICE_ROLE_KEY ||
      !telegramConfigurationValid(process.env.CORTEX_TELEGRAM_BOT_TOKEN,
        process.env.CORTEX_TELEGRAM_WEBHOOK_SECRET)) return null;
  return account(request);
}

export async function GET(request: NextRequest) {
  try {
    const context = await authenticated(request);
    if (!context) return response(401, { error: "login_required" });
    return response(200, safeState(await rowFor(context.admin, context.user.id)));
  } catch { return response(503, { error: "link_unavailable" }); }
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return response(403, { error: "origin" });
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return response(415, { error: "content_type" });
  }
  try {
    const raw = await request.text();
    if (raw.length > 256) return response(400, { error: "invalid" });
    const payload: unknown = JSON.parse(raw);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return response(400, { error: "invalid" });
    const action = (payload as { action?: unknown }).action;
    if (Object.keys(payload).length !== 1 || action !== "create") {
      return response(400, { error: "invalid" });
    }
    const context = await authenticated(request);
    if (!context) return response(401, { error: "login_required" });
    const { admin, user } = context;
    const current = await rowFor(admin, user.id);
    if (current?.state === "linked") return response(409, { error: "already_linked" });
    if (current?.updated_at && Date.now() - Date.parse(current.updated_at) < 20_000) {
      return response(429, { error: "retry_later" });
    }
    // Retrieve the configured bot's real username, never guess it or embed the token in source code.
    const bot = await telegramBotApi<{ username?: string }>(process.env.CORTEX_TELEGRAM_BOT_TOKEN, "getMe", {});
    if (!bot?.username || !/^[a-zA-Z0-9_]{5,32}$/.test(bot.username)) {
      return response(503, { error: "bot_unavailable" });
    }
    const code = randomBytes(32).toString("base64url");
    const hash = createHash("sha256").update(code).digest("hex");
    const expires = new Date(Date.now() + 5 * 60_000).toISOString();
    const { error } = await admin.from(table).upsert({
      account_id: user.id, telegram_id: null, telegram_username: null, telegram_name: null,
      state: "pending", token_sha256: hash, expires_at: expires, updated_at: date(),
    }, { onConflict: "account_id" });
    if (error) return response(503, { error: "link_unavailable" });
    return response(200, {
      state: "pending", expires_at: expires,
      url: "https://t.me/" + bot.username + "?start=link_" + code,
    });
  } catch { return response(503, { error: "link_unavailable" }); }
}

export async function DELETE(request: NextRequest) {
  if (!sameOrigin(request)) return response(403, { error: "origin" });
  try {
    const context = await authenticated(request);
    if (!context) return response(401, { error: "login_required" });
    const current = await rowFor(context.admin, context.user.id);
    if (!current) return response(200, { state: "none" });
    const { error } = await context.admin.from(table).delete().eq("account_id", context.user.id);
    if (error) return response(503, { error: "unlink_failed" });
    // Inform the Telegram chat after revocation, without rolling back a successful revoke on delivery failures.
    if (current.state === "linked" && current.telegram_id) {
      try {
        await telegramBotApi(process.env.CORTEX_TELEGRAM_BOT_TOKEN, "sendMessage", {
          chat_id: current.telegram_id,
          text: "Связь Telegram с аккаунтом CORTEX отключена в личном кабинете.",
        });
      } catch { /* Link is already revoked. */ }
    }
    return response(200, { state: "none" });
  } catch { return response(503, { error: "link_unavailable" }); }
}
