import assert from "node:assert/strict";
import test from "node:test";
import { verifiedCheckoutUrl } from "../lib/checkout-url.ts";

test("checkout redirect only accepts actual HTTPS Platega checkout origin", () => {
  assert.equal(verifiedCheckoutUrl("https://app.platega.io/payment/123?order=1"), "https://app.platega.io/payment/123?order=1");
  for (const value of [
    "https://app.platega.io.evil.example/", "https://platega.io/", "https://foo.app.platega.io/",
    "http://app.platega.io/", "https://user:secret@app.platega.io/", "javascript:alert(1)",
    "https://app.platega.io@evil.example/", "//app.platega.io/", null,
  ]) assert.equal(verifiedCheckoutUrl(value), null);
});
