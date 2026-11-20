import { test } from "node:test";
import assert from "node:assert/strict";
import { createPublicCache } from "../lib/public-cache.ts";

const valid = value => Array.isArray(value) && value.length === 1 && value[0]?.code === "pro";

test("public cache writes validated catalog with TTL and reuses it across instances", async () => {
  const database = new Map();
  let now = 0;
  let reads = 0;
  let loads = 0;
  let ttl = 0;
  const redis = () => ({
    async get(key) { reads++; return database.get(key) ?? null; },
    async set(key, value, opts) { ttl = opts.ex; database.set(key, value); },
  });
  const options = {
    key: "cortex:web:public:v1:test-catalog", ttlSeconds: 60, validate: valid,
    now: () => now, redis,
    async load() { loads++; return [{ code: "pro" }]; },
  };
  const first = createPublicCache(options);
  const results = await Promise.all(Array.from({ length: 30 }, first));
  assert.equal(results.length, 30);
  assert.ok(results.every(value => value?.[0].code === "pro"));
  assert.equal(loads, 1, "parallel cold requests must share one load");
  assert.equal(reads, 1);
  assert.equal(ttl, 60);

  now = 12_000;
  const second = createPublicCache({ ...options, load: async () => { throw new Error("should not fetch"); } });
  assert.deepEqual(await second(), [{ code: "pro" }], "a fresh serverless instance uses Redis L2");
  assert.equal(reads, 2);
  assert.equal(loads, 1);
});

test("poisoned values never become a hit; source failures are not cached", async () => {
  let stored = [{ code: "other" }];
  let loads = 0;
  const redis = () => ({
    async get() { return stored; },
    async set(_key, value) { stored = value; },
  });
  const cache = createPublicCache({
    key: "cortex:web:public:v1:validation", ttlSeconds: 60,
    validate: valid, redis,
    async load() { loads++; return loads === 1 ? null : [{ code: "pro" }]; },
  });
  assert.equal(await cache(), null);
  assert.deepEqual(stored, [{ code: "other" }], "failed source does not poison cache");
  assert.deepEqual(await cache(), [{ code: "pro" }]);
  assert.deepEqual(stored, [{ code: "pro" }]);
});

test("Redis failure opens a short circuit without breaking public pages", async () => {
  let now = 0;
  let attempts = 0;
  let loads = 0;
  const cache = createPublicCache({
    key: "cortex:web:public:v1:offline", ttlSeconds: 60,
    validate: valid, now: () => now,
    redis: () => ({ async get() { attempts++; throw new Error("offline"); }, async set() { throw new Error("offline"); } }),
    async load() { loads++; return [{ code: "pro" }]; },
  });
  assert.deepEqual(await cache(), [{ code: "pro" }]);
  now = 11_000;
  assert.deepEqual(await cache(), [{ code: "pro" }]);
  assert.equal(attempts, 1, "Redis is not polled repeatedly during an outage");
  assert.equal(loads, 2);
  now = 40_000;
  assert.deepEqual(await cache(), [{ code: "pro" }]);
  assert.equal(attempts, 2, "Redis is retried after the circuit opens");
});

test("cache configuration rejects permanent keys and non-public namespaces", () => {
  assert.throws(() => createPublicCache({ key: "cortex:users:private", ttlSeconds: 60, validate: valid, load: async () => [] }));
  assert.throws(() => createPublicCache({ key: "cortex:web:public:v1:bad", ttlSeconds: 0, validate: valid, load: async () => [] }));
});
