import test from "node:test";
import assert from "node:assert/strict";
import { createRedisCache } from "./redis.ts";

test("Redis model cache validates content and uses ten-minute expiry", async () => {
  const operations: unknown[][] = [];
  const cache = createRedisCache({
    UPSTASH_REDIS_REST_URL: "https://cortex-demo.upstash.io",
    UPSTASH_REDIS_REST_TOKEN: "A".repeat(24),
  }, async (_input, init) => {
    const command = JSON.parse(String(init?.body)) as unknown[];
    operations.push(command);
    return Response.json({ result: command[0] === "GET" ? '["example/working:free"]' : "OK" });
  });
  assert.deepEqual(await cache.getFreeModels(name => name.endsWith(":free")), ["example/working:free"]);
  await cache.putFreeModels(["example/working:free"]);
  assert.deepEqual(operations.map(args => args[0]), ["GET", "SET"]);
  assert.deepEqual(operations[1].slice(-2), ["EX", 600]);
});

test("Redis outage or unexpected model is ignored", async () => {
  const offline = createRedisCache({}, async () => { throw new Error("should not connect"); });
  assert.equal(await offline.getFreeModels(() => true), null);
  const poisoned = createRedisCache({
    UPSTASH_REDIS_REST_URL: "https://cortex-demo.upstash.io", UPSTASH_REDIS_REST_TOKEN: "B".repeat(24),
  }, async () => Response.json({ result: '["example/paid"]' }));
  assert.equal(await poisoned.getFreeModels(name => name.endsWith(":free")), null);
});

test("Redis outage opens a circuit breaker; local validated catalog stays available", async () => {
  let calls = 0;
  let broken = false;
  const cache = createRedisCache({
    UPSTASH_REDIS_REST_URL: "https://cortex-demo.upstash.io",
    UPSTASH_REDIS_REST_TOKEN: "C".repeat(24),
  }, async (_url, init) => {
    calls++;
    if (broken) return new Response(null, { status: 429 });
    const operation = JSON.parse(String(init?.body)) as unknown[];
    return Response.json({ result: operation[0] === "GET" ? '["example/working:free"]' : "OK" });
  });
  assert.deepEqual(await cache.getFreeModels(model => model.endsWith(":free")), ["example/working:free"]);
  broken = true;
  await cache.putFreeModels(["example/working:free"]);
  assert.deepEqual(await cache.getFreeModels(model => model.endsWith(":free")), ["example/working:free"]);
  assert.equal(calls, 2);
  // While the circuit is open, even parallel callers do not hit the depleted cache.
  const results = await Promise.all(Array.from({ length: 20 }, () => cache.getFreeModels(model => model.endsWith(":free"))));
  assert.equal(calls, 2);
  assert.ok(results.every(result => result?.[0] === "example/working:free"));
  assert.equal(await cache.getFreeModels(model => model === "not-allowed"), null);
});

test("Redis hung network is bounded and subsequent attempts skip the circuit", async () => {
  let calls = 0;
  const cache = createRedisCache({
    UPSTASH_REDIS_REST_URL: "https://cortex-demo.upstash.io",
    UPSTASH_REDIS_REST_TOKEN: "D".repeat(24),
  }, async () => { calls++; return await new Promise<Response>(() => {}); });
  const started = Date.now();
  assert.equal(await cache.getFreeModels(() => true), null);
  assert.ok(Date.now() - started < 2000, "A failed cache must not hang indefinitely");
  assert.equal(await cache.getFreeModels(() => true), null);
  assert.equal(calls, 1);
});

test("warm cache avoids Redis reads and parallel cold reads are coalesced", async () => {
  let calls = 0;
  const cache = createRedisCache({
    UPSTASH_REDIS_REST_URL: "https://cortex-demo.upstash.io",
    UPSTASH_REDIS_REST_TOKEN: "E".repeat(24),
  }, async () => {
    calls++;
    await new Promise(resolve => setTimeout(resolve, 20));
    return Response.json({ result: '["example/working:free"]' });
  });
  const models = await Promise.all(Array.from({ length: 40 }, () => cache.getFreeModels(m => m.endsWith(":free"))));
  assert.equal(calls, 1);
  assert.ok(models.every(value => value?.[0] === "example/working:free"));
  assert.deepEqual(await cache.getFreeModels(m => m.endsWith(":free")), ["example/working:free"]);
  assert.equal(calls, 1);
});

test("transient Vault failure is retried after 15 seconds instead of five minutes", async () => {
  let now = 10_000;
  let lookups = 0;
  let redisCalls = 0;
  const previousNow = Date.now;
  Date.now = () => now;
  try {
    const cache = createRedisCache({}, async () => {
      redisCalls++;
      return Response.json({ result: '["example/recovered:free"]' });
    }, async () => {
      lookups++;
      if (lookups === 1) throw new Error("temporary Vault outage");
      return { url: "https://cortex-demo.upstash.io", token: "R".repeat(24) };
    });
    assert.equal(await cache.getFreeModels(model => model.endsWith(":free")), null);
    now += 14_999;
    assert.equal(await cache.getFreeModels(model => model.endsWith(":free")), null);
    assert.equal(lookups, 1, "failed Vault lookups are briefly coalesced");
    now += 2;
    assert.deepEqual(await cache.getFreeModels(model => model.endsWith(":free")),
      ["example/recovered:free"]);
    assert.equal(lookups, 2, "Vault is retried after the short negative TTL");
    assert.equal(redisCalls, 1);
    now += 60_000;
    await cache.putFreeModels(["example/recovered:free"]);
    assert.equal(lookups, 2, "successful Vault credentials remain cached");
    assert.equal(redisCalls, 2);
  } finally {
    Date.now = previousNow;
  }
});
