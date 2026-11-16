import assert from "node:assert/strict";
import { test } from "node:test";
import { GET } from "../cortex-web/app/api/healthz/route.ts";

test("origin health endpoint is inexpensive and independent of shared services", async () => {
  const response = GET();
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "ok");
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.equal(response.headers.get("x-robots-tag"), "noindex");
  assert.equal(response.headers.get("content-type"), "text/plain; charset=utf-8");
});
