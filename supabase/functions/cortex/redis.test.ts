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
