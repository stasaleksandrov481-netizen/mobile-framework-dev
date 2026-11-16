import type { Network } from "./provider.ts";

const UPSTASH_ENDPOINT = /^https:\/\/[a-z0-9-]+\.upstash\.io\/?$/;
const MODEL_KEY = "cortex:v1:openrouter:free-tools";
const FREE_MODEL = /^[a-z0-9._-]+\/[a-z0-9._-]+:free$/;
const REDIS_TIMEOUT_MS = 1200;
const LOCAL_TTL_MS = 10 * 60_000;
const STALE_TTL_MS = 6 * 60 * 60_000;

/** Redis is an optional model-catalog cache; PostgreSQL owns all quota accounting. */
type RedisCredentials = { url?: string; token?: string } | null;

async function bounded<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error("cache_timeout")), timeoutMs);
    })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function createRedisCache(env: Record<string, string | undefined>, network: Network,
  vault?: () => Promise<RedisCredentials>) {
  const url = (env.UPSTASH_REDIS_REST_URL || "").trim().replace(/\/$/, "");
  const token = (env.UPSTASH_REDIS_REST_TOKEN || "").trim();
  const enabled = UPSTASH_ENDPOINT.test(url) && token.length >= 24;
  let loaded: { value: Promise<RedisCredentials>; until: number } | undefined;
  let cached: { models: string[]; until: number; staleUntil: number } | undefined;
  let pendingGet: Promise<string[] | null> | undefined;
  let consecutiveFailures = 0;
  let circuitOpenUntil = 0;

  async function credentials(): Promise<RedisCredentials> {
    if (enabled) return { url, token };
    if (!vault) return null;
    if (loaded && loaded.until > Date.now()) return loaded.value;
    const value = bounded(vault(), REDIS_TIMEOUT_MS).then(config => {
      const address = String(config?.url || "").trim().replace(/\/$/, "");
      const secret = String(config?.token || "").trim();
      return UPSTASH_ENDPOINT.test(address) && secret.length >= 24 ? { url: address, token: secret } : null;
    }).catch(() => null);
    loaded = { value, until: Date.now() + 5 * 60_000 };
    return value;
  }

  async function command(parts: Array<string | number>): Promise<unknown> {
    if (Date.now() < circuitOpenUntil) return null;
    const config = await credentials();
    if (!config?.url || !config.token) return null;
    try {
      const response = await bounded(network(config.url, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(REDIS_TIMEOUT_MS),
        headers: { Authorization: "Bearer " + config.token, "Content-Type": "application/json" },
        body: JSON.stringify(parts),
      }), REDIS_TIMEOUT_MS);
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new Error("redis_unavailable");
      }
      const result = await bounded(response.json(), REDIS_TIMEOUT_MS);
      if (result.error) throw new Error("redis_error");
      consecutiveFailures = 0;
      circuitOpenUntil = 0;
      return result.result;
    } catch {
      // Avoid a failed Redis request on every user request during an outage.
      consecutiveFailures = Math.min(4, consecutiveFailures + 1);
      circuitOpenUntil = Date.now() + Math.min(120_000, 15_000 * 2 ** (consecutiveFailures - 1));
      return null;
    }
  }

  function localFallback(validate: (model: string) => boolean, stale = false): string[] | null {
    return cached && (stale ? cached.staleUntil : cached.until) > Date.now() && cached.models.every(validate)
      ? [...cached.models] : null;
  }

  async function readRedis(): Promise<string[] | null> {
    const data = await command(["GET", MODEL_KEY]);
    if (typeof data !== "string" || data.length > 3000) return null;
    let models: unknown;
    try { models = JSON.parse(data); } catch { return null; }
    if (!Array.isArray(models) || !models.length || models.length > 12 ||
        !models.every(item => typeof item === "string" && FREE_MODEL.test(item))) return null;
    const now = Date.now();
    cached = { models: [...models], until: now + LOCAL_TTL_MS, staleUntil: now + STALE_TTL_MS };
    return [...models];
  }

  return {
    enabled,
    async getFreeModels(validate: (model: string) => boolean): Promise<string[] | null> {
      // An isolate handles many requests: don't issue a Redis GET on each one.
      const fresh = localFallback(validate);
      if (fresh) return fresh;
      if (!pendingGet) {
        const request = readRedis();
        pendingGet = request;
        void request.finally(() => { if (pendingGet === request) pendingGet = undefined; });
      }
      const models = await pendingGet;
      return models?.every(validate) ? [...models] : localFallback(validate, true);
    },
    async putFreeModels(models: string[]): Promise<void> {
      if (!models.length || models.length > 12 || !models.every(model => FREE_MODEL.test(model))) return;
      const now = Date.now();
      cached = { models: [...models], until: now + LOCAL_TTL_MS, staleUntil: now + STALE_TTL_MS };
      await command(["SET", MODEL_KEY, JSON.stringify(models), "EX", 600]);
    },
  };
}
