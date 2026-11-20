import { Redis } from "@upstash/redis";

let client: Redis | undefined;

/** Server-only Redis connection. Credentials belong in Vercel environment variables. */
export function getRedis(): Redis {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    throw new Error("Redis is not configured");
  }

  if (!client) {
    // No long retry chain on a public page: return to Supabase if Redis stalls.
    client = new Redis({ url, token, signal: () => AbortSignal.timeout(900), retry: false });
  }

  return client;
}
