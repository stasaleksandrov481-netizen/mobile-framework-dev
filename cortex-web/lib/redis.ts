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
    client = new Redis({ url, token });
  }

  return client;
}
