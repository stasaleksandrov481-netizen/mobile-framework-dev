import assert from "node:assert/strict";
import { test } from "node:test";
import { createCachedHealthCheck } from "../lib/health-cache.ts";
import { safeHttpsDownloadUrl } from "../lib/safe-url.ts";

test("health probes coalesce parallel requests and cache success", async () => {
  let requests = 0;
  const healthy = createCachedHealthCheck(async () => {
    requests++;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return true;
  }, 100, 500);
  assert.deepEqual(await Promise.all(Array.from({ length: 24 }, () => healthy())), Array(24).fill(true));
  assert.equal(requests, 1);
  assert.equal(await healthy(), true);
  assert.equal(requests, 1);
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(await healthy(), true);
  assert.equal(requests, 2);
});

test("health probes bound timeout and cache failures", async () => {
  let requests = 0;
  const healthy = createCachedHealthCheck(() => {
    requests++;
    return new Promise(() => {});
  }, 100, 25);
  assert.equal(await healthy(), false);
  assert.equal(await healthy(), false);
  assert.equal(requests, 1);
});

test("health probes suppress upstream errors", async () => {
  const healthy = createCachedHealthCheck(async () => { throw Error("secret"); });
  assert.equal(await healthy(), false);
});

test("APK URL only accepts absolute credential-free HTTPS URLs", () => {
  assert.equal(safeHttpsDownloadUrl("https://github.com/owner/repo/releases/latest"), "https://github.com/owner/repo/releases/latest");
  for (const candidate of [undefined, "", "javascript:alert(1)", "http://example.com/app.apk", "//example.com/x", "https://a:b@example.com/app.apk", "/download"]) {
    assert.equal(safeHttpsDownloadUrl(candidate), undefined);
  }
});
