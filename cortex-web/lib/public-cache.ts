import { getRedis } from "./redis.ts";

type RedisPort<T> = {
  get(key: string): Promise<T | null>;
  set(key: string, value: T, options: { ex: number }): Promise<unknown>;
};

type Options<T> = {
  key: string;
  ttlSeconds: number;
  validate(value: unknown): value is T;
  load(): Promise<unknown>;
  now?: () => number;
  redis?: () => RedisPort<T>;
};

/** Only public, non-personal catalog values belong here. Never cache sessions or entitlements. */
export function createPublicCache<T>({
  key, ttlSeconds, validate, load, now = Date.now,
  redis = () => {
    const client = getRedis();
    return {
      get: (redisKey: string) => client.get<T>(redisKey),
      set: (redisKey: string, value: T, options: { ex: number }) => client.set(redisKey, value, options),
    };
  },
}: Options<T>): () => Promise<T | null> {
  if (!key.startsWith("cortex:web:public:v1:") || !Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 3600) {
    throw new Error("invalid_public_cache_config");
  }

  let local: { value: T; until: number } | undefined;
  let inflight: Promise<T | null> | undefined;
  let redisUnavailableUntil = 0;

  function remember(value: T) {
    // Small L1 avoids a Redis round-trip on every warm serverless request.
    local = { value, until: now() + Math.min(10_000, ttlSeconds * 1000) };
  }

  return function cached(): Promise<T | null> {
    if (local && local.until > now()) return Promise.resolve(local.value);
    if (inflight) return inflight;

    const request = (async (): Promise<T | null> => {
      if (now() >= redisUnavailableUntil) {
        try {
          const hit = await redis().get(key);
          if (validate(hit)) {
            remember(hit);
            return hit;
          }
        } catch {
          // Redis remains an optional optimization. Never block a public page.
          redisUnavailableUntil = now() + 30_000;
        }
      }

      let source: unknown;
      try { source = await load(); } catch { return null; }
      if (!validate(source)) return null;

      remember(source);
      if (now() >= redisUnavailableUntil) {
        try {
          // Expiration is mandatory; catalog keys must not grow indefinitely.
          await redis().set(key, source, { ex: ttlSeconds });
        } catch {
          redisUnavailableUntil = now() + 30_000;
        }
      }
      return source;
    })();

    inflight = request.finally(() => { inflight = undefined; });
    return inflight;
  };
}
