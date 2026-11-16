import { NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { createCachedHealthCheck } from "@/lib/health-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const isHealthy = createCachedHealthCheck(async () => (await getRedis().ping()) === "PONG");

export async function GET() {
  const healthy = await isHealthy();
  // Never return Redis credentials or upstream diagnostics to public callers.
  // Redis is only an optional cache. Its outage must not make the website
  // appear down to uptime checks or block users from viewing the landing.
  return NextResponse.json(
    { status: "ok", cache: healthy ? "ok" : "degraded" },
    { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } },
  );
}
