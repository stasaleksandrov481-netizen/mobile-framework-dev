import type { Network } from "./provider.ts";

const UPSTASH_ENDPOINT = /^https:\/\/[a-z0-9-]+\.upstash\.io\/?$/;
const MODEL_KEY = "cortex:v1:openrouter:free-tools";

/** Optional, short-lived shared cache. Redis failures never block the gateway. */
type RedisCredentials = { url?: string; token?: string } | null;

export function createRedisCache(env: Record<string, string | undefined>, network: Network,
  vault?: () => Promise<RedisCredentials>) {
  const url = (env.UPSTASH_REDIS_REST_URL || "").trim().replace(/\/$/, "");
  const token = (env.UPSTASH_REDIS_REST_TOKEN || "").trim();
  const enabled = UPSTASH_ENDPOINT.test(url) && token.length >= 24;
  let loaded: { value: Promise<RedisCredentials>; until: number } | undefined;

  async function credentials(): Promise<RedisCredentials> {
    if (enabled) return { url, token };
    if (!vault) return null;
    if (loaded && loaded.until > Date.now()) return loaded.value;
    const value = vault().then(config => {
      const address = String(config?.url || "").trim().replace(/\/$/, "");
      const secret = String(config?.token || "").trim();
      return UPSTASH_ENDPOINT.test(address) && secret.length >= 24 ? { url: address, token: secret } : null;
    }).catch(() => null);
    loaded = { value, until: Date.now() + 5 * 60_000 };
    return value;
  }

  async function command(parts: Array<string | number>): Promise<unknown> {
    const config = await credentials();
    if (!config?.url || !config.token) return null;
    const response = await network(config.url, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(1200),
      headers: { Authorization: "Bearer " + config.token, "Content-Type": "application/json" },
      body: JSON.stringify(parts),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("redis_unavailable");
    }
    const result = await response.json();
    if (result.error) throw new Error("redis_error");
    return result.result;
  }

  return {
    enabled,
    async getFreeModels(validate: (model: string) => boolean): Promise<string[] | null> {
      const data = await command(["GET", MODEL_KEY]);
      if (typeof data !== "string" || data.length > 3000) return null;
      let models: unknown;
      try { models = JSON.parse(data); } catch { return null; }
      if (!Array.isArray(models) || !models.length || models.length > 12 ||
          !models.every(item => typeof item === "string" && validate(item))) return null;
      return models;
    },
    async putFreeModels(models: string[]): Promise<void> {
      if (models.length) await command(["SET", MODEL_KEY, JSON.stringify(models), "EX", 600]);
    },
  };
}
