import assert from "node:assert/strict";
import { test } from "node:test";
import { readBoundedJson } from "../lib/bounded-json.ts";
import { verifiedCheckoutUrl } from "../lib/checkout-url.ts";

test("approved request parser accepts bounded JSON and rejects oversized bodies", async () => {
  const valid = new Request("https://cortexapp.ru/api/checkout", {
    method: "POST",
    body: JSON.stringify({ plan: "solo" }),
  });
  assert.deepEqual(await readBoundedJson(valid, 64), { plan: "solo" });

  const oversized = new Request("https://cortexapp.ru/api/checkout", {
    method: "POST",
    body: JSON.stringify({ note: "a".repeat(300) }),
  });
  await assert.rejects(readBoundedJson(oversized, 64), /body_limit_exceeded/);
  await assert.rejects(readBoundedJson(new Request("https://cortexapp.ru/"), 64), /invalid_body/);
  await assert.rejects(readBoundedJson(new Request("https://cortexapp.ru/"), 0), /invalid_body/);
});

test("approved request parser rejects invalid JSON and invalid UTF-8", async () => {
  const malformed = new Request("https://cortexapp.ru/api/checkout", {
    method: "POST",
    body: "{bad",
  });
  await assert.rejects(readBoundedJson(malformed, 32), SyntaxError);

  const badUtf8 = new Request("https://cortexapp.ru/api/checkout", {
    method: "POST",
    body: new Uint8Array([0xc3, 0x28]),
  });
  await assert.rejects(readBoundedJson(badUtf8, 32), TypeError);
});

test("payment checkout redirect stays on the exact approved HTTPS host", () => {
  assert.equal(verifiedCheckoutUrl("https://app.platega.io/pay/abc"), "https://app.platega.io/pay/abc");
  for (const invalid of [
    null,
    42,
    "https://app.platega.io.evil.example/pay",
    "https://app.platega.io:8443/pay",
    "https://fake-app.platega.io/pay",
    "http://app.platega.io/pay",
    "https://user:pass@app.platega.io/pay",
    "https://app.platega.io@evil.example/pay",
    "https://app.platega.io:8443/pay",
    "javascript:alert(1)",
    "https://app.platega.io/" + "x".repeat(2100),
  ]) {
    assert.equal(verifiedCheckoutUrl(invalid), null, String(invalid).slice(0, 90));
  }
});
